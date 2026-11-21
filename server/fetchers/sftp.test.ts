import { afterAll, beforeAll, expect, test } from "bun:test";
import {
	closeSync,
	fstatSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readdirSync,
	readFileSync,
	readSync,
	type Stats,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Server, utils } from "ssh2";
import { type SftpConf, SftpFetcher } from "./sftp";

const { STATUS_CODE } = utils.sftp;

let root: string;
let server: Server;
let conf: SftpConf;
let connections = 0;

const attrsOf = (st: Stats) => ({
	mode: st.mode,
	uid: st.uid,
	gid: st.gid,
	size: st.size,
	atime: Math.floor(st.atimeMs / 1000),
	mtime: Math.floor(st.mtimeMs / 1000),
});

/** A minimal read-only SFTP server over `root`. */
function serve(): Promise<number> {
	const key = utils.generateKeyPairSync("ed25519");
	server = new Server({ hostKeys: [key.private] }, (client) => {
		connections++;
		client.on("authentication", (ctx) => {
			if (
				ctx.method === "password" &&
				ctx.username === "me.abc" &&
				ctx.password === "pw"
			)
				ctx.accept();
			else ctx.reject(["password"]);
		});
		client.on("error", () => {});
		client.on("ready", () =>
			client.on("session", (accept) =>
				accept().on("sftp", (acceptSftp) => {
					const sftp = acceptSftp();
					const handles = new Map<
						number,
						{ fd?: number; names?: string[]; dir?: string; sent?: boolean }
					>();
					let next = 1;
					const open = (h: object) => {
						const id = next++;
						handles.set(id, h);
						const b = Buffer.alloc(4);
						b.writeUInt32BE(id);
						return b;
					};
					const get = (b: Buffer) => handles.get(b.readUInt32BE(0));
					const stat = (reqid: number, path: string) => {
						try {
							sftp.attrs(reqid, attrsOf(statSync(join(root, path))));
						} catch {
							sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
						}
					};
					sftp.on("REALPATH", (reqid, path) =>
						sftp.name(reqid, [
							{ filename: path, longname: path, attrs: {} as never },
						]),
					);
					sftp.on("STAT", stat);
					sftp.on("LSTAT", stat);
					sftp.on("FSTAT", (reqid, h) => {
						const e = get(h);
						if (e?.fd === undefined)
							return sftp.status(reqid, STATUS_CODE.FAILURE);
						sftp.attrs(reqid, attrsOf(fstatSync(e.fd)));
					});
					sftp.on("OPENDIR", (reqid, path) => {
						// Wings answers any directory it can't list with the generic Failure.
						if (path === "/gone" || path === "/broken")
							return sftp.status(reqid, STATUS_CODE.FAILURE);
						try {
							const dir = join(root, path);
							sftp.handle(reqid, open({ names: readdirSync(dir), dir }));
						} catch {
							sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
						}
					});
					sftp.on("READDIR", (reqid, h) => {
						const e = get(h);
						if (!e?.names || e.sent) return sftp.status(reqid, STATUS_CODE.EOF);
						e.sent = true;
						sftp.name(
							reqid,
							e.names.map((n) => ({
								filename: n,
								longname: n,
								attrs: attrsOf(statSync(join(e.dir as string, n))),
							})),
						);
					});
					sftp.on("OPEN", (reqid, path) => {
						try {
							sftp.handle(reqid, open({ fd: openSync(join(root, path), "r") }));
						} catch {
							sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
						}
					});
					sftp.on("READ", (reqid, h, offset, length) => {
						const e = get(h);
						if (e?.fd === undefined)
							return sftp.status(reqid, STATUS_CODE.FAILURE);
						const buf = Buffer.alloc(length);
						const n = readSync(e.fd, buf, 0, length, offset);
						if (n === 0) sftp.status(reqid, STATUS_CODE.EOF);
						else sftp.data(reqid, buf.subarray(0, n));
					});
					sftp.on("CLOSE", (reqid, h) => {
						const e = get(h);
						if (e?.fd !== undefined) closeSync(e.fd);
						handles.delete(h.readUInt32BE(0));
						sftp.status(reqid, STATUS_CODE.OK);
					});
				}),
			),
		);
	});
	return new Promise((ok) =>
		server.listen(0, "127.0.0.1", () =>
			ok((server.address() as { port: number }).port),
		),
	);
}

beforeAll(async () => {
	root = mkdtempSync(join(tmpdir(), "sftp-test-"));
	mkdirSync(join(root, "logs/sub"), { recursive: true });
	mkdirSync(join(root, "broken"));
	writeFileSync(join(root, "logs/latest.log"), "hello");
	utimesSync(join(root, "logs/latest.log"), 1_700_000_000, 1_700_000_000);
	writeFileSync(
		join(root, "logs/big.bin"),
		Buffer.alloc(5 * 1024 * 1024).map((_, i) => (i * 31 + (i >> 8)) & 255),
	);
	const port = await serve();
	conf = { host: "127.0.0.1", port, username: "me.abc", password: "pw" };
});

afterAll(() => server.close());

test("lists only files, with size and mtime", async () => {
	const f = new SftpFetcher(async () => conf);
	try {
		const files = await f.list("/logs");
		expect(files.map((x) => x.name).sort()).toEqual(["big.bin", "latest.log"]);
		expect(files.find((x) => x.name === "latest.log")).toEqual({
			name: "latest.log",
			size: 5,
			mtimeMs: 1_700_000_000_000,
		});
	} finally {
		await f.close();
	}
});

test("a missing directory is an empty list", async () => {
	const f = new SftpFetcher(async () => conf);
	try {
		expect(await f.list("/crash-reports")).toEqual([]);
	} finally {
		await f.close();
	}
});

test("a directory the server answers 'Failure' for, that is not there, is an empty list", async () => {
	const f = new SftpFetcher(async () => conf);
	try {
		expect(await f.list("/gone")).toEqual([]);
	} finally {
		await f.close();
	}
});

test("a real failure on a directory that exists says what failed", async () => {
	const f = new SftpFetcher(async () => conf);
	try {
		await expect(f.list("/broken")).rejects.toThrow(
			"SFTP could not list /broken: Failure (status 4)",
		);
	} finally {
		await f.close();
	}
});

test("a failed download says which file", async () => {
	const f = new SftpFetcher(async () => conf);
	const out = mkdtempSync(join(tmpdir(), "sftp-out-"));
	try {
		await expect(f.download("/logs/nope.log", join(out, "x"))).rejects.toThrow(
			"SFTP could not download /logs/nope.log",
		);
	} finally {
		await f.close();
	}
});

test("downloads a multi-megabyte file intact, and many at once on one connection", async () => {
	const before = connections;
	const f = new SftpFetcher(async () => conf);
	const out = mkdtempSync(join(tmpdir(), "sftp-out-"));
	try {
		await Promise.all(
			[0, 1, 2, 3].map((i) =>
				f.download("/logs/big.bin", join(out, `big${i}`)),
			),
		);
		await f.download("/logs/latest.log", join(out, "latest.log"));
		await f.list("/logs");
		const want = readFileSync(join(root, "logs/big.bin"));
		for (let i = 0; i < 4; i++)
			expect(readFileSync(join(out, `big${i}`)).equals(want)).toBe(true);
		expect(readFileSync(join(out, "latest.log"), "utf8")).toBe("hello");
		expect(connections - before).toBe(1);
	} finally {
		await f.close();
	}
});

test("reconnects after close", async () => {
	const before = connections;
	const f = new SftpFetcher(async () => conf);
	await f.list("/logs");
	await f.close();
	await f.list("/logs");
	await f.close();
	expect(connections - before).toBe(2);
});

test("a wrong password fails, and the next call tries again", async () => {
	let pw = "nope";
	const f = new SftpFetcher(async () => ({ ...conf, password: pw }));
	await expect(f.list("/logs")).rejects.toThrow();
	pw = "pw";
	expect((await f.list("/logs")).length).toBe(2);
	await f.close();
});

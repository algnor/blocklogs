import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	getAccountUsername,
	getPanelServerState,
	getSftpDetails,
	listPanelServers,
	PanelError,
	PterodactylFetcher,
} from "./pterodactyl";

let srv: ReturnType<typeof Bun.serve>;
let conf: { panelUrl: string; panelKey: string; ratePerMin?: number };
let limited = true;
const seen: string[] = [];

beforeAll(() => {
	srv = Bun.serve({
		port: 0,
		fetch(req) {
			const url = new URL(req.url);
			seen.push(`${url.pathname}${url.search}`);
			if (url.pathname.startsWith("/wings/")) return new Response("file body");
			if (req.headers.get("authorization") !== "Bearer key")
				return new Response("{}", { status: 403 });
			if (url.pathname === "/api/client/account")
				return Response.json({ attributes: { username: "algot" } });
			if (url.pathname === "/api/client/servers/abc")
				return Response.json({
					attributes: { sftp_details: { ip: "node.example", port: 2022 } },
				});
			if (url.pathname === "/api/client") {
				const page = Number(url.searchParams.get("page"));
				if (limited && page === 1) {
					limited = false;
					return new Response("{}", {
						status: 429,
						headers: { "retry-after": "0" },
					});
				}
				return Response.json({
					data: [
						{
							attributes: {
								identifier: `id${page}`,
								name: `S${page}`,
								description: "",
								node: "n",
								server_owner: true,
								// The second server is suspended, the first still installing.
								status: page === 2 ? "suspended" : "installing",
								is_suspended: page === 2,
							},
						},
					],
					meta: { pagination: { current_page: page, total_pages: 2 } },
				});
			}
			if (url.pathname.endsWith("/files/list")) {
				if (url.searchParams.get("directory") === "/missing")
					return Response.json(
						{ errors: [{ detail: "nope" }] },
						{ status: 404 },
					);
				return Response.json({
					data: [
						{
							attributes: {
								name: "latest.log",
								size: 10,
								is_file: true,
								modified_at: "2026-11-07T12:00:00+00:00",
							},
						},
						{
							attributes: {
								name: "sub",
								size: 0,
								is_file: false,
								modified_at: "2026-11-07T12:00:00+00:00",
							},
						},
					],
				});
			}
			if (url.pathname.endsWith("/files/download"))
				return Response.json({
					attributes: { url: `${srv.url.origin}/wings/dl?token=x` },
				});
			return new Response("{}", { status: 404 });
		},
	});
	conf = { panelUrl: srv.url.origin, panelKey: "key", ratePerMin: 60_000 };
});

afterAll(() => srv.stop(true));

test("lists panel servers across pages and retries after a 429", async () => {
	const list = await listPanelServers(conf);
	expect(list.map((s) => s.identifier)).toEqual(["id1", "id2"]);
	expect(list.map((s) => [s.status, s.suspended])).toEqual([
		["installing", false],
		["suspended", true],
	]);
});

test("lists only files, with parsed modification time", async () => {
	const f = new PterodactylFetcher("abc", conf);
	expect(await f.list("/logs")).toEqual([
		{ name: "latest.log", size: 10, mtimeMs: Date.UTC(2026, 10, 7, 12) },
	]);
	expect(seen).toContain(
		"/api/client/servers/abc/files/list?directory=%2Flogs",
	);
});

test("a missing directory is an empty list", async () => {
	expect(await new PterodactylFetcher("abc", conf).list("/missing")).toEqual(
		[],
	);
});

test("downloads through the signed url", async () => {
	const dest = join(mkdtempSync(join(tmpdir(), "ptero-")), "out");
	await new PterodactylFetcher("abc", conf).download("/logs/latest.log", dest);
	expect(readFileSync(dest, "utf8")).toBe("file body");
});

test("a bad key is a PanelError with the status", async () => {
	const err = await new PterodactylFetcher("abc", { ...conf, panelKey: "bad" })
		.list("/logs")
		.catch((e) => e);
	expect(err).toBeInstanceOf(PanelError);
	expect((err as PanelError).status).toBe(403);
});

test("every request waits for the shared limiter, and a 429 pauses later ones too", async () => {
	let hits = 0;
	const s = Bun.serve({
		port: 0,
		fetch() {
			hits++;
			return hits === 1
				? new Response("{}", { status: 429, headers: { "retry-after": "1" } })
				: Response.json({ data: [] });
		},
	});
	try {
		const c = { panelUrl: s.url.origin, panelKey: "k2", ratePerMin: 60_000 };
		const t = Date.now();
		const f = new PterodactylFetcher("abc", c);
		await Promise.all([f.list("/a"), f.list("/b")]);
		expect(Date.now() - t).toBeGreaterThanOrEqual(1000);
		expect(hits).toBe(3);
	} finally {
		s.stop(true);
	}
});

test("looks up the account username and a server's SFTP address", async () => {
	expect(await getAccountUsername(conf)).toBe("algot");
	expect(await getSftpDetails("abc", conf)).toEqual({
		ip: "node.example",
		port: 2022,
	});
});

test("looks up one server's state in the list, which still answers for a suspended server", async () => {
	const c = { ...conf, panelKey: "key" };
	expect((await getPanelServerState("id2", c))?.suspended).toBe(true);
	expect((await getPanelServerState("id1", c))?.suspended).toBe(false);
	expect(await getPanelServerState("nope", c)).toBeNull();
});

test("asks for every server, and falls back to the account's own when refused", async () => {
	const urls: string[] = [];
	const panel = Bun.serve({
		port: 0,
		fetch(req) {
			const u = new URL(req.url);
			urls.push(u.search);
			if (u.searchParams.get("type") === "admin-all")
				return new Response("{}", { status: 403 });
			return Response.json({
				data: [
					{
						attributes: {
							identifier: "own",
							name: "Own",
							description: "",
							node: "n",
							server_owner: true,
						},
					},
				],
				meta: { pagination: { current_page: 1, total_pages: 1 } },
			});
		},
	});
	try {
		const list = await listPanelServers({
			panelUrl: panel.url.origin,
			panelKey: "key",
			ratePerMin: 60_000,
		});
		expect(list.map((s) => s.identifier)).toEqual(["own"]);
		expect(urls).toEqual(["?page=1&type=admin-all", "?page=1"]);
	} finally {
		panel.stop(true);
	}
});

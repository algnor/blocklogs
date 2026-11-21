import { Client, type ConnectConfig, type SFTPWrapper } from "ssh2";
import { config, readSftpKey, sftpKeyConfigured } from "../config";
import {
	getAccountUsername,
	getSftpDetails,
	panelConfigured,
} from "./pterodactyl";
import type { Fetcher, RemoteFile } from "./types";

export type SftpConf = Pick<
	ConnectConfig,
	"host" | "port" | "username" | "password" | "privateKey" | "passphrase"
>;

const NO_SUCH_FILE = 2;
const FAILURE = 4;

/** SFTP errors are just "Failure": say what was being done to what. */
function describe(op: string, path: string, err: Error): Error {
	const code = (err as { code?: number }).code;
	return new Error(
		`SFTP could not ${op} ${path}: ${err.message}${code === undefined ? "" : ` (status ${code})`}`,
	);
}

export function sftpConfigured(): boolean {
	// The username can come from the panel API, so a password or key is all that is required.
	return Boolean(
		(config.sftpPassword || sftpKeyConfigured()) &&
			(config.sftpUser || panelConfigured()),
	);
}

/**
 * Reads a server's files over SFTP. One connection is opened on first use and shared by every
 * request until `close()`; SFTP multiplexes them, and each download keeps many reads in flight.
 */
export class SftpFetcher implements Fetcher {
	private conn: Promise<{ client: Client; sftp: SFTPWrapper }> | null = null;

	constructor(private readonly resolve: () => Promise<SftpConf>) {}

	private connect() {
		this.conn ??= (async () => {
			const conf = await this.resolve();
			const client = new Client();
			const sftp = await new Promise<SFTPWrapper>((ok, fail) => {
				client.once("error", fail);
				client.once("ready", () =>
					client.sftp((err, s) => (err ? fail(err) : ok(s))),
				);
				client.connect({
					readyTimeout: 20_000,
					keepaliveInterval: 15_000,
					...conf,
				});
			});
			const drop = () => {
				this.conn = null;
			};
			client.on("error", drop);
			client.on("close", drop);
			return { client, sftp };
		})();
		this.conn.catch(() => {
			this.conn = null;
		});
		return this.conn;
	}

	async list(dir: string): Promise<RemoteFile[]> {
		const { sftp } = await this.connect();
		return new Promise((ok, fail) => {
			sftp.readdir(dir, (err, entries) => {
				if (err) {
					const code = (err as { code?: number }).code;
					if (code === NO_SUCH_FILE) return ok([]);
					// Pterodactyl's SFTP answers a directory that does not exist (no crash
					// reports yet) with the generic "Failure". Telling that apart from a real
					// failure takes a look at whether the directory is there at all.
					if (code === FAILURE && dir !== "/")
						return sftp.stat(dir, (statErr) =>
							statErr ? ok([]) : fail(describe("list", dir, err)),
						);
					return fail(describe("list", dir, err));
				}
				ok(
					entries
						.filter((e) => e.attrs.isFile())
						.map((e) => ({
							name: e.filename,
							size: e.attrs.size,
							mtimeMs: e.attrs.mtime * 1000,
						})),
				);
			});
		});
	}

	async download(path: string, dest: string): Promise<void> {
		const { sftp } = await this.connect();
		return new Promise((ok, fail) => {
			sftp.fastGet(path, dest, { concurrency: 64, chunkSize: 32768 }, (err) =>
				err ? fail(describe("download", path, err)) : ok(),
			);
		});
	}

	async close(): Promise<void> {
		const conn = this.conn;
		this.conn = null;
		(await conn?.catch(() => null))?.client.end();
	}
}

/** The login for a Pterodactyl server: the panel account's credentials plus the server identifier. */
export function pterodactylSftp(identifier: string): SftpFetcher {
	return new SftpFetcher(async () => {
		if (!sftpConfigured())
			throw new Error(
				"SFTP is not configured: set PTERO_SFTP_PASSWORD (or PTERO_SFTP_KEY_FILE), and PTERO_SFTP_USER unless the panel API is configured",
			);
		const account = config.sftpUser || (await getAccountUsername());
		let host = config.sftpHost;
		let port = config.sftpPort;
		if (!host || !port) {
			if (panelConfigured()) {
				const d = await getSftpDetails(identifier);
				host ??= d.ip;
				port ??= d.port;
			} else {
				port ??= 2022;
			}
		}
		if (!host)
			throw new Error(
				"no SFTP host: set PTERO_URL/PTERO_API_KEY or PTERO_SFTP_HOST",
			);
		return {
			host,
			port: port ?? 2022,
			username: `${account}.${identifier}`,
			password: config.sftpPassword || undefined,
			privateKey: readSftpKey(),
			passphrase: config.sftpPassphrase,
		};
	});
}

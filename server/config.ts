import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

type KeyEnv = Record<string, string | undefined>;

/** Whether an SSH key is set up (inline or as a file), without reading it. */
export function sftpKeyConfigured(env: KeyEnv = process.env): boolean {
	return Boolean(env.PTERO_SFTP_KEY || env.PTERO_SFTP_KEY_FILE);
}

/**
 * The SSH private key from PTERO_SFTP_KEY (inline) or PTERO_SFTP_KEY_FILE (a path). Read when
 * SFTP is used, not at startup, so a wrong path is an error on that sync, not a crashed app.
 */
export function readSftpKey(env: KeyEnv = process.env): string | undefined {
	let key: string;
	if (env.PTERO_SFTP_KEY) key = env.PTERO_SFTP_KEY.replace(/\\n/g, "\n");
	else if (env.PTERO_SFTP_KEY_FILE) {
		try {
			key = readFileSync(env.PTERO_SFTP_KEY_FILE, "utf8");
		} catch (e) {
			throw new Error(
				`cannot read PTERO_SFTP_KEY_FILE (${env.PTERO_SFTP_KEY_FILE}): ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}. In Docker, this is a path inside the container, so mount the key there.`,
			);
		}
	} else return undefined;
	if (/^(ssh-|ecdsa-)/.test(key.trim()))
		throw new Error(
			"the SSH key is a public key (.pub); SFTP needs the private key. The public key is the one you add to the panel.",
		);
	return key;
}

export const config = {
	dataDir: process.env.DATA_DIR ?? join(root, "data"),
	port: Number(process.env.PORT ?? 3000),
	host: process.env.BIND_HOST ?? "127.0.0.1",
	panelUrl: (process.env.PTERO_URL ?? "").replace(/\/+$/, ""),
	panelKey: process.env.PTERO_API_KEY ?? "",
	/** Panel API requests per minute to stay under (the panel default limit is 240). */
	panelRatePerMin: Number(process.env.PTERO_RATE_PER_MIN ?? 200),
	/**
	 * SFTP login. Pterodactyl uses the panel account's own credentials, with the server's
	 * identifier appended to the username (`<user>.<identifier>`), so one set covers every server.
	 * `sftpUser` overrides the account name, which is otherwise looked up through the panel API.
	 */
	sftpUser: process.env.PTERO_SFTP_USER ?? "",
	sftpPassword: process.env.PTERO_SFTP_PASSWORD ?? "",
	sftpPassphrase: process.env.PTERO_SFTP_PASSPHRASE || undefined,
	/** Overrides the host the panel reports for a server's SFTP (and the port with `PTERO_SFTP_PORT`). */
	sftpHost: process.env.PTERO_SFTP_HOST || undefined,
	sftpPort: process.env.PTERO_SFTP_PORT
		? Number(process.env.PTERO_SFTP_PORT)
		: undefined,
	/** How often the scheduler wakes to look for servers that are due a sync. */
	schedulerTickMs: 30_000,
	/** Parallel parse workers. */
	workers: Number(
		process.env.WORKERS ?? Math.max(1, navigator.hardwareConcurrency - 1),
	),
	/** Parallel downloads per server. */
	downloads: Number(process.env.DOWNLOADS ?? 4),
};

export const filesDir = join(config.dataDir, "files");
export const dbPath = join(config.dataDir, "app.db");
export const mmdbPath = join(config.dataDir, "dbip-country-lite.mmdb");

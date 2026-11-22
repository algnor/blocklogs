import { config } from "../config";
import { activity } from "../log";
import { RateLimiter } from "./ratelimit";
import type { Fetcher, RemoteFile } from "./types";

export class PanelError extends Error {
	constructor(
		message: string,
		readonly status?: number,
	) {
		super(message);
	}
}

export type PanelServer = {
	identifier: string;
	name: string;
	description: string;
	node: string;
	isOwner: boolean;
	/** The panel's own state: null when normal, else `installing`, `install_failed`, `suspended` ... */
	status: string | null;
	/** Its files can't be read while suspended. */
	suspended: boolean;
};

export type PanelConf = {
	panelUrl: string;
	panelKey: string;
	/** Requests per minute to stay under; defaults to the configured PTERO_RATE_PER_MIN. */
	ratePerMin?: number;
};

const MAX_RETRIES = 8;

// One limiter per panel and key, because the panel's limit is per API key, not per server.
const limiters = new Map<string, RateLimiter>();
function limiterFor(conf: PanelConf): RateLimiter {
	const key = `${conf.panelUrl}|${conf.panelKey}`;
	let l = limiters.get(key);
	if (!l) {
		const rate = conf.ratePerMin ?? config.panelRatePerMin;
		l = new RateLimiter(rate, Math.max(1, Math.min(10, Math.floor(rate / 6))));
		limiters.set(key, l);
	}
	return l;
}

export function panelConfigured(conf: PanelConf = config): boolean {
	return Boolean(conf.panelUrl && conf.panelKey);
}

/** A request to the panel's client API, retrying when the rate limit is hit. */
async function api(
	path: string,
	init: RequestInit = {},
	conf: PanelConf = config,
	attempt = 0,
): Promise<Response> {
	if (!panelConfigured(conf))
		throw new PanelError("PTERO_URL and PTERO_API_KEY are not set");
	const limiter = limiterFor(conf);
	await limiter.acquire();
	const res = await fetch(`${conf.panelUrl}/api/client${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${conf.panelKey}`,
			Accept: "Application/vnd.pterodactyl.v1+json",
			...init.headers,
		},
	});
	if (res.status === 429 && attempt < MAX_RETRIES) {
		// Pause every caller for the longer of what the panel asks and an exponential backoff.
		const asked = Number(res.headers.get("retry-after"));
		const backoff = Math.min(60_000, 2000 * 2 ** attempt);
		const jitter = Math.random() * 500;
		const pause =
			Math.max(Number.isFinite(asked) ? asked * 1000 : 0, backoff) + jitter;
		limiter.penalize(pause);
		activity(
			null,
			"warn",
			`Panel rate limit hit: pausing all panel requests for ${(pause / 1000).toFixed(1)}s (retry ${attempt + 1} of ${MAX_RETRIES})`,
		);
		return api(path, init, conf, attempt + 1);
	}
	if (!res.ok) {
		let detail = "";
		try {
			const body = (await res.json()) as { errors?: { detail?: string }[] };
			detail = body.errors?.[0]?.detail ?? "";
		} catch {}
		throw new PanelError(
			`panel ${res.status} on ${path}${detail ? `: ${detail}` : ""}`,
			res.status,
		);
	}
	return res;
}

type ServerList = {
	data: {
		attributes: {
			identifier: string;
			name: string;
			description: string;
			node: string;
			server_owner: boolean;
			status?: string | null;
			is_suspended?: boolean;
		};
	}[];
	meta?: { pagination?: { current_page: number; total_pages: number } };
};

export async function listPanelServers(
	conf: PanelConf = config,
): Promise<PanelServer[]> {
	// Root admins can list every server on the panel with `type=admin-all`; for anyone else the
	// panel ignores it or refuses, so fall back to the servers the account owns or has access to.
	try {
		return await listServers("&type=admin-all", conf);
	} catch (e) {
		if (!(e instanceof PanelError) || ![400, 403, 404].includes(e.status ?? 0))
			throw e;
		return listServers("", conf);
	}
}

async function listServers(
	query: string,
	conf: PanelConf,
): Promise<PanelServer[]> {
	const out: PanelServer[] = [];
	for (let page = 1; ; page++) {
		const body = (await (
			await api(`?page=${page}${query}`, {}, conf)
		).json()) as ServerList;
		for (const { attributes: a } of body.data)
			out.push({
				identifier: a.identifier,
				name: a.name,
				description: a.description,
				node: a.node,
				isOwner: a.server_owner,
				status: a.status ?? null,
				suspended: a.is_suspended === true || a.status === "suspended",
			});
		if (page >= (body.meta?.pagination?.total_pages ?? 1)) break;
	}
	return out;
}

const STATE_TTL_MS = 30_000;
const stateCache = new Map<string, { at: number; list: PanelServer[] }>();

/**
 * One server's state on the panel, from the server list (which, unlike a server's own endpoints,
 * still answers for a suspended server). The list is cached briefly so a round of syncs of many
 * servers asks once. Null if the panel does not list it.
 */
export async function getPanelServerState(
	identifier: string,
	conf: PanelConf = config,
): Promise<PanelServer | null> {
	const key = `${conf.panelUrl}|${conf.panelKey}`;
	let hit = stateCache.get(key);
	if (!hit || Date.now() - hit.at > STATE_TTL_MS) {
		hit = { at: Date.now(), list: await listPanelServers(conf) };
		stateCache.set(key, hit);
	}
	return hit.list.find((s) => s.identifier === identifier) ?? null;
}

const accountUsernames = new Map<string, string>();

/** The panel username the API key belongs to: the account half of the SFTP login. */
export async function getAccountUsername(
	conf: PanelConf = config,
): Promise<string> {
	const key = `${conf.panelUrl}|${conf.panelKey}`;
	const hit = accountUsernames.get(key);
	if (hit) return hit;
	const res = await api("/account", {}, conf);
	const body = (await res.json()) as { attributes?: { username?: string } };
	const name = body.attributes?.username;
	if (!name) throw new PanelError("panel did not report the account username");
	accountUsernames.set(key, name);
	return name;
}

export type SftpDetails = { ip: string; port: number };

const sftpDetails = new Map<string, SftpDetails>();

/** Where a server's SFTP listens, as the panel reports it. */
export async function getSftpDetails(
	identifier: string,
	conf: PanelConf = config,
): Promise<SftpDetails> {
	const hit = sftpDetails.get(identifier);
	if (hit) return hit;
	const res = await api(`/servers/${identifier}`, {}, conf);
	const body = (await res.json()) as {
		attributes: { sftp_details?: { ip?: string; port?: number } };
	};
	const d = body.attributes.sftp_details;
	if (!d?.ip || !d.port)
		throw new PanelError("panel did not report SFTP details");
	const out = { ip: d.ip, port: d.port };
	sftpDetails.set(identifier, out);
	return out;
}

type FileList = {
	data: {
		attributes: {
			name: string;
			size: number;
			is_file: boolean;
			modified_at: string;
		};
	}[];
};

export class PterodactylFetcher implements Fetcher {
	constructor(
		private readonly id: string,
		private readonly conf: PanelConf = config,
	) {}

	async list(dir: string): Promise<RemoteFile[]> {
		try {
			const res = await api(
				`/servers/${this.id}/files/list?directory=${encodeURIComponent(dir)}`,
				{},
				this.conf,
			);
			const body = (await res.json()) as FileList;
			return body.data
				.filter((f) => f.attributes.is_file)
				.map((f) => ({
					name: f.attributes.name,
					size: f.attributes.size,
					mtimeMs: Date.parse(f.attributes.modified_at),
				}));
		} catch (e) {
			// A directory that does not exist (no crashes yet) is not an error.
			if (
				e instanceof PanelError &&
				(e.status === 404 || e.status === 500) &&
				dir !== "/"
			)
				return [];
			throw e;
		}
	}

	async download(path: string, dest: string): Promise<void> {
		const res = await api(
			`/servers/${this.id}/files/download?file=${encodeURIComponent(path)}`,
			{},
			this.conf,
		);
		const { attributes } = (await res.json()) as {
			attributes: { url: string };
		};
		const file = await fetch(attributes.url);
		if (!file.ok)
			throw new PanelError(`download ${path}: ${file.status}`, file.status);
		await Bun.write(dest, file);
	}
}

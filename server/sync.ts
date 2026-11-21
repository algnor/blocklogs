import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SyncProgress } from "../shared/api";
import { config, filesDir } from "./config";
import { db, type ServerRow } from "./db";
import { type Fetcher, makeFetcher, type RemoteFile } from "./fetchers";
import {
	getPanelServerState,
	PanelError,
	panelConfigured,
} from "./fetchers/pterodactyl";
import { getGame, type ParsedFile, type Source } from "./games";
import { announceData, announceServers, announceSync } from "./live";
import { activity } from "./log";
import { pool } from "./pool";
import { begin, end, isSyncing } from "./syncstate";

type FileRow = {
	id: number;
	kind: string;
	name: string;
	size: number;
	mtime: number;
	local_path: string;
};

/**
 * Runs `fn` over `items`, `limit` at a time. After a failure no new item is started, and it
 * resolves (rejecting with the first error) only once everything already started has finished,
 * so nothing is still running when the caller cleans up.
 */
async function mapLimit<T>(
	items: T[],
	limit: number,
	fn: (x: T) => Promise<void>,
) {
	let i = 0;
	let failure: { error: unknown } | null = null;
	const worker = async () => {
		while (i < items.length && !failure) {
			try {
				await fn(items[i++] as T);
			} catch (error) {
				failure ??= { error };
			}
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, worker),
	);
	if (failure) throw (failure as { error: unknown }).error;
}

function storePath(serverId: number, kind: string, name: string) {
	return join(
		filesDir,
		String(serverId),
		kind,
		name.endsWith(".gz") ? name : `${name}.gz`,
	);
}

async function gzipInPlace(path: string) {
	const raw = new Uint8Array(await Bun.file(path).arrayBuffer());
	if (raw[0] === 0x1f && raw[1] === 0x8b) return;
	await Bun.write(path, Bun.gzipSync(raw));
}

/** Replace what is stored for one file with a fresh parse. */
function store(
	serverId: number,
	src: Source,
	name: string,
	rf: RemoteFile,
	localPath: string,
	parsed: ParsedFile,
) {
	db.transaction(() => {
		db.query("DELETE FROM files WHERE server_id=? AND kind=? AND name=?").run(
			serverId,
			src.kind,
			name,
		);
		const fid = db
			.query(
				`INSERT INTO files(server_id, kind, name, size, mtime, local_path, lines, events, error)
				 VALUES (?,?,?,?,?,?,?,?,?) RETURNING id`,
			)
			.get(
				serverId,
				src.kind,
				name,
				rf.size,
				rf.mtimeMs,
				localPath,
				parsed.lines,
				parsed.events.length,
				parsed.error,
			) as { id: number };
		const ev = db.query("INSERT INTO events VALUES (?,?,?,?,?,?,?)");
		for (const e of parsed.events)
			ev.run(serverId, fid.id, e.line, e.ts, e.type, e.player, e.data);
		if (parsed.crash) {
			const c = parsed.crash;
			db.query("INSERT INTO crash_reports VALUES (?,?,?,?,?,?,?,?)").run(
				fid.id,
				serverId,
				c.ts,
				c.side,
				c.loader,
				c.description,
				c.exception,
				c.suspects,
			);
		}
		if (parsed.usercache) {
			const up = db.query("INSERT OR REPLACE INTO usercache VALUES (?,?,?)");
			for (const u of parsed.usercache) up.run(serverId, u.name, u.uuid);
		}
	})();
}

const kb = (n: number) =>
	n >= 1_048_576
		? `${(n / 1_048_576).toFixed(1)} MB`
		: `${Math.max(1, Math.round(n / 1024))} KB`;
const PHASES: Record<string, string> = {
	listing: "listing files",
	downloading: "downloading and parsing",
	sessions: "rebuilding sessions",
};
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

type Run = {
	server: ServerRow;
	p: SyncProgress;
	/** Tell followers the progress changed. Call after every change to `p`. */
	touch: () => void;
	log: (level: "info" | "warn" | "error", message: string) => void;
};

/**
 * The one place a job's lifecycle lives: it can't start twice for a server, followers hear when
 * it starts, every step and when it ends, and it always ends, whatever the job does.
 */
async function runJob(
	serverId: number,
	what: string,
	job: (r: Run) => Promise<{ changed: boolean }>,
): Promise<void> {
	if (isSyncing(serverId)) return;
	const server = db
		.query("SELECT * FROM servers WHERE id=?")
		.get(serverId) as ServerRow | null;
	if (!server) return;
	const p = begin(serverId);
	const log: Run["log"] = (level, message) =>
		activity(serverId, level, `${server.name}: ${message}`);
	db.query(
		"UPDATE servers SET last_sync_status='running', last_sync_error=NULL WHERE id=?",
	).run(serverId);
	log("info", `${what} started`);
	announceServers();
	announceSync();

	let changed = false;
	let failure: string | null = null;
	try {
		changed = (await job({ server, p, touch: announceSync, log })).changed;
	} catch (e) {
		failure = (e as Error).message || String(e);
	}

	const failedIn = PHASES[p.phase] ?? p.phase;
	p.phase = failure ? "error" : "done";
	const errors = p.errors;
	const status = failure || errors ? "error" : "ok";
	const message =
		failure ??
		(errors ? `${errors} file(s) failed, see the activity log` : null);
	db.query(
		"UPDATE servers SET last_sync_status=?, last_sync_error=?, last_sync_at=? WHERE id=?",
	).run(status, message, new Date().toISOString(), serverId);
	const took = secs(Date.now() - p.startedAt);
	if (failure)
		log("error", `${what} failed after ${took}, while ${failedIn}: ${failure}`);
	else if (errors)
		log("warn", `${what} finished in ${took} with ${errors} failed file(s)`);
	else
		log(
			"info",
			`${what} finished in ${took}${p.total ? `: ${p.total} file(s)` : ": nothing new"}`,
		);
	end(serverId);
	if (changed) announceData();
	else announceServers();
	announceSync();
}

export function syncServer(serverId: number): Promise<void> {
	return runJob(serverId, "Sync", async ({ server, p, touch, log }) => {
		const game = getGame(server.game);
		// A suspended server's files can't be read, and the failure (a refused SFTP login)
		// does not say why, so ask the panel first. If the panel can't be asked, carry on.
		if (server.backend !== "local" && server.panel_id && panelConfigured()) {
			const state = await getPanelServerState(server.panel_id).catch(
				() => null,
			);
			if (state?.suspended)
				throw new Error(
					"suspended on the panel, so its files can't be read until it is unsuspended",
				);
			if (state?.status)
				log("warn", `The panel reports this server as ${state.status}`);
		}
		let source: Fetcher | undefined;
		try {
			source = makeFetcher(server);
			const remoteFiles = source;

			type Todo = { src: Source; rf: RemoteFile; dir: string };
			const todo: Todo[] = [];
			for (const src of game.sources) {
				const dir = (src.configDir ? server[src.configDir] : null) ?? src.dir;
				const remote = (await remoteFiles.list(dir)).filter((f) =>
					src.match.test(f.name),
				);
				const known = new Map(
					(
						db
							.query(
								"SELECT name, size, mtime FROM files WHERE server_id=? AND kind=?",
							)
							.all(server.id, src.kind) as FileRow[]
					).map((r) => [r.name, r]),
				);
				let fresh = 0;
				for (const rf of remote) {
					const k = known.get(rf.name);
					if (!k || k.size !== rf.size || k.mtime !== rf.mtimeMs) {
						todo.push({ src, rf, dir });
						fresh++;
					}
				}
				log(
					"info",
					`${dir}: ${remote.length} file(s), ${fresh} new or changed`,
				);
			}

			p.phase = "downloading";
			p.total = todo.length;
			touch();
			let logsChanged = false;
			let stored = 0;

			await mapLimit(todo, config.downloads, async ({ src, rf, dir }) => {
				const path = `${dir.replace(/\/+$/, "")}/${rf.name}`;
				const dest = storePath(server.id, src.kind, rf.name);
				try {
					p.current = rf.name;
					touch();
					log("info", `Downloading ${rf.name} (${kb(rf.size)})`);
					const t0 = Date.now();
					await mkdir(dirname(dest), { recursive: true });
					const tmp = `${dest}.part`;
					await remoteFiles.download(path, tmp);
					await gzipInPlace(tmp);
					await rename(tmp, dest);
					const t1 = Date.now();
					const parsed = await pool.run(game.id, {
						kind: src.kind,
						path: dest,
						name: rf.name,
						mtimeMs: rf.mtimeMs,
					});
					store(server.id, src, rf.name, rf, dest, parsed);
					stored++;
					if (src.kind === "log") logsChanged = true;
					if (parsed.error) {
						p.errors++;
						log(
							"warn",
							`${rf.name} is damaged, kept what could be read (${parsed.events.length} events): ${parsed.error}`,
						);
					} else {
						log(
							"info",
							`${rf.name}: ${parsed.events.length} event(s), downloaded in ${secs(t1 - t0)}, parsed in ${secs(Date.now() - t1)}`,
						);
					}
				} catch (e) {
					p.errors++;
					log("error", `${rf.name}: ${(e as Error).message}`);
					await rm(`${dest}.part`, { force: true });
					// Credentials and an exhausted rate limit will fail every other file too.
					if (
						todo.length === 1 ||
						(e instanceof PanelError && [401, 403, 429].includes(e.status ?? 0))
					)
						throw e;
				} finally {
					p.done++;
					touch();
				}
			});

			p.phase = "sessions";
			p.current = null;
			touch();
			let sessionsChanged = false;
			if (logsChanged || todo.length === 0) {
				const r = game.rebuildSessions(db, server.id);
				sessionsChanged = true;
				log(
					"info",
					`Sessions rebuilt: ${r.sessions}${r.online.length ? `; online now: ${r.online.join(", ")}` : ""}`,
				);
			}
			return { changed: stored > 0 || sessionsChanged };
		} finally {
			await source?.close?.().catch(() => {});
		}
	});
}

/** Re-parse every stored file of a server from disk (after the parser changed). */
export function reparseServer(serverId: number): Promise<void> {
	return runJob(serverId, "Re-parse", async ({ server, p, touch, log }) => {
		const game = getGame(server.game);
		const rows = db
			.query("SELECT * FROM files WHERE server_id=?")
			.all(server.id) as FileRow[];
		p.phase = "downloading";
		p.total = rows.length;
		touch();
		await mapLimit(rows, config.workers, async (r) => {
			try {
				p.current = r.name;
				touch();
				const src = game.sources.find((s) => s.kind === r.kind) as Source;
				const parsed = await pool.run(game.id, {
					kind: src.kind,
					path: r.local_path,
					name: r.name,
					mtimeMs: r.mtime,
				});
				store(
					server.id,
					src,
					r.name,
					{ name: r.name, size: r.size, mtimeMs: r.mtime },
					r.local_path,
					parsed,
				);
				if (parsed.error) {
					p.errors++;
					log("warn", `${r.name} is damaged: ${parsed.error}`);
				}
			} catch (e) {
				p.errors++;
				log("error", `${r.name}: ${(e as Error).message}`);
			} finally {
				p.done++;
				touch();
			}
		});
		p.phase = "sessions";
		p.current = null;
		touch();
		const r = game.rebuildSessions(db, server.id);
		log("info", `Sessions rebuilt: ${r.sessions}`);
		return { changed: true };
	});
}

/** Starts a sync for every enabled server that is due one. */
export function startScheduler() {
	const tick = () => {
		const due = db
			.query(
				`SELECT id, name FROM servers WHERE enabled=1 AND panel_id IS NOT NULL AND
				 (last_sync_at IS NULL OR (julianday('now') - julianday(last_sync_at)) * 1440 >= sync_interval_min)`,
			)
			.all() as { id: number; name: string }[];
		for (const { id } of due) {
			if (isSyncing(id)) continue;
			void syncServer(id).catch((e) =>
				activity(id, "error", `Sync could not start: ${(e as Error).message}`),
			);
		}
	};
	setTimeout(tick, 5_000);
	return setInterval(tick, config.schedulerTickMs);
}

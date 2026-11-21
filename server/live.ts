import type { ServerSummary } from "../shared/api";
import type { OnlineEvent, ServersEvent, SyncEvent } from "../shared/events";
import { db, type ServerRow } from "./db";
import { hub } from "./hub";
import * as stats from "./stats";
import { isSyncing, progress, runningSyncs } from "./syncstate";

/*
 * Everything the server tells clients goes through here, so what changed and who hears of it is
 * in one place:
 *   announceServers()  a server was added, edited or removed, or its sync state changed
 *   announceSync()     a running sync made progress
 *   announceData()     data was ingested or removed: stats are stale, so servers, online and
 *                      `data` (fetch again) all follow
 * Snapshots (what a client is sent on subscribing) are built from the database and the sync
 * state, never from what was last announced, so a client can't be told something stale.
 */

const STATS_TTL_MS = 30_000;
let statsCache: { at: number; value: Map<number, stats.ServerStats> } | null =
	null;

function cachedStats() {
	if (!statsCache || Date.now() - statsCache.at > STATS_TTL_MS)
		statsCache = { at: Date.now(), value: stats.serverStats() };
	return statsCache.value;
}

export function summarize(
	row: ServerRow,
	st: Map<number, stats.ServerStats>,
	online: { serverId: number; player: string }[],
): ServerSummary {
	const s = st.get(row.id);
	return {
		id: row.id,
		name: row.name,
		game: row.game,
		backend: row.backend,
		panelId: row.panel_id,
		logDir: row.log_dir,
		crashDir: row.crash_dir,
		syncIntervalMin: row.sync_interval_min,
		enabled: Boolean(row.enabled),
		lastSyncAt: row.last_sync_at,
		lastSyncStatus: isSyncing(row.id)
			? "running"
			: (row.last_sync_status as ServerSummary["lastSyncStatus"]),
		lastSyncError: row.last_sync_error,
		progress: isSyncing(row.id) ? (progress.get(row.id) ?? null) : null,
		online: online.filter((o) => o.serverId === row.id).map((o) => o.player),
		players: s?.players ?? 0,
		sessions: s?.sessions ?? 0,
		hoursTotal: s?.hoursTotal ?? 0,
		hours7d: s?.hours7d ?? 0,
		hours30d: s?.hours30d ?? 0,
		crashes: s?.crashes ?? 0,
		files: s?.files ?? 0,
		lastEventAt: s?.lastEventAt ?? null,
	};
}

export function serversSnapshot(): ServersEvent {
	const rows = db
		.query("SELECT * FROM servers ORDER BY name COLLATE NOCASE")
		.all() as ServerRow[];
	const st = cachedStats();
	const online = stats.onlineNow();
	return { servers: rows.map((r) => summarize(r, st, online)) };
}

export const syncSnapshot = (): SyncEvent => ({ running: runningSyncs() });
export const onlineSnapshot = (): OnlineEvent => ({
	online: stats.onlineNow(),
});

export function announceServers() {
	hub.emit("servers", serversSnapshot());
}

export function announceSync() {
	hub.emit("sync", syncSnapshot());
}

export function announceData() {
	statsCache = null;
	hub.emit("data", {});
	hub.emit("online", onlineSnapshot());
	announceServers();
}

/**
 * Who is online also changes with time alone: a session ages out of the window with nothing
 * written. Looks every few seconds and announces a change.
 */
export function startLive(everyMs = 15_000) {
	let last = JSON.stringify(onlineSnapshot());
	return setInterval(() => {
		const now = JSON.stringify(onlineSnapshot());
		if (now === last) return;
		last = now;
		hub.emit("online", JSON.parse(now));
		announceServers();
	}, everyMs);
}

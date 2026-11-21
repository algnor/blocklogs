import type {
	Activity,
	ActivitySlice,
	CrashList,
	GeoBucket,
	GeoReport,
	MessageList,
	MessageRow,
	Overview,
	PlayerIp,
	PlayerList,
	PlayerProfile,
	PlayerRow,
	ServerInfo,
	SessionList,
	SessionRow,
} from "../shared/api";
import { db } from "./db";
import { fmtTs, ONLINE_WINDOW_MS, parseTs } from "./games/minecraft";
import { lookup } from "./geo";

export type Filter = {
	servers: number[] | null;
	since?: string;
	until?: string;
};

type Arg = string | number;

/** WHERE fragments for a server list and a time range on column `tsCol`. */
function where(
	f: Filter,
	tsCol: string,
	extra: string[] = [],
	args: Arg[] = [],
) {
	const parts = [...extra];
	const a = [...args];
	if (f.servers) {
		if (f.servers.length === 0) parts.push("0");
		else parts.push(`server_id IN (${f.servers.map(() => "?").join(",")})`);
		a.push(...f.servers);
	}
	if (f.since) {
		parts.push(`${tsCol} >= ?`);
		a.push(f.since);
	}
	if (f.until) {
		parts.push(`${tsCol} < ?`);
		a.push(f.until);
	}
	return { sql: parts.length ? `WHERE ${parts.join(" AND ")}` : "", args: a };
}

function getOrSet<K, V>(map: Map<K, V>, key: K, make: () => V): V {
	let v = map.get(key);
	if (v === undefined) {
		v = make();
		map.set(key, v);
	}
	return v;
}

const hours = (secs: number) => Math.round((secs / 3600) * 100) / 100;
const q = <T>(sql: string, ...args: Arg[]) => db.query(sql).all(...args) as T[];
const one = <T>(sql: string, ...args: Arg[]) => db.query(sql).get(...args) as T;
const like = (s: string) => `%${s.replace(/[\\%_]/g, "\\$&")}%`;

const onlineCutoff = () => fmtTs(Date.now() - ONLINE_WINDOW_MS);

export function onlineNow(): { serverId: number; player: string }[] {
	return q<{ server_id: number; player: string }>(
		"SELECT server_id, player FROM sessions WHERE closed_by='open' AND end >= ? ORDER BY player",
		onlineCutoff(),
	).map((r) => ({ serverId: r.server_id, player: r.player }));
}

export function overview(): Overview {
	const t = one<{ sessions: number; secs: number; players: number }>(
		"SELECT COUNT(*) AS sessions, COALESCE(SUM(secs),0) AS secs, COUNT(DISTINCT player) AS players FROM sessions",
	);
	const w = one<{ secs: number }>(
		"SELECT COALESCE(SUM(secs),0) AS secs FROM sessions WHERE start >= ?",
		fmtTs(Date.now() - 7 * 86400_000),
	);
	const c = one<{ n: number }>(
		"SELECT COUNT(*) AS n FROM crash_reports WHERE ts >= ?",
		fmtTs(Date.now() - 7 * 86400_000),
	);
	return {
		servers: one<{ n: number }>("SELECT COUNT(*) AS n FROM servers").n,
		players: t.players,
		sessions: t.sessions,
		hoursTotal: hours(t.secs),
		hours7d: hours(w.secs),
		online: onlineNow(),
		crashes7d: c.n,
	};
}

export type ServerStats = {
	players: number;
	sessions: number;
	hoursTotal: number;
	hours7d: number;
	hours30d: number;
	crashes: number;
	files: number;
	lastEventAt: string | null;
};

export function serverStats(): Map<number, ServerStats> {
	const out = new Map<number, ServerStats>();
	const get = (id: number) =>
		getOrSet(out, id, () => ({
			players: 0,
			sessions: 0,
			hoursTotal: 0,
			hours7d: 0,
			hours30d: 0,
			crashes: 0,
			files: 0,
			lastEventAt: null as string | null,
		}));
	const d7 = fmtTs(Date.now() - 7 * 86400_000);
	const d30 = fmtTs(Date.now() - 30 * 86400_000);
	for (const r of q<{
		server_id: number;
		players: number;
		sessions: number;
		secs: number;
		s7: number;
		s30: number;
	}>(
		`SELECT server_id, COUNT(DISTINCT player) AS players, COUNT(*) AS sessions, SUM(secs) AS secs,
		        SUM(CASE WHEN start >= ? THEN secs ELSE 0 END) AS s7,
		        SUM(CASE WHEN start >= ? THEN secs ELSE 0 END) AS s30
		 FROM sessions GROUP BY server_id`,
		d7,
		d30,
	)) {
		const s = get(r.server_id);
		Object.assign(s, {
			players: r.players,
			sessions: r.sessions,
			hoursTotal: hours(r.secs),
			hours7d: hours(r.s7),
			hours30d: hours(r.s30),
		});
	}
	for (const r of q<{ server_id: number; n: number }>(
		"SELECT server_id, COUNT(*) AS n FROM crash_reports GROUP BY server_id",
	))
		get(r.server_id).crashes = r.n;
	for (const r of q<{ server_id: number; n: number }>(
		"SELECT server_id, COUNT(*) AS n FROM files GROUP BY server_id",
	))
		get(r.server_id).files = r.n;
	for (const r of q<{ server_id: number; ts: string }>(
		"SELECT server_id, MAX(ts) AS ts FROM events WHERE type='eof' GROUP BY server_id",
	))
		get(r.server_id).lastEventAt = r.ts;
	return out;
}

// ------------------------------------------------------------------ players

export function players(
	f: Filter,
	opts: {
		q?: string;
		sort?: string;
		dir?: string;
		limit: number;
		offset: number;
	},
): PlayerList {
	const extra: string[] = [];
	const extraArgs: Arg[] = [];
	if (opts.q) {
		extra.push("player LIKE ? ESCAPE '\\'");
		extraArgs.push(like(opts.q));
	}
	const sw = where(f, "start", extra, extraArgs);
	const ew = (type: string[]) =>
		where(
			f,
			"ts",
			[`type IN (${type.map((t) => `'${t}'`).join(",")})`, ...extra],
			extraArgs,
		);

	const base = new Map<string, PlayerRow>();
	const servers = new Map<string, Set<number>>();
	for (const r of q<{
		player: string;
		server_id: number;
		sessions: number;
		secs: number;
		first: string;
		last: string;
	}>(
		`SELECT player, server_id, COUNT(*) AS sessions, SUM(secs) AS secs, MIN(start) AS first, MAX(end) AS last
		 FROM sessions ${sw.sql} GROUP BY player, server_id`,
		...sw.args,
	)) {
		const p = getOrSet(base, r.player, () => ({
			player: r.player,
			serverIds: [] as number[],
			sessions: 0,
			hours: 0,
			firstSeen: r.first,
			lastSeen: r.last,
			messages: 0,
			commands: 0,
			distinctIps: 0,
		}));
		p.sessions += r.sessions;
		p.hours += r.secs / 3600;
		if (r.first < p.firstSeen) p.firstSeen = r.first;
		if (r.last > p.lastSeen) p.lastSeen = r.last;
		getOrSet(servers, r.player, () => new Set<number>()).add(r.server_id);
	}
	const e = ew(["chat", "cmd"]);
	for (const r of q<{ player: string; type: string; n: number }>(
		`SELECT player, type, COUNT(*) AS n FROM events ${e.sql} GROUP BY player, type`,
		...e.args,
	)) {
		const p = base.get(r.player);
		if (!p) continue;
		if (r.type === "chat") p.messages = r.n;
		else p.commands = r.n;
	}
	const ipw = where(f, "start", ["ip IS NOT NULL", ...extra], extraArgs);
	for (const r of q<{ player: string; n: number }>(
		`SELECT player, COUNT(DISTINCT ip) AS n FROM sessions ${ipw.sql} GROUP BY player`,
		...ipw.args,
	)) {
		const p = base.get(r.player);
		if (p) p.distinctIps = r.n;
	}

	const rows = [...base.values()].map((p) => ({
		...p,
		hours: Math.round(p.hours * 100) / 100,
		serverIds: [...(servers.get(p.player) ?? [])].sort((a, b) => a - b),
	}));
	const key = (opts.sort ?? "hours") as keyof PlayerRow;
	const dir = opts.dir === "asc" ? 1 : -1;
	rows.sort((a, b) => {
		const x = a[key];
		const y = b[key];
		const c =
			typeof x === "string"
				? (x as string).localeCompare(y as string, undefined, {
						sensitivity: "base",
					})
				: (x as number) - (y as number);
		return c * dir || a.player.localeCompare(b.player);
	});
	return {
		total: rows.length,
		rows: rows.slice(opts.offset, opts.offset + opts.limit),
	};
}

type SessionDb = {
	server_id: number;
	player: string;
	start: string;
	end: string;
	secs: number;
	ip: string | null;
	closed_by: SessionRow["closedBy"];
};

const toSession = (r: SessionDb): SessionRow => ({
	serverId: r.server_id,
	player: r.player,
	start: r.start,
	end: r.end,
	secs: r.secs,
	ip: r.ip,
	country: r.ip ? lookup(r.ip).country : null,
	closedBy: r.closed_by,
});

export function sessions(
	f: Filter,
	opts: { player?: string; limit: number; offset: number },
): SessionList {
	const w = where(
		f,
		"start",
		opts.player ? ["player = ? COLLATE NOCASE"] : [],
		opts.player ? [opts.player] : [],
	);
	const total = one<{ n: number }>(
		`SELECT COUNT(*) AS n FROM sessions ${w.sql}`,
		...w.args,
	).n;
	const rows = q<SessionDb>(
		`SELECT * FROM sessions ${w.sql} ORDER BY start DESC LIMIT ? OFFSET ?`,
		...w.args,
		opts.limit,
		opts.offset,
	);
	return { total, rows: rows.map(toSession) };
}

type MsgDb = {
	server_id: number;
	ts: string;
	player: string;
	type: "chat" | "cmd";
	data: string;
};
const toMsg = (r: MsgDb): MessageRow => ({
	serverId: r.server_id,
	ts: r.ts,
	player: r.player,
	type: r.type,
	text: r.data,
});

export function messages(
	f: Filter,
	opts: {
		type?: "chat" | "cmd";
		player?: string;
		q?: string;
		limit: number;
		offset: number;
	},
): MessageList {
	const extra = [
		opts.type ? `type = '${opts.type}'` : "type IN ('chat','cmd')",
	];
	const args: Arg[] = [];
	if (opts.player) {
		extra.push("player = ? COLLATE NOCASE");
		args.push(opts.player);
	}
	if (opts.q) {
		extra.push("data LIKE ? ESCAPE '\\'");
		args.push(like(opts.q));
	}
	const w = where(f, "ts", extra, args);
	const total = one<{ n: number }>(
		`SELECT COUNT(*) AS n FROM events ${w.sql}`,
		...w.args,
	).n;
	const rows = q<MsgDb>(
		`SELECT server_id, ts, player, type, data FROM events ${w.sql} ORDER BY ts DESC, file_id DESC, line DESC LIMIT ? OFFSET ?`,
		...w.args,
		opts.limit,
		opts.offset,
	);
	return { total, rows: rows.map(toMsg) };
}

export function playerProfile(name: string, f: Filter): PlayerProfile | null {
	const exact = one<{ player: string } | null>(
		"SELECT player FROM sessions WHERE player = ? COLLATE NOCASE LIMIT 1",
		name,
	);
	const uc = q<{ name: string }>(
		"SELECT name FROM usercache WHERE name = ? COLLATE NOCASE LIMIT 1",
		name,
	)[0];
	const player = exact?.player ?? uc?.name;
	if (!player) return null;

	const sw = where(f, "start", ["player = ?"], [player]);
	const perServer = q<{
		server_id: number;
		sessions: number;
		secs: number;
		first: string;
		last: string;
	}>(
		`SELECT server_id, COUNT(*) AS sessions, SUM(secs) AS secs, MIN(start) AS first, MAX(end) AS last
		 FROM sessions ${sw.sql} GROUP BY server_id ORDER BY secs DESC`,
		...sw.args,
	).map((r) => {
		const counts = q<{ type: string; n: number }>(
			"SELECT type, COUNT(*) AS n FROM events WHERE server_id=? AND player=? AND type IN ('chat','cmd') GROUP BY type",
			r.server_id,
			player,
		);
		return {
			serverId: r.server_id,
			sessions: r.sessions,
			hours: hours(r.secs),
			firstSeen: r.first,
			lastSeen: r.last,
			messages: counts.find((c) => c.type === "chat")?.n ?? 0,
			commands: counts.find((c) => c.type === "cmd")?.n ?? 0,
		};
	});

	const uuids: PlayerProfile["uuids"] = [];
	for (const r of q<{ server_id: number; data: string }>(
		"SELECT DISTINCT server_id, data FROM events WHERE type='uuid' AND player=?",
		player,
	))
		uuids.push({ uuid: r.data, serverId: r.server_id, source: "log" });
	for (const r of q<{ server_id: number; uuid: string }>(
		"SELECT server_id, uuid FROM usercache WHERE name = ? COLLATE NOCASE",
		player,
	))
		uuids.push({ uuid: r.uuid, serverId: r.server_id, source: "usercache" });

	const ipw = where(f, "start", ["player = ?", "ip IS NOT NULL"], [player]);
	const ips: PlayerIp[] = q<{
		ip: string;
		logins: number;
		first: string;
		last: string;
	}>(
		`SELECT ip, COUNT(*) AS logins, MIN(start) AS first, MAX(start) AS last FROM sessions ${ipw.sql} GROUP BY ip ORDER BY last DESC`,
		...ipw.args,
	).map((r) => {
		const g = lookup(r.ip);
		return {
			ip: r.ip,
			country: g.country,
			countryName: g.countryName,
			logins: r.logins,
			firstSeen: r.first,
			lastSeen: r.last,
		};
	});

	return {
		player,
		uuids,
		perServer,
		ips,
		recentSessions: sessions(f, { player, limit: 20, offset: 0 }).rows,
		recentMessages: messages(f, { player, limit: 20, offset: 0 }).rows,
	};
}

// ------------------------------------------------------------------ geo

type Bucket = { secs: number; players: Map<string, number>; sessions: number };
const newBucket = (): Bucket => ({ secs: 0, players: new Map(), sessions: 0 });
function addTo(b: Bucket, player: string, secs: number, n: number) {
	b.secs += secs;
	b.players.set(player, (b.players.get(player) ?? 0) + secs);
	b.sessions += n;
}

export function geo(f: Filter, perPlayer: boolean): GeoReport {
	const w = where(f, "start", ["ip IS NOT NULL"]);
	const rows = q<{ player: string; ip: string; secs: number }>(
		`SELECT player, ip, secs FROM sessions ${w.sql}`,
		...w.args,
	);

	type G = ReturnType<typeof lookup>;
	const pg = new Map<string, Map<string, { g: G; secs: number; n: number }>>();
	for (const r of rows) {
		const g = lookup(r.ip);
		const key = `${g.country}|${g.continent}`;
		const m = getOrSet(
			pg,
			r.player,
			() => new Map<string, { g: G; secs: number; n: number }>(),
		);
		const e = m.get(key) ?? { g, secs: 0, n: 0 };
		e.secs += r.secs;
		e.n++;
		m.set(key, e);
	}
	if (perPlayer)
		for (const [player, m] of pg) {
			const list = [...m.values()];
			const main = list.reduce((a, b) => (b.secs > a.secs ? b : a));
			const tot = {
				g: main.g,
				secs: list.reduce((s, x) => s + x.secs, 0),
				n: list.reduce((s, x) => s + x.n, 0),
			};
			pg.set(player, new Map([[`${main.g.country}|${main.g.continent}`, tot]]));
		}

	const conts = new Map<
		string,
		{
			name: string;
			b: Bucket;
			children: Map<string, { name: string; b: Bucket }>;
		}
	>();
	const countries = new Set<string>();
	for (const [player, m] of pg)
		for (const { g, secs, n } of m.values()) {
			const k = getOrSet(conts, g.continent, () => ({
				name: g.continentName,
				b: newBucket(),
				children: new Map<string, { name: string; b: Bucket }>(),
			}));
			addTo(k.b, player, secs, n);
			const c = getOrSet(k.children, g.country, () => ({
				name: g.countryName,
				b: newBucket(),
			}));
			addTo(c.b, player, secs, n);
			countries.add(g.country);
		}

	const total = [...conts.values()].reduce((s, k) => s + k.b.secs, 0);
	const fin = (code: string, name: string, b: Bucket): GeoBucket => ({
		code,
		name,
		secs: Math.round(b.secs),
		share: total ? Math.round((b.secs / total) * 10000) / 100 : 0,
		players: b.players.size,
		sessions: b.sessions,
		avgSecsPerPlayer: b.players.size ? Math.round(b.secs / b.players.size) : 0,
		topPlayers: [...b.players]
			.sort((a, b) => b[1] - a[1])
			.slice(0, 5)
			.map(([player, secs]) => ({ player, secs: Math.round(secs) })),
	});

	return {
		totalSecs: Math.round(total),
		totals: {
			continents: conts.size,
			countries: countries.size,
			players: pg.size,
			sessions: rows.length,
		},
		continents: [...conts]
			.sort((a, b) => b[1].b.secs - a[1].b.secs)
			.map(([code, k]) => ({
				...fin(code, k.name, k.b),
				countries: [...k.children]
					.sort((a, b) => b[1].b.secs - a[1].b.secs)
					.map(([cc, c]) => fin(cc, c.name, c.b)),
			})),
	};
}

// ------------------------------------------------------------------ activity

const LENGTHS: [string, number][] = [
	["< 1 min", 60],
	["1–5 min", 300],
	["5–15 min", 900],
	["15–30 min", 1800],
	["30–60 min", 3600],
	["1–2 h", 7200],
	["2–4 h", 14400],
	["4 h +", Number.POSITIVE_INFINITY],
];
/** Sessions longer than this are almost always a missed leave line, not real playtime. */
const MAX_SPREAD_MS = 24 * 3600_000;

type ActivityRow = {
	server_id: number;
	player: string;
	start: string;
	end: string;
	secs: number;
};

/** The three charts for some sessions, over the days `from`..`to` (ms), so slices line up. */
function activitySlice(
	rows: ActivityRow[],
	from: number,
	to: number,
): ActivitySlice {
	const day = new Map<
		string,
		{ players: Set<string>; sessions: number; secs: number }
	>();
	const hourSecs = new Array<number>(24).fill(0);
	const hourStarts = new Array<number>(24).fill(0);
	const lengths = new Array<number>(LENGTHS.length).fill(0);

	for (const r of rows) {
		const s = parseTs(r.start);
		const e = Math.min(parseTs(r.end), s + MAX_SPREAD_MS);
		const sh = new Date(s).getUTCHours();
		hourStarts[sh] = (hourStarts[sh] as number) + 1;
		const li = LENGTHS.findIndex(([, max]) => r.secs < max);
		lengths[li] = (lengths[li] as number) + 1;
		const startDate = r.start.slice(0, 10);
		const d0 = day.get(startDate) ?? {
			players: new Set(),
			sessions: 0,
			secs: 0,
		};
		d0.sessions++;
		day.set(startDate, d0);

		for (let t = s; t < e || t === s; ) {
			const hourEnd = Math.floor(t / 3600_000) * 3600_000 + 3600_000;
			const seg = Math.min(hourEnd, e) - t;
			const date = fmtTs(t).slice(0, 10);
			const d = day.get(date) ?? { players: new Set(), sessions: 0, secs: 0 };
			d.players.add(r.player);
			d.secs += seg / 1000;
			day.set(date, d);
			hourSecs[new Date(t).getUTCHours()] =
				(hourSecs[new Date(t).getUTCHours()] as number) + seg / 1000;
			if (seg <= 0) break;
			t += seg;
		}
	}

	const daily: ActivitySlice["daily"] = [];
	let nDays = 0;
	if (Number.isFinite(from) && Number.isFinite(to)) {
		for (
			let t = Math.floor(from / 86400_000) * 86400_000;
			t <= to;
			t += 86400_000
		) {
			const date = fmtTs(t).slice(0, 10);
			const d = day.get(date);
			daily.push({
				date,
				players: d?.players.size ?? 0,
				sessions: d?.sessions ?? 0,
				hours: hours(d?.secs ?? 0),
			});
			nDays++;
		}
	}

	return {
		daily,
		hourOfDay: hourSecs.map((secs, hour) => ({
			hour,
			avgPlayers: nDays ? Math.round((secs / 3600 / nDays) * 1000) / 1000 : 0,
			sessions: hourStarts[hour] as number,
		})),
		lengths: LENGTHS.map(([label], i) => ({
			label,
			count: lengths[i] as number,
		})),
	};
}

export function activity(f: Filter): Activity {
	const w = where(f, "start");
	const rows = q<ActivityRow>(
		`SELECT server_id, player, start, end, secs FROM sessions ${w.sql}`,
		...w.args,
	);

	let minMs = Number.POSITIVE_INFINITY;
	let maxMs = Number.NEGATIVE_INFINITY;
	for (const r of rows) {
		minMs = Math.min(minMs, parseTs(r.start));
		maxMs = Math.max(maxMs, parseTs(r.end));
	}
	const from = f.since ? Date.parse(`${f.since}T00:00:00Z`) : minMs;
	const to = f.until ? Date.parse(`${f.until}T00:00:00Z`) - 1 : maxMs;

	const perServer = new Map<number, ActivityRow[]>();
	for (const r of rows) getOrSet(perServer, r.server_id, () => []).push(r);
	const byServer: Activity["byServer"] = {};
	for (const [id, list] of [...perServer].sort((x, y) => x[0] - y[0]))
		byServer[id] = activitySlice(list, from, to);

	return { ...activitySlice(rows, from, to), byServer };
}

// ------------------------------------------------------------------ one server

export function serverInfo(serverId: number): ServerInfo {
	const sess = q<{
		player: string;
		start: string;
		end: string;
		secs: number;
		closed_by: string;
	}>(
		"SELECT player, start, end, secs, closed_by FROM sessions WHERE server_id=?",
		serverId,
	);

	let first: string | null = null;
	let last: string | null = null;
	let totalSecs = 0;
	let longest: ServerInfo["sessions"]["longest"] = null;
	const endedBy: Record<string, number> = {};
	const points: [number, 1 | -1][] = [];
	for (const r of sess) {
		if (first === null || r.start < first) first = r.start;
		if (last === null || r.end > last) last = r.end;
		totalSecs += r.secs;
		if (!longest || r.secs > longest.secs)
			longest = { player: r.player, secs: r.secs, start: r.start };
		endedBy[r.closed_by] = (endedBy[r.closed_by] ?? 0) + 1;
		const s = parseTs(r.start);
		points.push([s, 1], [Math.min(parseTs(r.end), s + 24 * 3600_000), -1]);
	}

	// Sweep the starts and ends in time order; at the same moment a leave comes before a join.
	points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	let now = 0;
	let peak: ServerInfo["peak"] = null;
	for (const [t, d] of points) {
		now += d;
		if (d === 1 && (!peak || now > peak.players))
			peak = { players: now, at: fmtTs(t) };
	}

	const files = one<{
		logs: number;
		crashes: number;
		meta: number;
		bytes: number | null;
		errors: number;
		last: string | null;
	}>(
		`SELECT SUM(kind='log') AS logs, SUM(kind='crash') AS crashes, SUM(kind='meta') AS meta,
		        SUM(size) AS bytes, SUM(error IS NOT NULL) AS errors, MAX(ingested_at) AS last
		 FROM files WHERE server_id=?`,
		serverId,
	);
	const ev = q<{ type: string; n: number }>(
		"SELECT type, COUNT(*) AS n FROM events WHERE server_id=? AND type IN ('chat','cmd','join') GROUP BY type",
		serverId,
	);
	const count = (t: string) => ev.find((e) => e.type === t)?.n ?? 0;

	return {
		range: { first, last },
		files: {
			logs: files.logs ?? 0,
			crashes: files.crashes ?? 0,
			meta: files.meta ?? 0,
			bytes: files.bytes ?? 0,
			withErrors: files.errors ?? 0,
			lastIngestedAt: files.last,
		},
		events: {
			chat: count("chat"),
			commands: count("cmd"),
			joins: count("join"),
		},
		sessions: {
			total: sess.length,
			avgSecs: sess.length ? Math.round(totalSecs / sess.length) : 0,
			longest,
			endedBy,
		},
		peak,
		usercache: one<{ n: number }>(
			"SELECT COUNT(*) AS n FROM usercache WHERE server_id=?",
			serverId,
		).n,
	};
}

// ------------------------------------------------------------------ crashes

export function crashes(
	f: Filter,
	opts: { limit: number; offset: number },
): CrashList {
	const w = where(f, "c.ts");
	const base = w.sql.replace(/server_id/g, "c.server_id");
	const total = one<{ n: number }>(
		`SELECT COUNT(*) AS n FROM crash_reports c ${base}`,
		...w.args,
	).n;
	const rows = q<{
		file_id: number;
		server_id: number;
		name: string;
		ts: string | null;
		side: "server" | "client";
		loader: string | null;
		description: string | null;
		exception: string | null;
		suspects: string | null;
	}>(
		`SELECT c.file_id, c.server_id, f.name, c.ts, c.side, c.loader, c.description, c.exception, c.suspects
		 FROM crash_reports c JOIN files f ON f.id = c.file_id ${base}
		 ORDER BY c.ts DESC LIMIT ? OFFSET ?`,
		...w.args,
		opts.limit,
		opts.offset,
	);
	return {
		total,
		rows: rows.map((r) => ({
			fileId: r.file_id,
			serverId: r.server_id,
			name: r.name,
			ts: r.ts,
			side: r.side,
			loader: r.loader,
			description: r.description,
			exception: r.exception,
			suspects: r.suspects,
		})),
	};
}

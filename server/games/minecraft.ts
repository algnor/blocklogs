import type { Database } from "bun:sqlite";
import type {
	CrashInfo,
	EventRow,
	GameParser,
	ParsedFile,
	ParseInput,
} from "./types";

// NeoForge: [07Oct2026 19:02:13.456] [Server thread/INFO] [net.minecraft.server.MinecraftServer/]: msg
const NF_LINE =
	/^\[(\d\d)([A-Za-z]{3})(\d{4}) (\d\d):(\d\d):(\d\d)\.(\d{3})\] \[([^\]]+)\] \[[^\]]*\]: (.*)/;
// Vanilla / Fabric: [19:02:13] [Server thread/INFO]: msg
const VA_LINE = /^\[(\d\d):(\d\d):(\d\d)\] \[([^\]]+)\]: (.*)/;

const JOIN = /^(\w{1,16})\[\/([0-9a-fA-F.:]+):\d+\] logged in/;
const LEAVE = /^(\w{1,16}) (?:left the game|lost connection)/;
const UUID = /^UUID of player (\w{1,16}) is ([0-9a-f-]{32,36})/;
// The name between <> is the *display* name: chat mods wrap it in ranks, emoji, nicknames or
// unresolved placeholders, so take anything and reduce it with chatName().
const CHAT = /^(?:\[Not Secure\] )?<([^>]{1,100})> (.*)/;
const CMD = /^(\w{1,16}) issued server command: (.*)/;
// Operator command feedback, `[Steve: Set own game mode to Creative Mode]`. Modern servers do not
// log the commands players type, but this shows what operators ran. `Server` and `Rcon` are not players.
const CMD_FEEDBACK = /^\[(\w{1,16}): (.+)\]$/;
const NOT_PLAYERS = new Set(["Server", "Rcon"]);
const BOOT = /^Starting minecraft server version\s*(\S+)?/;
const STOP = /^Stopping (?:the )?server/;

// Cheap pre-filter: a line has to contain one of these to be worth running the regexes on.
const KEYS =
	/> |logged in|left the game|lost connection|UUID of player|issued server command|Starting minecraft|Stopping|\]: \[\w{1,16}: /;

export const LOG_NAME = /^(\d{4})-(\d\d)-(\d\d)-(\d+)\.log\.gz$/;
const LATEST = "latest.log";

/** A session still open at the end of the data counts as online if the log was written this recently. */
export const ONLINE_WINDOW_MS = 15 * 60_000;

const MONTHS: Record<string, number> = {
	Jan: 1,
	Feb: 2,
	Mar: 3,
	Apr: 4,
	May: 5,
	Jun: 6,
	Jul: 7,
	Aug: 8,
	Sep: 9,
	Oct: 10,
	Nov: 11,
	Dec: 12,
};

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function fmtTs(ms: number): string {
	const d = new Date(ms);
	return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`;
}

export function parseTs(ts: string): number {
	return Date.parse(`${ts.replace(" ", "T")}Z`);
}

type State = { dayOffset: number; prevSecs: number };

/** -> [ts, message] or null. `base` is the UTC midnight (ms) of the log's first day. */
function splitLine(
	line: string,
	base: number,
	st: State,
): [string, string] | null {
	let m = NF_LINE.exec(line);
	if (m) {
		const mon = MONTHS[m[2] as string];
		if (!mon) return null;
		return [
			`${m[3]}-${pad(mon)}-${m[1]} ${m[4]}:${m[5]}:${m[6]}.${m[7]}`,
			m[9] as string,
		];
	}
	m = VA_LINE.exec(line);
	if (m) {
		const s = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
		if (s < st.prevSecs - 60) st.dayOffset++; // midnight rollover
		st.prevSecs = s;
		return [fmtTs(base + (st.dayOffset * 86400 + s) * 1000), m[5] as string];
	}
	return null;
}

type Classified = Pick<EventRow, "type" | "player" | "data">;

/**
 * The player a chat line is from, out of its display name: `🥈 Steve`, `AFK Steve`,
 * `%luckperms:prefix%Steve%luckperms:suffix%` and `[INVALID KEY x]Steve` all become `Steve`.
 * A `~` prefix marks a nickname, which can't be tied to an account, so it is kept. Null if
 * nothing that looks like a name is left.
 */
export function chatName(display: string): string | null {
	if (/^\w{1,16}$/.test(display)) return display;
	const cleaned = display
		.replace(/%[^%\s]*%/g, "")
		.replace(/\[[^\]]*\]/g, " ")
		.trim();
	const last = cleaned.split(/\s+/).pop() ?? "";
	const name = last.replace(/^[#@]+/, "");
	return /^~?\w{1,16}$/.test(name) && name !== "~" ? name : null;
}

function classify(msg: string): Classified | null {
	let x: RegExpExecArray | null = CHAT.exec(msg);
	if (x) {
		const player = chatName(x[1] as string);
		return player ? { type: "chat", player, data: x[2] as string } : null;
	}
	x = JOIN.exec(msg);
	if (x) return { type: "join", player: x[1] as string, data: x[2] as string };
	x = LEAVE.exec(msg);
	if (x) return { type: "leave", player: x[1] as string, data: null };
	x = UUID.exec(msg);
	if (x) return { type: "uuid", player: x[1] as string, data: x[2] as string };
	x = CMD.exec(msg);
	if (x) return { type: "cmd", player: x[1] as string, data: x[2] as string };
	x = CMD_FEEDBACK.exec(msg);
	if (x && !NOT_PLAYERS.has(x[1] as string))
		return { type: "cmd", player: x[1] as string, data: x[2] as string };
	x = BOOT.exec(msg);
	if (x) return { type: "boot", player: null, data: x[1] ?? null };
	if (STOP.test(msg)) return { type: "stop", player: null, data: null };
	return null;
}

async function* lines(path: string): AsyncGenerator<string> {
	const stream = Bun.file(path)
		.stream()
		.pipeThrough(new DecompressionStream("gzip"));
	const dec = new TextDecoder("utf-8");
	let rest = "";
	for await (const chunk of stream) {
		const parts = (rest + dec.decode(chunk, { stream: true })).split("\n");
		rest = parts.pop() as string;
		for (const p of parts) yield p;
	}
	rest += dec.decode();
	if (rest) yield rest;
}

const midnight = (ms: number) => ms - (((ms % 86400000) + 86400000) % 86400000);

async function parseLog(input: ParseInput): Promise<ParsedFile> {
	const named = LOG_NAME.exec(input.name);
	const live = input.name === `${LATEST}.gz` || input.name === LATEST;
	if (!named && !live) return { lines: 0, events: [], error: null };

	// The live log has no date in its name: assume it ends on the day it was last written, and
	// move back by however many midnights it crossed once we know.
	const base = named
		? Date.UTC(Number(named[1]), Number(named[2]) - 1, Number(named[3]))
		: midnight(input.mtimeMs);
	const st: State = { dayOffset: 0, prevSecs: -1 };
	const events: EventRow[] = [];
	let n = 0;
	let lastHeader: string | null = null;
	let error: string | null = null;
	const vanilla = new Set<EventRow>();

	try {
		for await (const raw of lines(input.path)) {
			n++;
			if (raw.charCodeAt(0) !== 91 /* [ */) continue; // stack traces, continuation lines
			lastHeader = raw;
			if (!KEYS.test(raw)) continue;
			const r = splitLine(raw, base, st);
			if (!r) continue;
			const [ts, msg] = r;
			const before = events.length;
			const ev = classify(msg);
			if (ev) events.push({ line: n, ts, ...ev });
			if (events.length > before && !NF_LINE.test(raw))
				vanilla.add(events[before] as EventRow);
		}
	} catch (e) {
		// Truncated or corrupt gzip: keep what was read.
		error = `${(e as Error).name}: ${(e as Error).message}`;
	}

	if (lastHeader) {
		const r = splitLine(lastHeader, base, st);
		if (r) {
			const eof: EventRow = {
				line: n + 1,
				ts: r[0],
				type: "eof",
				player: null,
				data: null,
			};
			events.push(eof);
			if (!NF_LINE.test(lastHeader)) vanilla.add(eof);
		}
	}

	if (live && st.dayOffset > 0) {
		const shift = st.dayOffset * 86400000;
		for (const e of vanilla) e.ts = fmtTs(parseTs(e.ts) - shift);
	}
	return { lines: n, events, error };
}

// ------------------------------------------------------------------ crash reports

const CRASH_NAME = /^crash-.*\.txt(\.gz)?$/;

async function readText(path: string): Promise<string> {
	const buf = new Uint8Array(await Bun.file(path).arrayBuffer());
	try {
		return new TextDecoder().decode(Bun.gunzipSync(buf));
	} catch {
		return new TextDecoder().decode(buf);
	}
}

export function parseCrashText(text: string, name: string): CrashInfo {
	const head = text.slice(0, 20000);
	const time = /^Time: (\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d)/m.exec(head);
	const desc = /^Description: (.*)$/m.exec(head);
	// First exception line after the description.
	const exc =
		/^((?:[\w$]+\.)+[\w$]*(?:Exception|Error|Throwable)[^\n]*)$/m.exec(head);
	const ver = text.slice(0, 60000);
	const loader = /NeoForge/i.test(ver)
		? "NeoForge"
		: /Fabric Loader|fabricloader/i.test(ver)
			? "Fabric"
			: /Forge/.test(ver)
				? "Forge"
				: /Quilt/.test(ver)
					? "Quilt"
					: null;
	const sus = /^[ \t]*Suspected Mods?: (.*)$/m.exec(text);
	const fromName = /crash-(\d{4}-\d\d-\d\d)_(\d\d)\.(\d\d)\.(\d\d)/.exec(name);
	return {
		ts: time
			? `${time[1]} ${time[2]}.000`
			: fromName
				? `${fromName[1]} ${fromName[2]}:${fromName[3]}:${fromName[4]}.000`
				: null,
		side: /-client\.txt/.test(name) ? "client" : "server",
		loader,
		description: desc?.[1]?.trim() ?? null,
		exception: exc?.[1]?.trim().slice(0, 500) ?? null,
		suspects:
			sus?.[1]?.trim() && sus[1].trim() !== "None"
				? sus[1].trim().slice(0, 500)
				: null,
	};
}

// ------------------------------------------------------------------ usercache

async function parseUsercache(path: string): Promise<ParsedFile> {
	try {
		const json = JSON.parse(await readText(path)) as {
			name?: string;
			uuid?: string;
		}[];
		const usercache = json
			.filter((u) => u.name && u.uuid)
			.map((u) => ({ name: u.name as string, uuid: u.uuid as string }));
		return { lines: usercache.length, events: [], usercache, error: null };
	} catch (e) {
		return { lines: 0, events: [], error: (e as Error).message };
	}
}

// ------------------------------------------------------------------ sessions

export function rebuildSessions(db: Database, serverId: number) {
	const open = new Map<string, { start: string; ip: string | null }>();
	const rows: [string, string, string, number, string | null, string][] = [];
	let prev: string | null = null;

	const close = (p: string, end: string, why: string) => {
		const o = open.get(p) as { start: string; ip: string | null };
		open.delete(p);
		const secs = Math.max((parseTs(end) - parseTs(o.start)) / 1000, 0);
		rows.push([p, o.start, end, secs, o.ip, why]);
	};

	const cur = db
		.query(
			`SELECT ts, type, player, data FROM events
			 WHERE server_id=? AND type IN ('join','leave','boot','stop','eof')
			 ORDER BY ts, file_id, line`,
		)
		.all(serverId) as {
		ts: string;
		type: string;
		player: string | null;
		data: string | null;
	}[];

	for (const { ts, type, player, data } of cur) {
		if (type === "join" && player) {
			if (open.has(player)) close(player, ts, "rejoin");
			open.set(player, { start: ts, ip: data });
		} else if (type === "leave" && player) {
			if (open.has(player)) close(player, ts, "leave");
		} else if (type === "boot") {
			for (const p of [...open.keys()]) close(p, prev ?? ts, "crash"); // restart without a clean stop
		} else if (type === "stop") {
			for (const p of [...open.keys()]) close(p, ts, "stop");
		}
		prev = ts;
	}

	// Still open at the end of the data: online now, if the last line is recent enough.
	const online: string[] = [];
	const recent = prev !== null && Date.now() - parseTs(prev) < ONLINE_WINDOW_MS;
	for (const p of [...open.keys()]) {
		if (recent) online.push(p);
		close(p, prev as string, "open");
	}

	const tx = db.transaction(() => {
		db.query("DELETE FROM sessions WHERE server_id=?").run(serverId);
		const ins = db.query("INSERT INTO sessions VALUES (?,?,?,?,?,?,?)");
		for (const r of rows) ins.run(serverId, ...r);
	});
	tx();
	return { sessions: rows.length, online: online.sort() };
}

export const minecraft: GameParser = {
	id: "minecraft",
	name: "Minecraft",
	sources: [
		{
			kind: "log",
			dir: "/logs",
			match: /^(\d{4}-\d\d-\d\d-\d+\.log\.gz|latest\.log)$/,
			configDir: "log_dir",
		},
		{
			kind: "crash",
			dir: "/crash-reports",
			match: CRASH_NAME,
			configDir: "crash_dir",
		},
		{ kind: "meta", dir: "/", match: /^usercache\.json$/ },
	],
	async parseFile(input) {
		if (input.kind === "log") return parseLog(input);
		if (input.kind === "crash") {
			const text = await readText(input.path);
			return {
				lines: text.split("\n").length,
				events: [],
				crash: parseCrashText(text, input.name),
				error: null,
			};
		}
		return parseUsercache(input.path);
	},
	rebuildSessions,
};

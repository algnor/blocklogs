import { rm } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import type {
	AppStatus,
	FileList,
	ImportResult,
	PanelServerRow,
	ServerInput,
} from "../shared/api";
import { config, filesDir } from "./config";
import { db, type ServerRow } from "./db";
import { listPanelServers, panelConfigured } from "./fetchers/pterodactyl";
import { sftpConfigured } from "./fetchers/sftp";
import { games } from "./games";
import { geoReady } from "./geo";
import { announceData, announceServers, serversSnapshot } from "./live";
import { activity } from "./log";
import * as stats from "./stats";
import { reparseServer, syncServer } from "./sync";
import { isSyncing } from "./syncstate";

class HttpError extends Error {
	constructor(
		readonly status: 400 | 404 | 409 | 502,
		message: string,
	) {
		super(message);
	}
}

const intParam = (v: string | undefined, def: number, max = 1000) => {
	const n = Number(v);
	return Number.isFinite(n) && v !== undefined && v !== ""
		? Math.min(Math.max(Math.trunc(n), 0), max)
		: def;
};

const DATE = /^\d{4}-\d\d-\d\d$/;

function filter(c: {
	req: { query: (k: string) => string | undefined };
}): stats.Filter {
	const s = c.req.query("servers");
	const since = c.req.query("since");
	const until = c.req.query("until");
	return {
		servers:
			s === undefined || s === ""
				? null
				: s.split(",").map(Number).filter(Number.isInteger),
		since: since && DATE.test(since) ? since : undefined,
		until: until && DATE.test(until) ? until : undefined,
	};
}

const allServers = () =>
	db
		.query("SELECT * FROM servers ORDER BY name COLLATE NOCASE")
		.all() as ServerRow[];
const getServer = (id: number) => {
	const r = db
		.query("SELECT * FROM servers WHERE id=?")
		.get(id) as ServerRow | null;
	if (!r) throw new HttpError(404, "no such server");
	return r;
};
const summaryOf = (id: number) => {
	const found = serversSnapshot().servers.find((x) => x.id === id);
	if (!found) throw new HttpError(404, "no such server");
	return found;
};

function validate(input: Partial<ServerInput>, partial: boolean): void {
	const need = (k: keyof ServerInput) => {
		if (!partial && (input[k] === undefined || input[k] === ""))
			throw new HttpError(400, `${k} is required`);
	};
	need("name");
	need("panelId");
	if (input.name !== undefined && !input.name.trim())
		throw new HttpError(400, "name is empty");
	if (input.game !== undefined && !games[input.game])
		throw new HttpError(400, `unknown game: ${input.game}`);
	if (
		input.backend !== undefined &&
		input.backend !== "ptero" &&
		input.backend !== "sftp" &&
		input.backend !== "local"
	)
		throw new HttpError(400, "backend must be ptero, sftp or local");
	if (input.syncIntervalMin !== undefined && !(input.syncIntervalMin >= 1))
		throw new HttpError(400, "syncIntervalMin must be at least 1");
}

function insertServer(input: ServerInput): number {
	validate(input, false);
	return (
		db
			.query(
				`INSERT INTO servers(name, game, backend, panel_id, log_dir, crash_dir, sync_interval_min, enabled)
				 VALUES (?,?,?,?,?,?,?,?) RETURNING id`,
			)
			.get(
				input.name.trim(),
				input.game ?? "minecraft",
				input.backend ?? "ptero",
				input.panelId,
				input.logDir || "/logs",
				input.crashDir || "/crash-reports",
				input.syncIntervalMin ?? 15,
				input.enabled === false ? 0 : 1,
			) as { id: number }
	).id;
}

export const api = new Hono();

api.onError((err, c) => {
	if (err instanceof HttpError)
		return c.json({ error: err.message }, err.status);
	console.error(err);
	return c.json({ error: err.message }, 500);
});

api.get("/status", (c) =>
	c.json<AppStatus>({
		panelConfigured: panelConfigured(),
		panelUrl: config.panelUrl,
		sftpConfigured: sftpConfigured(),
		geoReady: geoReady(),
		games: Object.values(games).map((g) => ({ id: g.id, name: g.name })),
	}),
);

api.get("/overview", (c) => c.json(stats.overview()));

// ---- servers
api.get("/servers", (c) => {
	return c.json(serversSnapshot().servers);
});

api.post("/servers", async (c) => {
	const id = insertServer(await c.req.json<ServerInput>());
	activity(id, "info", `Server added: ${getServer(id).name}`);
	announceServers();
	return c.json(summaryOf(id), 201);
});

api.patch("/servers/:id", async (c) => {
	const row = getServer(Number(c.req.param("id")));
	const input = await c.req.json<Partial<ServerInput>>();
	validate(input, true);
	const cols: [string, string | number | null | undefined][] = [
		["name", input.name?.trim()],
		["game", input.game],
		["backend", input.backend],
		["panel_id", input.panelId],
		["log_dir", input.logDir],
		["crash_dir", input.crashDir],
		["sync_interval_min", input.syncIntervalMin],
		[
			"enabled",
			input.enabled === undefined ? undefined : input.enabled ? 1 : 0,
		],
	];
	for (const [col, val] of cols)
		if (val !== undefined)
			db.query(`UPDATE servers SET ${col}=? WHERE id=?`).run(val, row.id);
	activity(row.id, "info", `Server settings changed: ${row.name}`);
	announceServers();
	return c.json(summaryOf(row.id));
});

api.delete("/servers/:id", async (c) => {
	const row = getServer(Number(c.req.param("id")));
	if (isSyncing(row.id))
		throw new HttpError(409, "a sync is running for this server");
	db.transaction(() => {
		for (const t of [
			"sessions",
			"usercache",
			"crash_reports",
			"events",
			"files",
		])
			db.query(`DELETE FROM ${t} WHERE server_id=?`).run(row.id);
		db.query("DELETE FROM servers WHERE id=?").run(row.id);
	})();
	await rm(join(filesDir, String(row.id)), { recursive: true, force: true });
	activity(null, "info", `Server removed: ${row.name}`);
	announceData();
	return c.json({ ok: true });
});

api.post("/servers/:id/sync", (c) => {
	const row = getServer(Number(c.req.param("id")));
	if (isSyncing(row.id)) throw new HttpError(409, "already syncing");
	void syncServer(row.id);
	return c.json({ ok: true }, 202);
});

api.post("/servers/:id/reparse", (c) => {
	const row = getServer(Number(c.req.param("id")));
	if (isSyncing(row.id)) throw new HttpError(409, "already syncing");
	void reparseServer(row.id);
	return c.json({ ok: true }, 202);
});

api.post("/sync", (c) => {
	for (const r of allServers())
		if (r.enabled && r.panel_id && !isSyncing(r.id)) void syncServer(r.id);
	return c.json({ ok: true }, 202);
});

api.get("/servers/:id/info", (c) =>
	c.json(stats.serverInfo(getServer(Number(c.req.param("id"))).id)),
);

api.get("/servers/:id/files", (c) => {
	const id = getServer(Number(c.req.param("id"))).id;
	const kind = c.req.query("kind");
	const extra = kind ? "AND kind=?" : "";
	const args = kind ? [id, kind] : [id];
	const total = (
		db
			.query(`SELECT COUNT(*) AS n FROM files WHERE server_id=? ${extra}`)
			.get(...args) as { n: number }
	).n;
	const rows = db
		.query(
			`SELECT * FROM files WHERE server_id=? ${extra} ORDER BY name DESC LIMIT ? OFFSET ?`,
		)
		.all(
			...args,
			intParam(c.req.query("limit"), 100),
			intParam(c.req.query("offset"), 0, 1e9),
		) as {
		id: number;
		kind: "log" | "crash" | "meta";
		name: string;
		size: number;
		mtime: number;
		lines: number | null;
		events: number | null;
		error: string | null;
		ingested_at: string;
	}[];
	return c.json<FileList>({
		total,
		rows: rows.map((r) => ({
			id: r.id,
			kind: r.kind,
			name: r.name,
			size: r.size,
			mtime: r.mtime,
			lines: r.lines,
			events: r.events,
			error: r.error,
			ingestedAt: r.ingested_at,
		})),
	});
});

// ---- panel
api.get("/panel/servers", async (c) => {
	if (!panelConfigured())
		throw new HttpError(400, "PTERO_URL and PTERO_API_KEY are not set");
	let list: Awaited<ReturnType<typeof listPanelServers>>;
	try {
		list = await listPanelServers();
	} catch (e) {
		throw new HttpError(502, (e as Error).message);
	}
	const have = new Set(
		(
			db
				.query("SELECT panel_id FROM servers WHERE backend IN ('ptero','sftp')")
				.all() as {
				panel_id: string;
			}[]
		).map((r) => r.panel_id),
	);
	return c.json<PanelServerRow[]>(
		list.map((s) => ({
			status: s.status,
			suspended: s.suspended,
			identifier: s.identifier,
			name: s.name,
			description: s.description,
			node: s.node,
			imported: have.has(s.identifier),
		})),
	);
});

api.post("/panel/import", async (c) => {
	const { identifiers } = await c.req.json<{ identifiers: string[] }>();
	if (!Array.isArray(identifiers) || identifiers.length === 0)
		throw new HttpError(400, "identifiers is required");
	const list = await listPanelServers().catch((e: Error) => {
		throw new HttpError(502, e.message);
	});
	const ids: number[] = [];
	const skipped: ImportResult["skipped"] = [];
	for (const ident of identifiers) {
		const s = list.find((x) => x.identifier === ident);
		if (!s) throw new HttpError(400, `panel has no server ${ident}`);
		if (s.suspended) {
			const reason = "suspended on the panel, so its files can't be read";
			activity(null, "warn", `Not importing ${s.name}: ${reason}`);
			skipped.push({ identifier: ident, name: s.name, reason });
			continue;
		}
		if (
			db
				.query(
					"SELECT 1 FROM servers WHERE backend IN ('ptero','sftp') AND panel_id=?",
				)
				.get(ident)
		)
			continue;
		ids.push(
			insertServer({
				name: s.name,
				panelId: ident,
				backend: sftpConfigured() ? "sftp" : "ptero",
			}),
		);
	}
	for (const id of ids) {
		activity(
			id,
			"info",
			`Server imported from the panel: ${getServer(id).name}`,
		);
	}
	announceServers();
	for (const id of ids) void syncServer(id);
	const imported = serversSnapshot().servers.filter((x) => ids.includes(x.id));
	return c.json<ImportResult>({ imported, skipped }, 201);
});

// ---- stats
api.get("/players", (c) => {
	const r = c.req;
	return c.json(
		stats.players(filter(c), {
			q: r.query("q") || undefined,
			sort: r.query("sort"),
			dir: r.query("dir"),
			limit: intParam(r.query("limit"), 50, 500),
			offset: intParam(r.query("offset"), 0, 1e9),
		}),
	);
});

api.get("/players/:name", (c) => {
	const p = stats.playerProfile(c.req.param("name"), filter(c));
	if (!p) throw new HttpError(404, "unknown player");
	return c.json(p);
});

api.get("/sessions", (c) =>
	c.json(
		stats.sessions(filter(c), {
			player: c.req.query("player") || undefined,
			limit: intParam(c.req.query("limit"), 50, 500),
			offset: intParam(c.req.query("offset"), 0, 1e9),
		}),
	),
);

api.get("/messages", (c) => {
	const type = c.req.query("type");
	return c.json(
		stats.messages(filter(c), {
			type: type === "chat" || type === "cmd" ? type : undefined,
			player: c.req.query("player") || undefined,
			q: c.req.query("q") || undefined,
			limit: intParam(c.req.query("limit"), 50, 500),
			offset: intParam(c.req.query("offset"), 0, 1e9),
		}),
	);
});

api.get("/geo", (c) =>
	c.json(stats.geo(filter(c), c.req.query("perPlayer") === "1")),
);
api.get("/activity", (c) => c.json(stats.activity(filter(c))));

api.get("/crashes", (c) =>
	c.json(
		stats.crashes(filter(c), {
			limit: intParam(c.req.query("limit"), 50, 500),
			offset: intParam(c.req.query("offset"), 0, 1e9),
		}),
	),
);

api.get("/crashes/:fileId/raw", async (c) => {
	const f = db
		.query("SELECT local_path FROM files WHERE id=? AND kind='crash'")
		.get(Number(c.req.param("fileId"))) as { local_path: string } | null;
	if (!f) throw new HttpError(404, "no such crash report");
	const buf = new Uint8Array(await Bun.file(f.local_path).arrayBuffer());
	return c.text(new TextDecoder().decode(Bun.gunzipSync(buf)));
});

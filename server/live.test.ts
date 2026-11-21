import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LogEntry, ServersEvent, SyncEvent } from "../shared/events";
import { config } from "./config";
import { db } from "./db";
import { eventRoutes } from "./events";
import { hub } from "./hub";
import { recentActivity } from "./log";
import { syncServer } from "./sync";
import { isSyncing } from "./syncstate";

const LINES = [
	"[19:00:00] [Server thread/INFO]: Starting minecraft server version 1.21.1",
	"[19:01:00] [Server thread/INFO]: Alex[/9.9.9.9:1] logged in with entity id 1 at (0, 0, 0)",
	"[19:02:00] [Server thread/INFO]: <Alex> hello",
	"[19:03:00] [Server thread/INFO]: Alex left the game",
];

let root: string;
let serverId: number;

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "live-test-"));
	mkdirSync(join(root, "logs"));
	for (const n of [1, 2])
		writeFileSync(
			join(root, `logs/2026-11-0${n}-1.log.gz`),
			Bun.gzipSync(new TextEncoder().encode(LINES.join("\n"))),
		);
	serverId = (
		db
			.query(
				"INSERT INTO servers(name, backend, panel_id) VALUES ('live', 'local', ?) RETURNING id",
			)
			.get(root) as { id: number }
	).id;
});

afterAll(() => {
	db.query("DELETE FROM servers WHERE id=?").run(serverId);
});

/** Everything a client following all topics would hear, in order. */
function listen() {
	const heard: { topic: string; data: unknown }[] = [];
	const offs = (["servers", "sync", "log", "data", "online"] as const).map(
		(t) => hub.subscribe(t, (data) => heard.push({ topic: t, data })),
	);
	return {
		heard,
		stop: () => {
			for (const off of offs) off();
		},
	};
}

test("a sync tells clients when it starts, every step, and that it ended", async () => {
	const l = listen();
	await syncServer(serverId);
	l.stop();

	const topics = l.heard.map((h) => h.topic);
	// Starts with the server turning "running", and ends with it settled.
	const servers = l.heard
		.filter((h) => h.topic === "servers")
		.map((h) =>
			(h.data as ServersEvent).servers.find((s) => s.id === serverId),
		);
	expect(servers[0]?.lastSyncStatus).toBe("running");
	expect(servers.at(-1)?.lastSyncStatus).toBe("ok");
	expect(servers.at(-1)?.progress).toBeNull();
	expect(servers.at(-1)?.sessions).toBe(2);

	// Progress counts up one file at a time and never goes backwards.
	const runs = l.heard
		.filter((h) => h.topic === "sync")
		.map((h) => (h.data as SyncEvent).running[serverId]);
	const dones = runs.filter(Boolean).map((p) => p?.done ?? 0);
	expect(dones.at(-1)).toBe(2);
	expect([...dones].sort((a, b) => a - b)).toEqual(dones);
	expect(runs.at(-1)).toBeUndefined(); // the last sync event says it's no longer running

	// New data lands: clients are told to fetch again, after the sync stopped counting as running.
	expect(topics).toContain("data");
	expect(topics.lastIndexOf("data")).toBeGreaterThan(topics.indexOf("sync"));
	expect(isSyncing(serverId)).toBe(false);

	// Everything is in the activity log, as it happened.
	const log = l.heard
		.filter((h) => h.topic === "log")
		.flatMap((h) => (h.data as { entries: LogEntry[] }).entries);
	const msgs = log.map((e) => e.message);
	expect(msgs[0]).toContain("Sync started");
	expect(msgs.some((m) => m.includes("2 new or changed"))).toBe(true);
	expect(
		msgs.filter((m) => m.includes("2026-11-0") && m.includes("event(s)"))
			.length,
	).toBe(2);
	expect(msgs.some((m) => m.includes("Sessions rebuilt: 2"))).toBe(true);
	expect(msgs.at(-1)).toContain("Sync finished");
	expect(log.every((e) => e.serverId === serverId)).toBe(true);
	expect(recentActivity().at(-1)?.message).toBe(msgs.at(-1));
});

test("a second sync with nothing new says so and does not announce new data", async () => {
	const l = listen();
	await syncServer(serverId);
	l.stop();
	expect(
		l.heard.some(
			(h) =>
				h.topic === "log" &&
				JSON.stringify(h.data).includes("0 new or changed"),
		),
	).toBe(true);
	expect(
		l.heard.some(
			(h) =>
				h.topic === "log" && JSON.stringify(h.data).includes("Sync finished"),
		),
	).toBe(true);
});

test("a failing sync still ends: status error, no longer running, the reason is in the log", async () => {
	db.query("UPDATE servers SET backend='sftp', panel_id='abc' WHERE id=?").run(
		serverId,
	);
	const l = listen();
	await syncServer(serverId);
	l.stop();
	db.query("UPDATE servers SET backend='local', panel_id=? WHERE id=?").run(
		root,
		serverId,
	);

	const row = db
		.query(
			"SELECT last_sync_status s, last_sync_error e FROM servers WHERE id=?",
		)
		.get(serverId) as { s: string; e: string };
	expect(row.s).toBe("error");
	expect(row.e).toContain("SFTP is not configured");
	expect(isSyncing(serverId)).toBe(false);
	const last = l.heard.filter((h) => h.topic === "sync").at(-1)
		?.data as SyncEvent;
	expect(last.running[serverId]).toBeUndefined();
	const log = l.heard
		.filter((h) => h.topic === "log")
		.flatMap((h) => (h.data as { entries: LogEntry[] }).entries);
	expect(log.at(-1)?.level).toBe("error");
	expect(log.at(-1)?.message).toContain("while listing files");
});

test("a server suspended on the panel is not synced, and the log says why", async () => {
	const panel = Bun.serve({
		port: 0,
		fetch: () =>
			Response.json({
				data: [
					{
						attributes: {
							identifier: "susp",
							name: "S",
							description: "",
							node: "n",
							server_owner: true,
							status: "suspended",
							is_suspended: true,
						},
					},
				],
				meta: { pagination: { current_page: 1, total_pages: 1 } },
			}),
	});
	const was = { url: config.panelUrl, key: config.panelKey };
	config.panelUrl = panel.url.origin;
	config.panelKey = "k";
	db.query(
		"UPDATE servers SET backend='ptero', panel_id='susp' WHERE id=?",
	).run(serverId);
	try {
		const l = listen();
		await syncServer(serverId);
		l.stop();
		const row = db
			.query(
				"SELECT last_sync_status s, last_sync_error e FROM servers WHERE id=?",
			)
			.get(serverId) as { s: string; e: string };
		expect(row.s).toBe("error");
		expect(row.e).toContain("suspended on the panel");
		const log = l.heard
			.filter((h) => h.topic === "log")
			.flatMap((h) => (h.data as { entries: LogEntry[] }).entries);
		expect(log.at(-1)?.message).toContain("suspended on the panel");
		// It never got as far as asking the server for files.
		expect(log.some((e) => e.message.includes("new or changed"))).toBe(false);
	} finally {
		config.panelUrl = was.url;
		config.panelKey = was.key;
		db.query("UPDATE servers SET backend='local', panel_id=? WHERE id=?").run(
			root,
			serverId,
		);
		panel.stop(true);
	}
});

test("two syncs of one server at once run once", async () => {
	const l = listen();
	await Promise.all([syncServer(serverId), syncServer(serverId)]);
	l.stop();
	const started = l.heard.filter(
		(h) => h.topic === "log" && JSON.stringify(h.data).includes("Sync started"),
	);
	expect(started.length).toBe(1);
});

/** Reads SSE messages from `GET /events?topics=...` until `n` have arrived. */
async function readEvents(topics: string, n: number, between?: () => void) {
	const res = await eventRoutes.request(`/?topics=${topics}`);
	expect(res.headers.get("content-type")).toContain("text/event-stream");
	const reader =
		res.body?.getReader() as ReadableStreamDefaultReader<Uint8Array>;
	const dec = new TextDecoder();
	const out: Record<string, unknown>[] = [];
	let buf = "";
	let kicked = false;
	while (out.length < n) {
		const { value, done } = await reader.read();
		if (done) break;
		buf += dec.decode(value);
		for (;;) {
			const i = buf.indexOf("\n\n");
			if (i < 0) break;
			const chunk = buf.slice(0, i);
			buf = buf.slice(i + 2);
			const data = chunk.split("\n").find((l) => l.startsWith("data:"));
			if (data) out.push(JSON.parse(data.slice(5).trim()));
		}
		if (!kicked && between && out.length >= 1) {
			kicked = true;
			between();
		}
	}
	await reader.cancel();
	return out;
}

test("the stream sends each topic's current state first, then its events as they happen", async () => {
	const got = await readEvents("data,log,nonsense", 4, () => {
		hub.emit("data", {});
	});
	const byTopic = (t: string) => got.filter((e) => e.topic === t);
	expect(byTopic("nonsense")).toEqual([
		{ topic: "nonsense", error: "unknown topic" },
	]);
	expect(byTopic("log")[0]?.snapshot).toBe(true);
	const data = byTopic("data");
	expect(data[0]?.snapshot).toBe(true);
	expect(data[1]?.snapshot).toBe(false);
	// seq tells a client that reconnects whether it missed anything.
	const n = (e?: Record<string, unknown>) =>
		Number(String(e?.seq).split(".")[1]);
	expect(n(data[1])).toBe(n(data[0]) + 1);
});

test("the snapshot of servers and log reflect the database and the activity so far", async () => {
	const got = await readEvents("servers,log", 2);
	const servers = got.find((e) => e.topic === "servers")?.data as ServersEvent;
	expect(servers.servers.find((s) => s.id === serverId)?.name).toBe("live");
	const log = got.find((e) => e.topic === "log")?.data as {
		entries: LogEntry[];
	};
	expect(log.entries.length).toBeGreaterThan(0);
});

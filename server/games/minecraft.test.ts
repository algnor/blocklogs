import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../db";
import {
	chatName,
	minecraft,
	parseCrashText,
	rebuildSessions,
} from "./minecraft";

const dir = mkdtempSync(join(tmpdir(), "mc-test-"));

function gz(name: string, text: string): string {
	const path = join(dir, name);
	writeFileSync(path, Bun.gzipSync(new TextEncoder().encode(text)));
	return path;
}

const parse = (
	name: string,
	text: string,
	mtimeMs = Date.UTC(2026, 10, 7, 12),
) => minecraft.parseFile({ kind: "log", path: gz(name, text), name, mtimeMs });

describe("log parsing", () => {
	test("neoforge lines carry their own date", async () => {
		const r = await parse(
			"2026-11-07-1.log.gz",
			[
				"[07Nov2026 19:02:13.456] [Server thread/INFO] [net.minecraft.server.MinecraftServer/]: Starting minecraft server version 1.21.1",
				"[07Nov2026 19:05:00.001] [Server thread/INFO] [minecraft/MinecraftServer]: Steve[/1.2.3.4:5555] logged in with entity id 5 at (1, 2, 3)",
				"[07Nov2026 19:05:10.001] [Server thread/INFO] [minecraft/MinecraftServer]: <Steve> hello there",
				"[07Nov2026 19:06:00.001] [Server thread/INFO] [minecraft/MinecraftServer]: Steve left the game",
			].join("\n"),
		);
		expect(r.events.map((e) => [e.type, e.player, e.data])).toEqual([
			["boot", null, "1.21.1"],
			["join", "Steve", "1.2.3.4"],
			["chat", "Steve", "hello there"],
			["leave", "Steve", null],
			["eof", null, null],
		]);
		expect(r.events[1]?.ts).toBe("2026-11-07 19:05:00.001");
	});

	test("vanilla/fabric lines roll over midnight using the file name's day", async () => {
		const r = await parse(
			"2026-11-07-1.log.gz",
			[
				"[23:59:30] [Server thread/INFO]: Alex[/10.0.0.1:1] logged in with entity id 1 at (0, 0, 0)",
				"[00:00:30] [Server thread/INFO]: <Alex> late night",
				"[00:01:00] [Server thread/INFO]: Alex lost connection: Disconnected",
			].join("\n"),
		);
		expect(r.events.map((e) => e.ts.slice(0, 19))).toEqual([
			"2026-11-07 23:59:30",
			"2026-11-08 00:00:30",
			"2026-11-08 00:01:00",
			"2026-11-08 00:01:00",
		]);
	});

	test("latest.log takes its date from the modification time and shifts back over midnights", async () => {
		const r = await parse(
			"latest.log.gz",
			[
				"[23:59:30] [Server thread/INFO]: <A> one",
				"[00:00:30] [Server thread/INFO]: <A> two",
			].join("\n"),
			Date.UTC(2026, 10, 8, 0, 5),
		);
		expect(r.events.map((e) => e.ts.slice(0, 19))).toEqual([
			"2026-11-07 23:59:30",
			"2026-11-08 00:00:30",
			"2026-11-08 00:00:30",
		]);
	});

	test("continuation lines and unrelated names are ignored", async () => {
		const r = await parse(
			"2026-11-07-1.log.gz",
			"\tat some.stack.Trace\n[12:00:00] [Server thread/INFO]: Done\n",
		);
		expect(r.events.map((e) => e.type)).toEqual(["eof"]);
		expect(
			(await parse("debug-1.log.gz", "[12:00:00] [x/INFO]: <A> hi")).events,
		).toEqual([]);
	});

	test("a truncated gzip keeps what was read and reports the error", async () => {
		const full = Bun.gzipSync(
			new TextEncoder().encode(
				`${"[12:00:00] [Server thread/INFO]: <A> hello\n".repeat(20000)}`,
			),
		);
		const path = join(dir, "2026-11-07-9.log.gz");
		writeFileSync(path, full.slice(0, Math.floor(full.length / 2)));
		const r = await minecraft.parseFile({
			kind: "log",
			path,
			name: "2026-11-07-9.log.gz",
			mtimeMs: 0,
		});
		expect(r.error).not.toBeNull();
		expect(r.events.filter((e) => e.type === "chat").length).toBeGreaterThan(0);
	});
});

describe("chat and commands", () => {
	test("chatName reduces display names to the player", () => {
		const cases: [string, string | null][] = [
			["Steve", "Steve"],
			["🥈 badideapanda", "badideapanda"],
			["AFK BannedDuck", "BannedDuck"],
			["TartShell ", "TartShell"],
			["%luckperms:prefix%yadoomi%luckperms:suffix%", "yadoomi"],
			["[INVALID KEY dynamic:styled_chat | luckperms:prefix]algotn", "algotn"],
			["~kika", "~kika"],
			["#test", "test"],
			["\u{1F948}", null],
			["", null],
		];
		for (const [display, want] of cases)
			expect([display, chatName(display)]).toEqual([display, want]);
	});

	test("decorated chat lines and operator command feedback become events", async () => {
		const r = await parse(
			"2026-11-07-1.log.gz",
			[
				"[12:00:00] [Server thread/INFO]: <\u{1F948} Panda> hi",
				"[12:00:01] [Server thread/INFO]: [Not Secure] <~nick> yo",
				"[12:00:02] [Server thread/INFO]: [Steve: Set own game mode to Creative Mode]",
				"[12:00:03] [Server thread/INFO]: [Rcon: Saved the game]",
				"[12:00:04] [Server thread/INFO]: [Server: Teleported Steve]",
				"[12:00:05] [Server thread/INFO]: Alex issued server command: /home",
			].join("\n"),
		);
		expect(
			r.events
				.filter((e) => e.type !== "eof")
				.map((e) => [e.type, e.player, e.data]),
		).toEqual([
			["chat", "Panda", "hi"],
			["chat", "~nick", "yo"],
			["cmd", "Steve", "Set own game mode to Creative Mode"],
			["cmd", "Alex", "/home"],
		]);
	});
});

describe("crash reports", () => {
	const neo = `---- Minecraft Crash Report ----
// Why did you do that?

Time: 2026-11-07 19:02:13
Description: Exception in server tick loop

java.lang.IllegalStateException: Something broke
	at net.minecraft.Foo.bar(Foo.java:1)

-- System Details --
	NeoForge: net.neoforged:neoforge:21.1.77
	Suspected Mods: examplemod (examplemod), other (other)
`;

	test("extracts time, description, exception, loader and suspects", () => {
		const c = parseCrashText(neo, "crash-2026-11-07_19.02.13-server.txt");
		expect(c).toEqual({
			ts: "2026-11-07 19:02:13.000",
			side: "server",
			loader: "NeoForge",
			description: "Exception in server tick loop",
			exception: "java.lang.IllegalStateException: Something broke",
			suspects: "examplemod (examplemod), other (other)",
		});
	});

	test("falls back to the file name for the time and detects fabric", () => {
		const c = parseCrashText(
			"---- Minecraft Crash Report ----\nDescription: x\n\tFabric Loader 0.16\n",
			"crash-2026-11-07_19.02.13-client.txt",
		);
		expect(c.ts).toBe("2026-11-07 19:02:13.000");
		expect(c.side).toBe("client");
		expect(c.loader).toBe("Fabric");
		expect(c.suspects).toBeNull();
	});
});

describe("sessions", () => {
	function run(events: [string, string, string | null, string | null][]) {
		const db = openDb(":memory:");
		db.query("INSERT INTO servers(id, name) VALUES (1, 's')").run();
		db.query(
			"INSERT INTO files(id, server_id, kind, name) VALUES (1, 1, 'log', 'f')",
		).run();
		events.forEach(([ts, type, player, data], i) => {
			db.query("INSERT INTO events VALUES (1, 1, ?, ?, ?, ?, ?)").run(
				i,
				ts,
				type,
				player,
				data,
			);
		});
		rebuildSessions(db, 1);
		return db
			.query(
				"SELECT player, secs, closed_by, ip FROM sessions ORDER BY start, player",
			)
			.all();
	}

	test("leave, rejoin, stop and crash close sessions", () => {
		const rows = run([
			["2026-01-01 10:00:00.000", "join", "a", "1.1.1.1"],
			["2026-01-01 10:10:00.000", "leave", "a", null],
			["2026-01-01 11:00:00.000", "join", "a", "1.1.1.1"],
			["2026-01-01 11:30:00.000", "join", "a", "2.2.2.2"],
			["2026-01-01 11:40:00.000", "join", "b", "3.3.3.3"],
			["2026-01-01 12:00:00.000", "stop", null, null],
			["2026-01-01 13:00:00.000", "boot", null, null],
			["2026-01-01 13:05:00.000", "join", "b", "3.3.3.3"],
			["2026-01-01 13:20:00.000", "eof", null, null],
			["2026-01-01 14:00:00.000", "boot", null, null],
		]);
		expect(rows).toEqual([
			{ player: "a", secs: 600, closed_by: "leave", ip: "1.1.1.1" },
			{ player: "a", secs: 1800, closed_by: "rejoin", ip: "1.1.1.1" },
			{ player: "a", secs: 1800, closed_by: "stop", ip: "2.2.2.2" },
			{ player: "b", secs: 1200, closed_by: "stop", ip: "3.3.3.3" },
			{ player: "b", secs: 900, closed_by: "crash", ip: "3.3.3.3" },
		]);
	});
});

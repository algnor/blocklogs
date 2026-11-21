import { afterAll, beforeAll, expect, test } from "bun:test";
import { db } from "./db";
import { activity, serverInfo } from "./stats";

let a: number;
let b: number;

beforeAll(() => {
	const add = (name: string) =>
		(
			db
				.query(
					"INSERT INTO servers(name, backend) VALUES (?, 'local') RETURNING id",
				)
				.get(name) as { id: number }
		).id;
	a = add("stats-a");
	b = add("stats-b");
	const ins = db.query("INSERT INTO sessions VALUES (?,?,?,?,?,?,?)");
	// "x" plays on both servers on the same day, "y" only on b.
	ins.run(
		a,
		"x",
		"2030-01-01 10:00:00.000",
		"2030-01-01 11:00:00.000",
		3600,
		"1.1.1.1",
		"leave",
	);
	ins.run(
		b,
		"x",
		"2030-01-01 12:00:00.000",
		"2030-01-01 12:30:00.000",
		1800,
		"1.1.1.1",
		"leave",
	);
	ins.run(
		b,
		"y",
		"2030-01-02 10:00:00.000",
		"2030-01-02 12:00:00.000",
		7200,
		"2.2.2.2",
		"leave",
	);
});

afterAll(() => {
	for (const id of [a, b]) {
		db.query("DELETE FROM sessions WHERE server_id=?").run(id);
		db.query("DELETE FROM servers WHERE id=?").run(id);
	}
});

const filter = () => ({
	servers: [a, b],
	since: "2030-01-01",
	until: "2030-01-03",
});

test("the charts come per server, over the same days, and add up to the whole", () => {
	const r = activity(filter());
	expect(Object.keys(r.byServer).map(Number)).toEqual([a, b]);
	const sa = r.byServer[a];
	const sb = r.byServer[b];
	expect(sa?.daily.map((d) => d.date)).toEqual(["2030-01-01", "2030-01-02"]);
	expect(sb?.daily.map((d) => d.date)).toEqual(r.daily.map((d) => d.date));

	// Hours and sessions are sums; so is the average number of players in an hour of the day.
	for (let i = 0; i < r.daily.length; i++) {
		const sum = (k: "hours" | "sessions") =>
			(sa?.daily[i]?.[k] ?? 0) + (sb?.daily[i]?.[k] ?? 0);
		expect(sum("hours")).toBeCloseTo(r.daily[i]?.hours ?? 0, 5);
		expect(sum("sessions")).toBe(r.daily[i]?.sessions ?? 0);
	}
	for (let h = 0; h < 24; h++)
		expect(
			(sa?.hourOfDay[h]?.avgPlayers ?? 0) + (sb?.hourOfDay[h]?.avgPlayers ?? 0),
		).toBeCloseTo(r.hourOfDay[h]?.avgPlayers ?? 0, 3);
	for (let i = 0; i < r.lengths.length; i++)
		expect((sa?.lengths[i]?.count ?? 0) + (sb?.lengths[i]?.count ?? 0)).toBe(
			r.lengths[i]?.count ?? 0,
		);
});

test("each server's numbers are its own", () => {
	const r = activity(filter());
	expect(r.byServer[a]?.daily[0]).toEqual({
		date: "2030-01-01",
		players: 1,
		sessions: 1,
		hours: 1,
	});
	expect(r.byServer[b]?.daily[0]).toEqual({
		date: "2030-01-01",
		players: 1,
		sessions: 1,
		hours: 0.5,
	});
	expect(r.byServer[b]?.daily[1]).toEqual({
		date: "2030-01-02",
		players: 1,
		sessions: 1,
		hours: 2,
	});
});

test("the overall 'players' counts a player once, even on two servers", () => {
	const r = activity(filter());
	expect(r.daily[0]?.players).toBe(1);
});

test("a selection of one server has only that server", () => {
	const r = activity({ ...filter(), servers: [b] });
	expect(Object.keys(r.byServer).map(Number)).toEqual([b]);
});

test("no sessions: no servers, and no error", () => {
	const r = activity({
		servers: [a, b],
		since: "1999-01-01",
		until: "1999-01-02",
	});
	expect(r.byServer).toEqual({});
	expect(r.daily.every((d) => d.sessions === 0)).toBe(true);
});

test("server info: totals, peak, longest session and how sessions ended", () => {
	const info = serverInfo(b);
	expect(info.sessions.total).toBe(2);
	expect(info.sessions.avgSecs).toBe(4500); // (1800 + 7200) / 2
	expect(info.sessions.longest).toEqual({
		player: "y",
		secs: 7200,
		start: "2030-01-02 10:00:00.000",
	});
	expect(info.sessions.endedBy).toEqual({ leave: 2 });
	expect(info.range).toEqual({
		first: "2030-01-01 12:00:00.000",
		last: "2030-01-02 12:00:00.000",
	});
	expect(info.peak).toEqual({ players: 1, at: "2030-01-01 12:00:00.000" });
});

test("server info: a leave and a join at the same moment are not two players at once", () => {
	const ins = db.query("INSERT INTO sessions VALUES (?,?,?,?,?,?,?)");
	ins.run(
		a,
		"p",
		"2031-01-01 10:00:00.000",
		"2031-01-01 11:00:00.000",
		3600,
		null,
		"rejoin",
	);
	ins.run(
		a,
		"p",
		"2031-01-01 11:00:00.000",
		"2031-01-01 12:00:00.000",
		3600,
		null,
		"leave",
	);
	ins.run(
		a,
		"q",
		"2031-01-01 10:30:00.000",
		"2031-01-01 10:45:00.000",
		900,
		null,
		"leave",
	);
	try {
		expect(serverInfo(a).peak).toEqual({
			players: 2,
			at: "2031-01-01 10:30:00.000",
		});
	} finally {
		db.query("DELETE FROM sessions WHERE start LIKE '2031-%'").run();
	}
});

test("server info: files and events are counted for this server only", () => {
	const fid = (
		db
			.query(
				"INSERT INTO files(server_id, kind, name, size, error) VALUES (?, 'log', 'f1', 100, NULL) RETURNING id",
			)
			.get(a) as { id: number }
	).id;
	db.query(
		"INSERT INTO files(server_id, kind, name, size, error) VALUES (?, 'crash', 'c1', 50, 'boom')",
	).run(a);
	db.query("INSERT INTO events VALUES (?,?,?,?,?,?,?)").run(
		a,
		fid,
		1,
		"2030-01-01 10:00:00.000",
		"chat",
		"x",
		"hi",
	);
	db.query("INSERT INTO events VALUES (?,?,?,?,?,?,?)").run(
		a,
		fid,
		2,
		"2030-01-01 10:00:01.000",
		"join",
		"x",
		"1.1.1.1",
	);
	const info = serverInfo(a);
	expect(info.files).toMatchObject({
		logs: 1,
		crashes: 1,
		meta: 0,
		bytes: 150,
		withErrors: 1,
	});
	expect(info.events).toEqual({ chat: 1, commands: 0, joins: 1 });
	expect(serverInfo(b).files.logs).toBe(0);
	db.query("DELETE FROM files WHERE server_id=?").run(a);
});

test("server info for a server with nothing in it", () => {
	const id = (
		db
			.query(
				"INSERT INTO servers(name, backend) VALUES ('stats-empty', 'local') RETURNING id",
			)
			.get() as { id: number }
	).id;
	try {
		const info = serverInfo(id);
		expect(info.peak).toBeNull();
		expect(info.sessions).toEqual({
			total: 0,
			avgSecs: 0,
			longest: null,
			endedBy: {},
		});
		expect(info.files).toMatchObject({
			logs: 0,
			bytes: 0,
			lastIngestedAt: null,
		});
	} finally {
		db.query("DELETE FROM servers WHERE id=?").run(id);
	}
});

import { beforeEach, expect, test } from "bun:test";
import type { Envelope } from "../../shared/events";
import { createEventStream } from "./events";

class FakeSource {
	static all: FakeSource[] = [];
	onmessage: ((e: MessageEvent) => void) | null = null;
	onerror: (() => void) | null = null;
	onopen: (() => void) | null = null;
	closed = false;
	constructor(readonly url: string) {
		FakeSource.all.push(this);
	}
	close() {
		this.closed = true;
	}
	send(e: Envelope) {
		this.onmessage?.({ data: JSON.stringify(e) } as MessageEvent);
	}
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const snap = (
	topic: "data" | "log",
	seq: string,
	data: object = {},
): Envelope => ({ topic, seq, snapshot: true, data }) as Envelope;
const evt = (topic: "data" | "log", seq: string, data: object = {}): Envelope =>
	({ topic, seq, snapshot: false, data }) as Envelope;

const make = (extra = {}) =>
	createEventStream({
		open: (url) => new FakeSource(url) as never,
		batchMs: 1,
		retryMs: () => 5,
		silenceMs: 1000,
		...extra,
	});

beforeEach(() => {
	FakeSource.all = [];
});

test("subscriptions made together share one connection", async () => {
	const s = make();
	s.subscribe("log", { onEvent: () => {} });
	s.subscribe("data", { onEvent: () => {} });
	await wait(15);
	expect(FakeSource.all.length).toBe(1);
	expect(FakeSource.all[0]?.url).toBe("/api/events?topics=data,log");
});

test("delivers the snapshot then events, and reports the stream live", async () => {
	const status: string[] = [];
	const s = make({ onStatus: (x: string) => status.push(x) });
	const got: [object, boolean][] = [];
	s.subscribe("log", { onEvent: (d, m) => got.push([d, m.snapshot]) });
	await wait(15);
	const src = FakeSource.all[0] as FakeSource;
	src.send(snap("log", "a.0", { entries: [] }));
	src.send(evt("log", "a.1", { entries: [{ id: 1 }] }));
	expect(got.map(([, snapshot]) => snapshot)).toEqual([true, false]);
	expect(status).toEqual(["live"]);
	expect(s.healthy).toBe(true);
});

test("a late subscriber starts from the last event, without a new connection", async () => {
	const s = make();
	s.subscribe("data", { onEvent: () => {} });
	await wait(15);
	(FakeSource.all[0] as FakeSource).send(snap("data", "a.3"));
	const late: boolean[] = [];
	s.subscribe("data", { onEvent: (_, m) => late.push(m.snapshot) });
	await wait(5);
	expect(late).toEqual([true]);
	expect(FakeSource.all.length).toBe(1);
});

test("a reconnect snapshot with the same seq is not delivered again", async () => {
	const s = make();
	let n = 0;
	s.subscribe("data", { onEvent: () => n++ });
	await wait(15);
	const first = FakeSource.all[0] as FakeSource;
	first.send(snap("data", "a.2"));
	first.onerror?.();
	await wait(30);
	const second = FakeSource.all[1] as FakeSource;
	expect(second).toBeDefined();
	second.send(snap("data", "a.2"));
	expect(n).toBe(1);
	// ...but one that shows events were missed is.
	second.send(snap("data", "a.5"));
	expect(n).toBe(2);
});

test("while the stream is down each subscriber's poll runs, and stops when it is back", async () => {
	const status: string[] = [];
	const s = make({ onStatus: (x: string) => status.push(x) });
	let polls = 0;
	s.subscribe("data", { onEvent: () => {}, poll: () => polls++, pollMs: 5 });
	await wait(15);
	const first = FakeSource.all[0] as FakeSource;
	first.send(snap("data", "a.0"));
	first.onerror?.();
	await wait(3);
	expect(status).toEqual(["live", "down"]);
	expect(polls).toBeGreaterThanOrEqual(1);
	await wait(30);
	(FakeSource.all.at(-1) as FakeSource).send(snap("data", "a.0"));
	const after = polls;
	await wait(25);
	expect(polls).toBe(after);
	expect(status.at(-1)).toBe("live");
});

test("a stream that never says anything counts as broken (a proxy is buffering it)", async () => {
	const s = make({ silenceMs: 10 });
	let polled = false;
	s.subscribe("data", { onEvent: () => {}, poll: () => (polled = true) });
	await wait(40);
	expect(polled).toBe(true);
});

test("unsubscribing the last topic hangs up", async () => {
	const s = make();
	const off = s.subscribe("data", { onEvent: () => {} });
	await wait(15);
	off();
	expect((FakeSource.all[0] as FakeSource).closed).toBe(true);
});

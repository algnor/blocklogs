import { expect, test } from "bun:test";
import { createEventHub } from "./hub";

test("delivers to subscribers with a counting seq, until they unsubscribe", () => {
	const hub = createEventHub();
	const got: [unknown, string][] = [];
	const off = hub.subscribe("data", (d, seq) => got.push([d, seq]));
	hub.emit("data", {});
	hub.emit("data", {});
	off();
	hub.emit("data", {});
	expect(got.map(([, s]) => s.split(".")[1])).toEqual(["1", "2"]);
	expect(hub.seq("data").split(".")[1]).toBe("3");
	expect(hub.seq("log").split(".")[1]).toBe("0");
});

test("topics are independent and a listener may unsubscribe while being called", () => {
	const hub = createEventHub();
	let calls = 0;
	const off = hub.subscribe("log", () => {
		calls++;
		off();
	});
	hub.subscribe("data", () => {
		throw new Error("not this topic");
	});
	hub.emit("log", { entries: [] });
	hub.emit("log", { entries: [] });
	expect(calls).toBe(1);
});

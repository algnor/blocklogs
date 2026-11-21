import { expect, test } from "bun:test";
import { bytes, duration, hours, parseTs, percent, relative } from "./format";

test("hours", () => {
	expect(hours(7153.24)).toBe("7,153.2h");
	expect(hours(0)).toBe("0.0h");
});

test("percent", () => expect(percent(0.1234)).toBe("12.3%"));

test("duration", () => {
	expect(duration(9)).toBe("9s");
	expect(duration(252)).toBe("4m 12s");
	expect(duration(3900)).toBe("1h 05m");
});

test("bytes", () => {
	expect(bytes(512)).toBe("512 B");
	expect(bytes(1536)).toBe("1.5 KiB");
	expect(bytes(5 * 1024 * 1024)).toBe("5.0 MiB");
});

test("parseTs handles log and ISO forms", () => {
	expect(parseTs("2026-01-02 03:04:05.000").toISOString()).toBe(
		"2026-01-02T03:04:05.000Z",
	);
	expect(parseTs("2026-01-02T03:04:05.000Z").getTime()).toBe(
		parseTs("2026-01-02 03:04:05.000").getTime(),
	);
});

test("relative", () => {
	const now = parseTs("2026-01-02 12:00:00.000").getTime();
	expect(relative(null, now)).toBe("never");
	expect(relative("2026-01-02 11:59:50.000", now)).toBe("just now");
	expect(relative("2026-01-02 11:30:00.000", now)).toBe("30m ago");
	expect(relative("2026-01-02 06:00:00.000", now)).toBe("6h ago");
	expect(relative("2025-12-30 12:00:00.000", now)).toBe("3d ago");
});

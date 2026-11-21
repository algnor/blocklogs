import { expect, test } from "bun:test";
import {
	formatRelativeTs,
	formatShortDate,
	formatShortTs,
	parseTs,
	secsToHours,
} from "./format";

test("parseTs reads bare timestamps as UTC and keeps explicit offsets", () => {
	expect(parseTs("2026-01-02 03:04:05").toISOString()).toBe(
		"2026-01-02T03:04:05.000Z",
	);
	expect(parseTs("2026-01-02T03:04:05Z").toISOString()).toBe(
		"2026-01-02T03:04:05.000Z",
	);
	expect(parseTs("2026-01-02T05:04:05+02:00").toISOString()).toBe(
		"2026-01-02T03:04:05.000Z",
	);
});

test("short formats cut the timestamp, and show a dash for none", () => {
	expect(formatShortTs("2026-01-02 03:04:05")).toBe("2026-01-02 03:04");
	expect(formatShortDate("2026-01-02 03:04:05")).toBe("2026-01-02");
	expect(formatShortTs(null)).toBe("-");
	expect(formatShortDate(null)).toBe("-");
});

test("secsToHours divides by 3600", () => {
	expect(secsToHours(5400)).toBe(1.5);
});

test("formatRelativeTs takes log timestamps, and null", () => {
	expect(formatRelativeTs(null)).toBe("never");
	const ago = new Date(Date.now() - 3 * 3600_000).toISOString();
	expect(formatRelativeTs(ago)).toBe("3h ago");
	const bare = new Date(Date.now() - 2 * 86400_000)
		.toISOString()
		.slice(0, 19)
		.replace("T", " ");
	expect(formatRelativeTs(bare)).toBe("2d ago");
});

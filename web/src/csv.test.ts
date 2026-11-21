import { expect, test } from "bun:test";
import type { GeoReport } from "../../shared/api";
import { geoCsv } from "./csv";

test("geoCsv rows", () => {
	const b = {
		secs: 7200,
		share: 0.5,
		players: 2,
		sessions: 3,
		avgSecsPerPlayer: 3600,
		topPlayers: [],
	};
	const report: GeoReport = {
		totalSecs: 14400,
		totals: { continents: 1, countries: 1, players: 2, sessions: 3 },
		continents: [
			{
				...b,
				code: "EU",
				name: "Europe",
				countries: [{ ...b, code: "DE", name: "Germany, Fed." }],
			},
		],
	};
	const lines = geoCsv(report).trim().split("\n");
	expect(lines).toHaveLength(3);
	expect(lines[2]).toBe('country,Europe,DE,"Germany, Fed.",2,50,2,3,1');
});

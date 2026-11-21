import type { GeoReport } from "../../shared/api";

export type Cell = string | number;

export function csvCell(v: Cell): string {
	const s = String(v);
	return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv(rows: Cell[][]): string {
	return `${rows.map((r) => r.map(csvCell).join(",")).join("\n")}\n`;
}

export function geoCsv(report: GeoReport): string {
	const rows: Cell[][] = [
		[
			"level",
			"continent",
			"code",
			"name",
			"hours",
			"share_percent",
			"players",
			"sessions",
			"avg_hours_per_player",
		],
	];
	const num = (n: number) => Math.round(n * 100) / 100;
	for (const c of report.continents) {
		rows.push([
			"continent",
			c.name,
			c.code,
			c.name,
			num(c.secs / 3600),
			num((c.secs / report.totalSecs) * 100),
			c.players,
			c.sessions,
			num(c.avgSecsPerPlayer / 3600),
		]);
		for (const k of c.countries)
			rows.push([
				"country",
				c.name,
				k.code,
				k.name,
				num(k.secs / 3600),
				num((k.secs / report.totalSecs) * 100),
				k.players,
				k.sessions,
				num(k.avgSecsPerPlayer / 3600),
			]);
	}
	return toCsv(rows);
}

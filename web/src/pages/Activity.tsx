import {
	Async,
	Card,
	Chart,
	type ChartSeries,
	Page,
} from "@aomc-server/block-ui";
import { formatHours, formatInt } from "@aomc-server/block-ui/format";
import { useState } from "preact/hooks";
import type { Activity, ActivitySlice } from "../../../shared/api";
import { useFetch } from "../hooks";
import { serverColor, serverName, statsQuery } from "../state";
import { DateRange } from "../ui/DateRange";

type Metric = "hours" | "players" | "sessions";
const METRICS: { id: Metric; label: string }[] = [
	{ id: "hours", label: "Hours" },
	{ id: "players", label: "Unique players" },
	{ id: "sessions", label: "Sessions" },
];

/** One stacked segment per server, in the server's colour, from the same chart of each. */
function perServer(
	a: Activity,
	pick: (slice: ActivitySlice) => number[],
): ChartSeries[] {
	return Object.keys(a.byServer)
		.map(Number)
		.sort((x, y) => x - y)
		.map((id) => ({
			key: String(id),
			label: serverName(id),
			color: serverColor(id),
			values: pick(a.byServer[id] as ActivitySlice),
		}));
}

/** The same days for every slice, without the empty ones at either end, so the chart fills its width. */
function trimDays(a: Activity): Activity {
	const active = (i: number) =>
		(a.daily[i]?.sessions ?? 0) > 0 || (a.daily[i]?.hours ?? 0) > 0;
	let from = 0;
	let to = a.daily.length - 1;
	while (from < to && !active(from)) from++;
	while (to > from && !active(to)) to--;
	if (from === 0 && to === a.daily.length - 1) return a;
	const cut = <T extends ActivitySlice>(sl: T): T => ({
		...sl,
		daily: sl.daily.slice(from, to + 1),
	});
	return {
		...cut(a),
		byServer: Object.fromEntries(
			Object.entries(a.byServer).map(([id, sl]) => [id, cut(sl)]),
		),
	};
}

export function ActivityPage() {
	const [metric, setMetric] = useState<Metric>("hours");
	const state = useFetch<Activity>("/api/activity", statsQuery());

	return (
		<Page embedded stack title="Activity" actions={<DateRange />}>
			<Async state={state}>
				{(full) => {
					const a = trimDays(full);
					return (
						<>
							<Card
								title="Daily activity"
								actions={METRICS.map((m) => (
									<button
										key={m.id}
										type="button"
										class={`btn small ${metric === m.id ? "active" : ""}`}
										aria-pressed={metric === m.id}
										onClick={() => setMetric(m.id)}
									>
										{m.label}
									</button>
								))}
							>
								<Chart
									kind="bars"
									xs={a.daily.map((_, i) => i)}
									series={perServer(a, (sl) => sl.daily.map((d) => d[metric]))}
									formatY={(v) =>
										metric === "hours"
											? formatHours(v)
											: formatInt(Math.round(v))
									}
									formatX={(i) => a.daily[i]?.date.slice(5) ?? ""}
									formatTip={(i) => a.daily[i]?.date ?? ""}
									note={(i) => {
										const d = a.daily[i];
										if (!d) return null;
										return metric === "hours"
											? `${formatHours(d.hours)} in total`
											: metric === "players"
												? `${formatInt(d.players)} distinct players in total`
												: `${formatInt(d.sessions)} sessions in total`;
									}}
								/>
							</Card>
							<Card title="Average concurrent players by hour (UTC)">
								<Chart
									kind="bars"
									xs={a.hourOfDay.map((h) => h.hour)}
									series={perServer(a, (sl) =>
										sl.hourOfDay.map((h) => h.avgPlayers),
									)}
									formatY={(v) => v.toFixed(1)}
									formatX={(h) => `${String(h).padStart(2, "0")}:00`}
									note={(i) =>
										`${formatInt(a.hourOfDay[i]?.sessions ?? 0)} sessions started`
									}
								/>
							</Card>
							<Card title="Session length">
								<Chart
									kind="bars"
									xs={a.lengths.map((_, i) => i)}
									series={perServer(a, (sl) => sl.lengths.map((l) => l.count))}
									formatY={(v) => formatInt(Math.round(v))}
									formatX={(i) => a.lengths[i]?.label ?? ""}
									note={(i) =>
										`${formatInt(a.lengths[i]?.count ?? 0)} sessions in total`
									}
								/>
							</Card>
						</>
					);
				}}
			</Async>
		</Page>
	);
}

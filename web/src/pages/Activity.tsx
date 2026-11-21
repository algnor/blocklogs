import { useState } from "preact/hooks";
import type { Activity, ActivitySlice } from "../../../shared/api";
import { hours, int } from "../format";
import { useFetch } from "../hooks";
import { serverColor, serverName, statsQuery } from "../state";
import { Chart, type ChartSeries } from "../ui/Chart";
import { Async, Card, Page } from "../ui/common";
import { RangePicker } from "../ui/RangePicker";

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

export function ActivityPage() {
	const [metric, setMetric] = useState<Metric>("hours");
	const state = useFetch<Activity>("/api/activity", statsQuery());

	return (
		<Page title="Activity" actions={<RangePicker />}>
			<Async state={state}>
				{(a) => (
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
									metric === "hours" ? hours(v) : int(Math.round(v))
								}
								formatX={(i) => a.daily[i]?.date.slice(5) ?? ""}
								formatTip={(i) => a.daily[i]?.date ?? ""}
								note={(i) => {
									const d = a.daily[i];
									if (!d) return null;
									return metric === "hours"
										? `${hours(d.hours)} in total`
										: metric === "players"
											? `${int(d.players)} distinct players in total`
											: `${int(d.sessions)} sessions in total`;
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
									`${int(a.hourOfDay[i]?.sessions ?? 0)} sessions started`
								}
							/>
						</Card>
						<Card title="Session length">
							<Chart
								kind="bars"
								xs={a.lengths.map((_, i) => i)}
								series={perServer(a, (sl) => sl.lengths.map((l) => l.count))}
								formatY={(v) => int(Math.round(v))}
								formatX={(i) => a.lengths[i]?.label ?? ""}
								note={(i) =>
									`${int(a.lengths[i]?.count ?? 0)} sessions in total`
								}
							/>
						</Card>
					</>
				)}
			</Async>
		</Page>
	);
}

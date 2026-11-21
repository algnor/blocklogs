import { Async, Page, Toggle } from "@aomc-server/block-ui";
import {
	formatHours,
	formatInt,
	formatPercent,
} from "@aomc-server/block-ui/format";
import { useState } from "preact/hooks";
import type { GeoBucket, GeoReport } from "../../../shared/api";
import { geoCsv } from "../csv";
import { secsToHours } from "../format";
import { useFetch } from "../hooks";
import { statsQuery } from "../state";
import { PlayerLink } from "../ui/common";
import { DateRange } from "../ui/DateRange";

function download(name: string, text: string) {
	const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
	const a = document.createElement("a");
	a.href = url;
	a.download = name;
	a.click();
	URL.revokeObjectURL(url);
}

function Cells(props: { b: GeoBucket; total: number }) {
	const { b } = props;
	const share = props.total > 0 ? b.secs / props.total : 0;
	return (
		<>
			<td class="num">{formatHours(secsToHours(b.secs))}</td>
			<td class="share">
				<span class="share-bar">
					<span
						class="share-fill"
						style={{ width: `${Math.min(100, share * 100)}%` }}
					/>
				</span>
				<span class="num">{formatPercent(share)}</span>
			</td>
			<td class="num">{formatInt(b.players)}</td>
			<td class="num">{formatInt(b.sessions)}</td>
			<td class="num">{formatHours(secsToHours(b.avgSecsPerPlayer))}</td>
		</>
	);
}

function TopPlayers(props: { b: GeoBucket }) {
	return (
		<tr class="detail">
			<td colSpan={7}>
				<span class="muted">Top players: </span>
				{props.b.topPlayers.length === 0 && <span class="faint">none</span>}
				{props.b.topPlayers.map((p) => (
					<span key={p.player} class="top-player">
						<PlayerLink name={p.player} />{" "}
						<span class="muted">{formatHours(secsToHours(p.secs))}</span>
					</span>
				))}
			</td>
		</tr>
	);
}

export function GeoPage() {
	const [perPlayer, setPerPlayer] = useState(false);
	const [open, setOpen] = useState<Set<string>>(new Set());
	const state = useFetch<GeoReport>("/api/geo", { ...statsQuery(), perPlayer });
	const toggle = (key: string) => {
		const n = new Set(open);
		if (!n.delete(key)) n.add(key);
		setOpen(n);
	};

	return (
		<Page
			embedded
			stack
			title="Geo"
			actions={
				<>
					<DateRange />
					<button
						type="button"
						class="btn small"
						disabled={!state.data}
						onClick={() =>
							state.data && download("geo.csv", geoCsv(state.data))
						}
					>
						Download CSV
					</button>
				</>
			}
		>
			<div class="toolbar">
				<Toggle
					inline
					bold
					checked={perPlayer}
					onChange={setPerPlayer}
					label="Attribute each player to their main country"
				/>
			</div>
			<Async state={state}>
				{(r) => (
					<>
						<p class="summary">
							total {formatHours(secsToHours(r.totalSecs))} |{" "}
							{formatInt(r.totals.continents)} continents,{" "}
							{formatInt(r.totals.countries)} countries,{" "}
							{formatInt(r.totals.players)} players,{" "}
							{formatInt(r.totals.sessions)} sessions
						</p>
						{r.continents.length === 0 ? (
							<p class="muted state">No data in this range.</p>
						) : (
							<div class="table-wrap">
								<table class="table geo">
									<thead>
										<tr>
											<th class="num">#</th>
											<th>Continent / country</th>
											<th class="num">Playtime</th>
											<th>Share</th>
											<th class="num">Players</th>
											<th class="num">Sessions</th>
											<th class="num">Avg/player</th>
										</tr>
									</thead>
									<tbody>
										{r.continents.map((c, i) => {
											const ckey = `c:${c.code}`;
											const isOpen = open.has(ckey);
											return [
												<tr key={ckey} class="continent">
													<td class="num">{i + 1}</td>
													<td>
														<button
															type="button"
															class="plain expander"
															aria-expanded={isOpen}
															onClick={() => toggle(ckey)}
														>
															{isOpen ? "▾" : "▸"} {c.name}
														</button>
													</td>
													<Cells b={c} total={r.totalSecs} />
												</tr>,
												isOpen && <TopPlayers key={`${ckey}-top`} b={c} />,
												...(isOpen
													? c.countries.flatMap((k, j) => {
															const kkey = `k:${c.code}:${k.code}`;
															const kOpen = open.has(kkey);
															return [
																<tr key={kkey} class="country">
																	<td class="num">{j + 1}</td>
																	<td class="indent">
																		<button
																			type="button"
																			class="plain expander"
																			aria-expanded={kOpen}
																			onClick={() => toggle(kkey)}
																		>
																			{kOpen ? "▾" : "▸"} {k.name}{" "}
																			<span class="faint">{k.code}</span>
																		</button>
																	</td>
																	<Cells b={k} total={r.totalSecs} />
																</tr>,
																kOpen && (
																	<TopPlayers key={`${kkey}-top`} b={k} />
																),
															];
														})
													: []),
											];
										})}
									</tbody>
								</table>
							</div>
						)}
					</>
				)}
			</Async>
			<p class="muted small-text credit">
				IP geolocation by{" "}
				<a href="https://db-ip.com" target="_blank" rel="noreferrer">
					DB-IP (https://db-ip.com)
				</a>
				, CC BY 4.0
			</p>
		</Page>
	);
}

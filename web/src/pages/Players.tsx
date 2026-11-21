import { useState } from "preact/hooks";
import type { PlayerList } from "../../../shared/api";
import { hours, int, shortDate } from "../format";
import { useDebounced, useFetch, usePageOffset } from "../hooks";
import { navigate } from "../router";
import { statsQuery } from "../state";
import {
	Async,
	Avatar,
	Empty,
	Page,
	Pager,
	rowKey,
	ServerDots,
	SortTh,
} from "../ui/common";
import { RangePicker } from "../ui/RangePicker";

const LIMIT = 50;

export function PlayersPage() {
	const [q, setQ] = useState("");
	const [sort, setSort] = useState("hours");
	const [dir, setDir] = useState<"asc" | "desc">("desc");
	const dq = useDebounced(q.trim());
	const params = { ...statsQuery(), q: dq, sort, dir };
	const [offset, setOffset] = usePageOffset(JSON.stringify(params));
	const state = useFetch<PlayerList>("/api/players", {
		...params,
		limit: LIMIT,
		offset,
	});
	const onSort = (col: string) => {
		if (col === sort) setDir(dir === "asc" ? "desc" : "asc");
		else {
			setSort(col);
			setDir(col === "player" ? "asc" : "desc");
		}
		setOffset(0);
	};
	const th = (label: string, col: string, num = true) => (
		<SortTh
			label={label}
			col={col}
			sort={sort}
			dir={dir}
			onSort={onSort}
			num={num}
		/>
	);

	return (
		<Page title="Players" actions={<RangePicker />}>
			<div class="toolbar">
				<input
					type="search"
					placeholder="Search players…"
					aria-label="Search players"
					value={q}
					onInput={(e) => {
						setQ(e.currentTarget.value);
						setOffset(0);
					}}
				/>
			</div>
			<Async state={state}>
				{(d) =>
					d.rows.length === 0 ? (
						<Empty>No players match.</Empty>
					) : (
						<>
							<div class="table-wrap">
								<table class="stats-table">
									<thead>
										<tr>
											{th("Player", "player", false)}
											<th>Servers</th>
											{th("Hours", "hours")}
											{th("Sessions", "sessions")}
											{th("First seen", "firstSeen", false)}
											{th("Last seen", "lastSeen", false)}
											{th("Messages", "messages")}
											<th class="num">Commands</th>
											<th class="num">IPs</th>
										</tr>
									</thead>
									<tbody>
										{d.rows.map((p) => {
											const open = () =>
												navigate(`/players/${encodeURIComponent(p.player)}`);
											return (
												<tr
													key={p.player}
													class="click"
													tabIndex={0}
													onClick={open}
													onKeyDown={(e) => rowKey(e, open)}
												>
													<td>
														<span class="player-link">
															<Avatar name={p.player} size={20} />
															{p.player}
														</span>
													</td>
													<td>
														<ServerDots ids={p.serverIds} />
													</td>
													<td class="num">{hours(p.hours)}</td>
													<td class="num">{int(p.sessions)}</td>
													<td>{shortDate(p.firstSeen)}</td>
													<td>{shortDate(p.lastSeen)}</td>
													<td class="num">{int(p.messages)}</td>
													<td class="num">{int(p.commands)}</td>
													<td class="num">{int(p.distinctIps)}</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							</div>
							<Pager
								offset={offset}
								limit={LIMIT}
								total={d.total}
								onChange={setOffset}
							/>
						</>
					)
				}
			</Async>
		</Page>
	);
}

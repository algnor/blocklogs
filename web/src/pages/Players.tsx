import {
	Async,
	Avatar,
	Empty,
	Page,
	Pager,
	rowKey,
	SortTh,
} from "@aomc-server/block-ui";
import {
	formatHours,
	formatInt,
	formatShortDate,
} from "@aomc-server/block-ui/format";
import { useDebounced, usePageOffset } from "@aomc-server/block-ui/hooks";
import { useState } from "preact/hooks";
import type { PlayerList } from "../../../shared/api";
import { useFetch } from "../hooks";
import { navigate } from "../router";
import { statsQuery } from "../state";
import { ServerDots } from "../ui/common";
import { DateRange } from "../ui/DateRange";

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
		<Page embedded stack title="Players" actions={<DateRange />}>
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
								<table class="table">
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
													<td class="num">{formatHours(p.hours)}</td>
													<td class="num">{formatInt(p.sessions)}</td>
													<td>{formatShortDate(p.firstSeen)}</td>
													<td>{formatShortDate(p.lastSeen)}</td>
													<td class="num">{formatInt(p.messages)}</td>
													<td class="num">{formatInt(p.commands)}</td>
													<td class="num">{formatInt(p.distinctIps)}</td>
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

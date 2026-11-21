import { useState } from "preact/hooks";
import type { MessageList, SessionList } from "../../../shared/api";
import { duration, shortTs } from "../format";
import { useDebounced, useFetch, usePageOffset } from "../hooks";
import { loc, setQuery } from "../router";
import { statsQuery } from "../state";
import { Async, Dot, Empty, Link, Page, Pager, PlayerLink } from "../ui/common";
import { RangePicker } from "../ui/RangePicker";

const LIMIT = 100;
const TABS = [
	{ id: "sessions", label: "Sessions" },
	{ id: "chat", label: "Chat" },
	{ id: "cmd", label: "Commands" },
] as const;

function Sessions(props: { player: string }) {
	const params = { ...statsQuery(), player: props.player };
	const [offset, setOffset] = usePageOffset(JSON.stringify(params));
	const state = useFetch<SessionList>("/api/sessions", {
		...params,
		limit: LIMIT,
		offset,
	});
	return (
		<Async state={state}>
			{(d) =>
				d.rows.length === 0 ? (
					<Empty>No sessions.</Empty>
				) : (
					<>
						<div class="table-wrap">
							<table class="stats-table">
								<thead>
									<tr>
										<th>Player</th>
										<th>Server</th>
										<th>Start (UTC)</th>
										<th>End (UTC)</th>
										<th class="num">Length</th>
										<th>Ended by</th>
										<th>Country</th>
									</tr>
								</thead>
								<tbody>
									{d.rows.map((s) => (
										<tr key={`${s.serverId}-${s.player}-${s.start}`}>
											<td>
												<PlayerLink name={s.player} />
											</td>
											<td>
												<Dot id={s.serverId} label />
											</td>
											<td>{shortTs(s.start)}</td>
											<td>{shortTs(s.end)}</td>
											<td class="num">{duration(s.secs)}</td>
											<td>{s.closedBy}</td>
											<td>{s.country ?? "-"}</td>
										</tr>
									))}
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
	);
}

function Messages(props: { type: "chat" | "cmd"; player: string; q: string }) {
	const params = {
		...statsQuery(),
		type: props.type,
		player: props.player,
		q: props.q,
	};
	const [offset, setOffset] = usePageOffset(JSON.stringify(params));
	const state = useFetch<MessageList>("/api/messages", {
		...params,
		limit: LIMIT,
		offset,
	});
	return (
		<Async state={state}>
			{(d) =>
				d.rows.length === 0 ? (
					<Empty>No messages.</Empty>
				) : (
					<>
						<div class="table-wrap">
							<table class="stats-table">
								<thead>
									<tr>
										<th>Time (UTC)</th>
										<th>Server</th>
										<th>Player</th>
										<th>
											{props.type === "cmd" ? "Command / result" : "Message"}
										</th>
									</tr>
								</thead>
								<tbody>
									{d.rows.map((m) => (
										<tr key={`${m.serverId}-${m.ts}-${m.player}-${m.text}`}>
											<td class="nowrap">{shortTs(m.ts)}</td>
											<td>
												<Dot id={m.serverId} label />
											</td>
											<td>
												<PlayerLink name={m.player} />
											</td>
											<td class="wrap">{m.text}</td>
										</tr>
									))}
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
	);
}

export function LogsPage(props: { tab: "sessions" | "chat" | "cmd" }) {
	const player = loc.value.query.player ?? "";
	const [q, setQ] = useState("");
	const dq = useDebounced(q.trim());
	const dPlayer = useDebounced(player.trim());
	// Remount the list when a filter changes so pagination restarts at page one.
	const listKey = `${props.tab}|${dq}|${dPlayer}`;

	return (
		<Page title="Logs" actions={<RangePicker />}>
			<div class="tabs" role="tablist">
				{TABS.map((t) => (
					<Link
						key={t.id}
						to={`/logs/${t.id}${player ? `?player=${encodeURIComponent(player)}` : ""}`}
						class={`tab ${props.tab === t.id ? "active" : ""}`}
					>
						{t.label}
					</Link>
				))}
			</div>
			<div class="toolbar">
				<input
					type="search"
					placeholder="Filter by player…"
					aria-label="Filter by player"
					value={player}
					onInput={(e) => setQuery({ player: e.currentTarget.value })}
				/>
				{props.tab !== "sessions" && (
					<input
						type="search"
						placeholder="Search text…"
						aria-label="Search text"
						value={q}
						onInput={(e) => setQ(e.currentTarget.value)}
					/>
				)}
			</div>
			{props.tab === "cmd" && (
				<p class="muted hint">
					Most servers don't log the commands players type. Where they don't,
					this lists operator command feedback instead (what the command did,
					e.g. "Set own game mode to Creative Mode").
				</p>
			)}
			{props.tab === "sessions" ? (
				<Sessions key={listKey} player={dPlayer} />
			) : (
				<Messages key={listKey} type={props.tab} player={dPlayer} q={dq} />
			)}
		</Page>
	);
}

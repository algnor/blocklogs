import { Async, Empty, Page, Pager, Tabs } from "@aomc-server/block-ui";
import { formatElapsed } from "@aomc-server/block-ui/format";
import { useDebounced, usePageOffset } from "@aomc-server/block-ui/hooks";
import { useState } from "preact/hooks";
import type { MessageList, SessionList } from "../../../shared/api";
import { formatShortTs } from "../format";
import { useFetch } from "../hooks";
import { loc, navigate, setQuery } from "../router";
import { statsQuery } from "../state";
import { PlayerLink, ServerDot } from "../ui/common";
import { DateRange } from "../ui/DateRange";

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
							<table class="table">
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
												<ServerDot id={s.serverId} label />
											</td>
											<td>{formatShortTs(s.start)}</td>
											<td>{formatShortTs(s.end)}</td>
											<td class="num">{formatElapsed(s.secs)}</td>
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
							<table class="table">
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
											<td class="nowrap">{formatShortTs(m.ts)}</td>
											<td>
												<ServerDot id={m.serverId} label />
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
	const tabHref = (id: string) =>
		`/logs/${id}${player ? `?player=${encodeURIComponent(player)}` : ""}`;
	// Remount the list when a filter changes so pagination restarts at page one.
	const listKey = `${props.tab}|${dq}|${dPlayer}`;

	return (
		<Page embedded stack title="Logs" actions={<DateRange />}>
			<Tabs
				label="Log"
				value={props.tab}
				tabs={TABS.map((t) => ({ ...t, href: tabHref(t.id) }))}
				onChange={(id) => navigate(tabHref(id))}
			/>
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

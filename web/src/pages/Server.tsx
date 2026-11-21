import {
	Async,
	Card,
	Chart,
	Empty,
	Loading,
	Page,
	Progress,
	Tile,
} from "@aomc-server/block-ui";
import {
	formatBytes,
	formatElapsed,
	formatHours,
	formatInt,
	formatPercent,
} from "@aomc-server/block-ui/format";
import type {
	Activity,
	CrashList,
	GeoReport,
	PlayerList,
	ServerInfo,
	ServerSummary,
	SessionList,
} from "../../../shared/api";
import { startReparse, startSync } from "../actions";
import {
	formatRelativeTs,
	formatShortDate,
	formatShortTs,
	secsToHours,
} from "../format";
import { useFetch } from "../hooks";
import { servers } from "../live";
import { serverColor, serverQuery, setSelectedServers } from "../state";
import { ActivityLog } from "../ui/ActivityLog";
import { Link, PlayerLink, syncLabel } from "../ui/common";
import { DateRange } from "../ui/DateRange";

const BACKENDS = { sftp: "SFTP", ptero: "Panel API", local: "Local directory" };

/** When the next sync is due, from the last one and the interval. */
function nextSync(s: ServerSummary): string {
	if (!s.enabled) return "disabled";
	if (!s.panelId) return "no source set";
	if (s.lastSyncStatus === "running") return "now";
	if (!s.lastSyncAt) return "soon";
	const due = new Date(s.lastSyncAt).getTime() + s.syncIntervalMin * 60_000;
	const mins = Math.ceil((due - Date.now()) / 60_000);
	return mins <= 0 ? "due" : `in ${mins}m`;
}

function StatusCard(props: { s: ServerSummary }) {
	const { s } = props;
	const running = s.lastSyncStatus === "running" || !!s.progress;
	const status = running ? "running" : (s.lastSyncStatus ?? "never");
	return (
		<Card
			title="Sync"
			actions={
				<>
					<span class={`badge ${status}`}>{status}</span>
					<button
						type="button"
						class="btn small"
						disabled={running}
						onClick={() => void startSync(s.id)}
					>
						Sync now
					</button>
					<button
						type="button"
						class="btn small"
						disabled={running}
						title="Read every stored file again, for after the parser changed"
						onClick={() => void startReparse(s.id, s.name)}
					>
						Re-parse
					</button>
				</>
			}
		>
			{s.progress && (
				<Progress
					value={
						s.progress.total ? s.progress.done / s.progress.total : undefined
					}
					label={syncLabel(s.progress)}
				/>
			)}
			{s.lastSyncStatus === "error" && s.lastSyncError && (
				<p class="error-text">{s.lastSyncError}</p>
			)}
			<div class="kv left">
				<span>Last sync</span>
				<b>{formatRelativeTs(s.lastSyncAt)}</b>
				<span>Next sync</span>
				<b>
					{nextSync(s)}{" "}
					<span class="muted">(every {s.syncIntervalMin} min)</span>
				</b>
				<span>Fetched with</span>
				<b>{BACKENDS[s.backend]}</b>
				<span>Source</span>
				<b class="mono wrap">{s.panelId ?? "-"}</b>
				<span>Log / crash folders</span>
				<b class="mono wrap">
					{s.logDir} · {s.crashDir}
				</b>
				<span>Game</span>
				<b>{s.game}</b>
			</div>
			<div class="card-foot">
				<Link to="/settings" class="btn small">
					Edit in Settings
				</Link>
			</div>
		</Card>
	);
}

function Tiles(props: { s: ServerSummary; info: ServerInfo | null }) {
	const { s, info } = props;
	return (
		<div class="tiles">
			<Tile label="Online now" value={formatInt(s.online.length)} />
			<Tile label="Players" value={formatInt(s.players)} />
			<Tile label="Sessions" value={formatInt(s.sessions)} />
			<Tile label="Total hours" value={formatHours(s.hoursTotal)} />
			<Tile label="Hours (7d)" value={formatHours(s.hours7d)} />
			<Tile label="Hours (30d)" value={formatHours(s.hours30d)} />
			<Tile label="Crashes" value={formatInt(s.crashes)} />
			<Tile
				label="Peak players"
				value={info?.peak ? formatInt(info.peak.players) : "-"}
			/>
			<Tile
				label="Average session"
				value={
					info?.sessions.total ? formatElapsed(info.sessions.avgSecs) : "-"
				}
			/>
		</div>
	);
}

function OnlineCard(props: { s: ServerSummary }) {
	const { s } = props;
	return (
		<Card title={`Online now (${s.online.length})`}>
			{s.online.length === 0 ? (
				<p class="faint">Nobody.</p>
			) : (
				<div class="online">
					{s.online.map((n) => (
						<span key={n}>
							<Link to={`/players/${encodeURIComponent(n)}`} class="chip">
								{n}
							</Link>{" "}
						</span>
					))}
				</div>
			)}
		</Card>
	);
}

function ChartsCard(props: { id: number }) {
	const state = useFetch<Activity>("/api/activity", serverQuery(props.id));
	const color = serverColor(props.id);
	return (
		<>
			<Card title="Hours per day">
				<Async state={state}>
					{(a) => (
						<Chart
							kind="bars"
							xs={a.daily.map((_, i) => i)}
							series={[
								{
									key: "hours",
									label: "Hours",
									color,
									values: a.daily.map((d) => d.hours),
								},
							]}
							formatY={(v) => formatHours(v)}
							formatX={(i) => a.daily[i]?.date.slice(5) ?? ""}
							formatTip={(i) => a.daily[i]?.date ?? ""}
							note={(i) =>
								`${formatInt(a.daily[i]?.players ?? 0)} players · ${formatInt(a.daily[i]?.sessions ?? 0)} sessions`
							}
						/>
					)}
				</Async>
			</Card>
			<Card title="Average players by hour (UTC)">
				<Async state={state}>
					{(a) => (
						<Chart
							kind="bars"
							xs={a.hourOfDay.map((h) => h.hour)}
							series={[
								{
									key: "avg",
									label: "Avg players",
									color,
									values: a.hourOfDay.map((h) => h.avgPlayers),
								},
							]}
							formatY={(v) => v.toFixed(1)}
							formatX={(h) => `${String(h).padStart(2, "0")}:00`}
							note={(i) =>
								`${formatInt(a.hourOfDay[i]?.sessions ?? 0)} sessions started`
							}
						/>
					)}
				</Async>
			</Card>
		</>
	);
}

function TopPlayers(props: { id: number }) {
	const state = useFetch<PlayerList>("/api/players", {
		...serverQuery(props.id),
		sort: "hours",
		dir: "desc",
		limit: 10,
	});
	return (
		<Card
			title="Top players"
			actions={
				<Link to="/players" class="btn small">
					All players
				</Link>
			}
		>
			<Async state={state}>
				{(d) =>
					d.rows.length === 0 ? (
						<Empty>No players in this range.</Empty>
					) : (
						<div class="table-wrap">
							<table class="table">
								<thead>
									<tr>
										<th>Player</th>
										<th class="num">Hours</th>
										<th class="num">Sessions</th>
										<th>Last seen</th>
									</tr>
								</thead>
								<tbody>
									{d.rows.map((p) => (
										<tr key={p.player}>
											<td>
												<PlayerLink name={p.player} />
											</td>
											<td class="num">{formatHours(p.hours)}</td>
											<td class="num">{formatInt(p.sessions)}</td>
											<td>{formatShortDate(p.lastSeen)}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)
				}
			</Async>
		</Card>
	);
}

function RecentSessions(props: { id: number }) {
	const state = useFetch<SessionList>("/api/sessions", {
		...serverQuery(props.id),
		limit: 10,
	});
	return (
		<Card
			title="Recent sessions"
			actions={
				<Link to={`/logs?servers=${props.id}`} class="btn small">
					All sessions
				</Link>
			}
		>
			<Async state={state}>
				{(d) =>
					d.rows.length === 0 ? (
						<Empty>No sessions in this range.</Empty>
					) : (
						<div class="table-wrap">
							<table class="table">
								<thead>
									<tr>
										<th>Start (UTC)</th>
										<th>Player</th>
										<th class="num">Length</th>
										<th>Ended</th>
									</tr>
								</thead>
								<tbody>
									{d.rows.map((r) => (
										<tr key={`${r.player}-${r.start}`}>
											<td class="nowrap">{formatShortTs(r.start)}</td>
											<td>
												<PlayerLink name={r.player} />
											</td>
											<td class="num">{formatElapsed(r.secs)}</td>
											<td>
												<span
													class={r.closedBy === "crash" ? "error-text" : ""}
													title={
														r.closedBy === "crash"
															? "The server restarted without stopping"
															: ""
													}
												>
													{r.closedBy}
												</span>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)
				}
			</Async>
		</Card>
	);
}

function RecentCrashes(props: { id: number }) {
	const state = useFetch<CrashList>("/api/crashes", {
		servers: String(props.id),
		limit: 5,
	});
	return (
		<Card
			title="Crashes"
			actions={
				<Link to={`/crashes?servers=${props.id}`} class="btn small">
					All crashes
				</Link>
			}
		>
			<Async state={state}>
				{(d) =>
					d.rows.length === 0 ? (
						<Empty>No crash reports.</Empty>
					) : (
						<div class="table-wrap">
							<table class="table">
								<thead>
									<tr>
										<th>Time (UTC)</th>
										<th>Description</th>
										<th>Suspects</th>
									</tr>
								</thead>
								<tbody>
									{d.rows.map((c) => (
										<tr key={c.fileId}>
											<td class="nowrap">{formatShortTs(c.ts)}</td>
											<td class="wrap">
												{c.description ?? c.exception ?? c.name}
											</td>
											<td class="wrap">{c.suspects ?? "-"}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)
				}
			</Async>
		</Card>
	);
}

function Countries(props: { id: number }) {
	const state = useFetch<GeoReport>("/api/geo", serverQuery(props.id));
	return (
		<Card
			title="Where players are from"
			actions={
				<Link to={`/geo?servers=${props.id}`} class="btn small">
					Full report
				</Link>
			}
		>
			<Async state={state}>
				{(g) => {
					const top = g.continents
						.flatMap((c) => c.countries)
						.sort((a, b) => b.secs - a.secs)
						.slice(0, 6);
					return top.length === 0 ? (
						<Empty>No location data in this range.</Empty>
					) : (
						<div class="table-wrap">
							<table class="table">
								<thead>
									<tr>
										<th>Country</th>
										<th class="num">Hours</th>
										<th class="num">Share</th>
										<th class="num">Players</th>
									</tr>
								</thead>
								<tbody>
									{top.map((c) => (
										<tr key={c.code}>
											<td>{c.name}</td>
											<td class="num">{formatHours(secsToHours(c.secs))}</td>
											<td class="num">{formatPercent(c.share / 100)}</td>
											<td class="num">{formatInt(c.players)}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					);
				}}
			</Async>
		</Card>
	);
}

function StoredData(props: { info: ServerInfo }) {
	const { info } = props;
	const ended = Object.entries(info.sessions.endedBy).sort(
		(a, b) => b[1] - a[1],
	);
	return (
		<Card title="Stored data (all time)">
			<div class="kv left">
				<span>Data covers</span>
				<b>
					{info.range.first
						? `${formatShortDate(info.range.first)} to ${formatShortDate(info.range.last)}`
						: "nothing yet"}
				</b>
				<span>Log files</span>
				<b>{formatInt(info.files.logs)}</b>
				<span>Crash reports</span>
				<b>{formatInt(info.files.crashes)}</b>
				<span>Size on the server</span>
				<b>{formatBytes(info.files.bytes)}</b>
				<span>Files with problems</span>
				<b class={info.files.withErrors ? "error-text" : ""}>
					{formatInt(info.files.withErrors)}
				</b>
				<span>Last file stored</span>
				<b>{formatRelativeTs(info.files.lastIngestedAt)}</b>
				<span>Chat / commands / logins</span>
				<b>
					{formatInt(info.events.chat)} / {formatInt(info.events.commands)} /{" "}
					{formatInt(info.events.joins)}
				</b>
				<span>Names in usercache</span>
				<b>{formatInt(info.usercache)}</b>
				<span>Longest session</span>
				<b>
					{info.sessions.longest
						? `${formatElapsed(info.sessions.longest.secs)} (${info.sessions.longest.player}, ${formatShortDate(info.sessions.longest.start)})`
						: "-"}
				</b>
				<span>Peak players</span>
				<b>
					{info.peak
						? `${info.peak.players} on ${formatShortTs(info.peak.at)}`
						: "-"}
				</b>
				<span>Sessions ended by</span>
				<b>
					{ended.length === 0
						? "-"
						: ended.map(([k, n], i) => (
								<span key={k} class={k === "crash" ? "error-text" : ""}>
									{i > 0 && " · "}
									{k} {formatInt(n)}
								</span>
							))}
				</b>
			</div>
		</Card>
	);
}

export function ServerPage(props: { id: number }) {
	const list = servers.value;
	const s = list?.find((x) => x.id === props.id);
	// Not asked for a server that does not exist.
	const info = useFetch<ServerInfo>(s ? `/api/servers/${props.id}/info` : null);

	if (!list)
		return (
			<Page embedded title="Server">
				<Loading />
			</Page>
		);
	if (!s)
		return (
			<Page embedded title="Server">
				<Card>
					<Empty>
						No such server. <Link to="/">Back to the overview</Link>
					</Empty>
				</Card>
			</Page>
		);

	return (
		<Page
			embedded
			stack
			title={s.name}
			actions={
				<>
					<DateRange />
					<Link to="/" class="btn small">
						Overview
					</Link>
					<button
						type="button"
						class="btn small"
						onClick={() => {
							setSelectedServers([s.id]);
						}}
						title="Make the other pages show only this server"
					>
						Only this server
					</button>
				</>
			}
		>
			<Tiles s={s} info={info.data} />
			<div class="page-split">
				<StatusCard s={s} />
				<OnlineCard s={s} />
			</div>
			<div class="page-split">
				<ChartsCard id={s.id} />
			</div>
			<div class="page-split">
				<TopPlayers id={s.id} />
				<RecentSessions id={s.id} />
			</div>
			<div class="page-split">
				<RecentCrashes id={s.id} />
				<Countries id={s.id} />
			</div>
			{info.data && <StoredData info={info.data} />}
			<ActivityLog serverIds={[s.id]} />
		</Page>
	);
}

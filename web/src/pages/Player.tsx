import {
	Async,
	Avatar,
	Card,
	Empty,
	Page,
	Tile,
	Toggle,
} from "@aomc-server/block-ui";
import {
	formatElapsed,
	formatHours,
	formatInt,
} from "@aomc-server/block-ui/format";
import { useState } from "preact/hooks";
import type { PlayerProfile } from "../../../shared/api";
import { formatShortTs } from "../format";
import { useFetch } from "../hooks";
import { buildSearch } from "../router";
import { Link, ServerDot, ServerDots } from "../ui/common";

export function PlayerPage(props: { name: string }) {
	const state = useFetch<PlayerProfile>(
		`/api/players/${encodeURIComponent(props.name)}`,
	);
	const [showIps, setShowIps] = useState(false);
	const filter = buildSearch({ player: props.name });

	return (
		<Page
			embedded
			stack
			title={props.name}
			back={
				<Link to="/players" class="btn small">
					← Players
				</Link>
			}
		>
			<Async state={state}>
				{(p) => {
					const totalHours = p.perServer.reduce((a, s) => a + s.hours, 0);
					const totalSessions = p.perServer.reduce((a, s) => a + s.sessions, 0);
					const msgs = p.perServer.reduce((a, s) => a + s.messages, 0);
					const cmds = p.perServer.reduce((a, s) => a + s.commands, 0);
					const first = p.perServer.map((s) => s.firstSeen).sort()[0] ?? null;
					const last =
						p.perServer
							.map((s) => s.lastSeen)
							.sort()
							.reverse()[0] ?? null;
					return (
						<>
							<div class="profile-head">
								<Avatar name={p.player} size={48} />
								<ServerDots ids={p.perServer.map((s) => s.serverId)} />
							</div>
							<div class="tiles">
								<Tile label="Playtime" value={formatHours(totalHours)} />
								<Tile label="Sessions" value={formatInt(totalSessions)} />
								<Tile
									label="First seen"
									value={formatShortTs(first).slice(0, 10)}
								/>
								<Tile
									label="Last seen"
									value={formatShortTs(last).slice(0, 10)}
								/>
								<Tile label="Messages" value={formatInt(msgs)} />
								<Tile label="Commands" value={formatInt(cmds)} />
							</div>

							<Card title="Per server">
								<div class="table-wrap">
									<table class="table">
										<thead>
											<tr>
												<th>Server</th>
												<th class="num">Hours</th>
												<th class="num">Sessions</th>
												<th>First seen</th>
												<th>Last seen</th>
												<th class="num">Messages</th>
												<th class="num">Commands</th>
											</tr>
										</thead>
										<tbody>
											{p.perServer.map((s) => (
												<tr key={s.serverId}>
													<td>
														<ServerDot id={s.serverId} label />
													</td>
													<td class="num">{formatHours(s.hours)}</td>
													<td class="num">{formatInt(s.sessions)}</td>
													<td>{formatShortTs(s.firstSeen)}</td>
													<td>{formatShortTs(s.lastSeen)}</td>
													<td class="num">{formatInt(s.messages)}</td>
													<td class="num">{formatInt(s.commands)}</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							</Card>

							<Card title="UUIDs">
								{p.uuids.length === 0 ? (
									<Empty>No UUIDs known.</Empty>
								) : (
									<ul class="plain-list">
										{p.uuids.map((u) => (
											<li key={`${u.serverId}-${u.uuid}`}>
												<code>{u.uuid}</code>{" "}
												<ServerDot id={u.serverId} label />{" "}
												<span class="muted">({u.source})</span>
											</li>
										))}
									</ul>
								)}
							</Card>

							<Card
								title="IP addresses"
								actions={
									<Toggle
										inline
										bold
										checked={showIps}
										onChange={setShowIps}
										label="Show IPs"
									/>
								}
							>
								{p.ips.length === 0 ? (
									<Empty>No IPs recorded.</Empty>
								) : (
									<div class="table-wrap">
										<table class="table">
											<thead>
												<tr>
													<th>IP</th>
													<th>Country</th>
													<th class="num">Logins</th>
													<th>First seen</th>
													<th>Last seen</th>
												</tr>
											</thead>
											<tbody>
												{p.ips.map((ip) => (
													<tr key={ip.ip}>
														<td>
															<code class={showIps ? "" : "blur"}>{ip.ip}</code>
														</td>
														<td>{ip.countryName ?? ip.country ?? "unknown"}</td>
														<td class="num">{formatInt(ip.logins)}</td>
														<td>{formatShortTs(ip.firstSeen)}</td>
														<td>{formatShortTs(ip.lastSeen)}</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								)}
							</Card>

							<Card
								title="Recent sessions"
								actions={
									<Link to={`/logs/sessions${filter}`} class="btn small">
										All sessions
									</Link>
								}
							>
								{p.recentSessions.length === 0 ? (
									<Empty>No sessions.</Empty>
								) : (
									<div class="table-wrap">
										<table class="table">
											<thead>
												<tr>
													<th>Server</th>
													<th>Start (UTC)</th>
													<th class="num">Length</th>
													<th>Ended by</th>
													<th>Country</th>
												</tr>
											</thead>
											<tbody>
												{p.recentSessions.map((s) => (
													<tr key={`${s.serverId}-${s.start}`}>
														<td>
															<ServerDot id={s.serverId} label />
														</td>
														<td>{formatShortTs(s.start)}</td>
														<td class="num">{formatElapsed(s.secs)}</td>
														<td>{s.closedBy}</td>
														<td>{s.country ?? "-"}</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								)}
							</Card>

							<Card
								title="Recent messages"
								actions={
									<>
										<Link to={`/logs/chat${filter}`} class="btn small">
											All chat
										</Link>
										<Link to={`/logs/cmd${filter}`} class="btn small">
											All commands
										</Link>
									</>
								}
							>
								{p.recentMessages.length === 0 ? (
									<Empty>No messages.</Empty>
								) : (
									<ul class="messages">
										{p.recentMessages.map((m) => (
											<li key={`${m.serverId}-${m.ts}-${m.text}`}>
												<span class="muted">{formatShortTs(m.ts)}</span>{" "}
												<ServerDot id={m.serverId} />
												<span class={m.type === "cmd" ? "cmd" : ""}>
													{m.type === "cmd" ? "/" : ""}
													{m.text}
												</span>
											</li>
										))}
									</ul>
								)}
							</Card>
						</>
					);
				}}
			</Async>
		</Page>
	);
}

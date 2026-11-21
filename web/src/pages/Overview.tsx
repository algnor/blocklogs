import { useState } from "preact/hooks";
import type {
	Overview as OverviewData,
	ServerSummary,
} from "../../../shared/api";
import { startSync } from "../actions";
import { hours, int, relative } from "../format";
import { useFetch } from "../hooks";
import { navigate } from "../router";
import {
	refreshServers,
	selectedServers,
	serverColor,
	servers,
	serversError,
	setSelectedServers,
} from "../state";
import { ActivityLog } from "../ui/ActivityLog";
import {
	Async,
	Card,
	Empty,
	ErrorBox,
	Link,
	Loading,
	Page,
	Tile,
} from "../ui/common";
import { SyncProgress } from "../ui/SyncProgress";

function ServerCard(props: { s: ServerSummary }) {
	const { s } = props;
	const p = s.progress;
	const running = s.lastSyncStatus === "running" || !!p;
	const status = running ? "running" : (s.lastSyncStatus ?? "never");
	const pick = () => {
		setSelectedServers([s.id]);
	};
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: a mouse shortcut; the title link and the Details button are the keyboard way in
		// biome-ignore lint/a11y/useKeyWithClickEvents: same
		<div
			class="card server-card"
			style={{ "--accent-bar": serverColor(s.id) }}
			onClick={(e) => {
				// A click anywhere on the card opens it, except on what already does something.
				if (!(e.target as Element).closest("a, button"))
					navigate(`/servers/${s.id}`);
			}}
		>
			<div class="card-head">
				<h2>
					<span class="dot" style={{ background: serverColor(s.id) }} />{" "}
					<Link to={`/servers/${s.id}`} class="plain-link">
						{s.name}
					</Link>
				</h2>
				<span class={`badge ${status}`}>{status}</span>
			</div>
			<div class="muted small-text">
				{s.game} · {s.backend}
				{!s.enabled && " · disabled"}
			</div>
			{p && <SyncProgress p={p} />}
			{s.lastSyncStatus === "error" && s.lastSyncError && (
				<div class="err small-text">{s.lastSyncError}</div>
			)}
			<div class="kv">
				<span>Last sync</span>
				<b>{relative(s.lastSyncAt)}</b>
				<span>Hours 7d / 30d</span>
				<b>
					{hours(s.hours7d)} / {hours(s.hours30d)}
				</b>
				<span>Players</span>
				<b>{int(s.players)}</b>
				<span>Sessions</span>
				<b>{int(s.sessions)}</b>
				<span>Crashes</span>
				<b>{int(s.crashes)}</b>
			</div>
			<div class="online">
				<span class="muted">Online ({s.online.length}):</span>{" "}
				{s.online.length === 0 ? (
					<span class="faint">nobody</span>
				) : (
					s.online.map((n) => (
						<span key={n}>
							<Link to={`/players/${encodeURIComponent(n)}`} class="chip">
								{n}
							</Link>{" "}
						</span>
					))
				)}
			</div>
			<div class="card-foot">
				<Link to={`/servers/${s.id}`} class="btn small">
					Details
				</Link>
				<button type="button" class="btn small" onClick={pick}>
					Only this server
				</button>
				<button
					type="button"
					class="btn small"
					disabled={running}
					onClick={() => void startSync(s.id)}
				>
					Sync now
				</button>
			</div>
		</div>
	);
}

export function OverviewPage() {
	const list = servers.value;
	const [busy, setBusy] = useState(false);
	const ov = useFetch<OverviewData>("/api/overview");
	const syncing = list?.some(
		(s) => s.lastSyncStatus === "running" || s.progress,
	);

	return (
		<Page
			title="Overview"
			actions={
				<button
					type="button"
					class="btn primary"
					disabled={busy || !!syncing}
					onClick={async () => {
						setBusy(true);
						await startSync(null);
						setBusy(false);
					}}
				>
					Sync all
				</button>
			}
		>
			<Async state={ov}>
				{(o) => (
					<div class="tiles">
						<Tile label="Servers" value={int(o.servers)} />
						<Tile label="Players" value={int(o.players)} />
						<Tile label="Sessions" value={int(o.sessions)} />
						<Tile label="Total hours" value={hours(o.hoursTotal)} />
						<Tile label="Hours (7d)" value={hours(o.hours7d)} />
						<Tile label="Crashes (7d)" value={int(o.crashes7d)} />
						<Tile label="Online now" value={int(o.online.length)} />
					</div>
				)}
			</Async>
			<h2 class="section-title">Servers</h2>
			{serversError.value && !list && (
				<ErrorBox message={serversError.value} onRetry={refreshServers} />
			)}
			{!list && !serversError.value && <Loading />}
			{list && list.length === 0 && (
				<Card>
					<Empty>
						No servers yet. Add or import one in{" "}
						<a
							href="/settings"
							onClick={(e) => {
								e.preventDefault();
								navigate("/settings");
							}}
						>
							Settings
						</a>
						.
					</Empty>
				</Card>
			)}
			<div class="grid">
				{list?.map((s) => (
					<ServerCard key={s.id} s={s} />
				))}
			</div>
			<ActivityLog serverIds={selectedServers.value} />
		</Page>
	);
}

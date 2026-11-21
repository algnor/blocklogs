import { ActivityPage } from "./pages/Activity";
import { CrashesPage } from "./pages/Crashes";
import { GeoPage } from "./pages/Geo";
import { LogsPage } from "./pages/Logs";
import { OverviewPage } from "./pages/Overview";
import { PlayerPage } from "./pages/Player";
import { PlayersPage } from "./pages/Players";
import { ServerPage } from "./pages/Server";
import { SettingsPage } from "./pages/Settings";
import { loc, parseRoute } from "./router";
import {
	selectedServers,
	serverColor,
	servers,
	setSelectedServers,
} from "./state";
import { ConnectionBadge } from "./ui/ActivityLog";
import { Check, Link, Page } from "./ui/common";
import { Toasts } from "./ui/Toast";

const NAV = [
	{ to: "/", label: "Overview", page: "overview", also: "server" },
	{ to: "/players", label: "Players", page: "players", also: "player" },
	{ to: "/logs", label: "Logs", page: "logs" },
	{ to: "/geo", label: "Geo", page: "geo" },
	{ to: "/activity", label: "Activity", page: "activity" },
	{ to: "/crashes", label: "Crashes", page: "crashes" },
	{ to: "/settings", label: "Settings", page: "settings" },
];

function ServerFilter() {
	const list = servers.value;
	const sel = selectedServers.value;
	const all = sel.length === 0;
	return (
		<div class="server-filter">
			<h2>Servers</h2>
			{!list && <p class="muted small-text">Loading…</p>}
			{list && list.length === 0 && <p class="muted small-text">No servers.</p>}
			{list && list.length > 0 && (
				<>
					<Check checked={all} onChange={() => setSelectedServers([])}>
						All
					</Check>
					{list.map((s) => (
						<Check
							key={s.id}
							checked={all || sel.includes(s.id)}
							onChange={(on) => {
								const cur = all ? list.map((x) => x.id) : sel;
								const next = on
									? [...cur, s.id]
									: cur.filter((id) => id !== s.id);
								setSelectedServers(next.length === list.length ? [] : next);
							}}
						>
							<span class="server-row">
								<span class="dot" style={{ background: serverColor(s.id) }} />
								<span class="server-name">{s.name}</span>
								<span class="count" title="Players online">
									{s.online.length}
								</span>
							</span>
						</Check>
					))}
				</>
			)}
		</div>
	);
}

function Routes() {
	const route = parseRoute(loc.value.path);
	switch (route.page) {
		case "overview":
			return <OverviewPage />;
		case "server":
			return <ServerPage key={route.id} id={route.id} />;
		case "players":
			return <PlayersPage />;
		case "player":
			return <PlayerPage key={route.name} name={route.name} />;
		case "logs":
			return <LogsPage tab={route.tab} />;
		case "geo":
			return <GeoPage />;
		case "activity":
			return <ActivityPage />;
		case "crashes":
			return <CrashesPage />;
		case "settings":
			return <SettingsPage />;
		default:
			return (
				<Page title="Not found">
					<p class="muted">
						There is no such page. <Link to="/">Back to the overview</Link>
					</p>
				</Page>
			);
	}
}

export function App() {
	const route = parseRoute(loc.value.path);
	return (
		<div class="app">
			<aside class="sidebar">
				<Link to="/" class="brand">
					Logs Parser
				</Link>
				<nav aria-label="Main">
					{NAV.map((n) => (
						<Link
							key={n.to}
							to={n.to}
							class={`nav-link ${route.page === n.page || route.page === n.also ? "active" : ""}`}
						>
							{n.label}
						</Link>
					))}
				</nav>
				<ServerFilter />
				<ConnectionBadge />
			</aside>
			<main class="page-root">
				<Routes />
			</main>
			<Toasts />
		</div>
	);
}

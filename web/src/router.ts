import { signal } from "@preact/signals";

export type Route =
	| { page: "overview" }
	| { page: "players" }
	| { page: "player"; name: string }
	| { page: "server"; id: number }
	| { page: "logs"; tab: "sessions" | "chat" | "cmd" }
	| { page: "geo" }
	| { page: "activity" }
	| { page: "crashes" }
	| { page: "settings" }
	| { page: "notfound" };

export function parseRoute(pathname: string): Route {
	const parts = pathname.split("/").filter(Boolean);
	const safe = (s: string) => {
		try {
			return decodeURIComponent(s);
		} catch {
			return s;
		}
	};
	const [a, b, c] = parts;
	if (!a) return { page: "overview" };
	if (a === "players" && !b) return { page: "players" };
	if (a === "players" && b && !c) return { page: "player", name: safe(b) };
	if (a === "servers" && b && !c && /^[1-9]\d{0,9}$/.test(b))
		return { page: "server", id: Number(b) };
	if (a === "logs" && !c) {
		if (!b || b === "sessions") return { page: "logs", tab: "sessions" };
		if (b === "chat" || b === "cmd") return { page: "logs", tab: b };
	}
	if (parts.length === 1) {
		if (a === "geo") return { page: "geo" };
		if (a === "activity") return { page: "activity" };
		if (a === "crashes") return { page: "crashes" };
		if (a === "settings") return { page: "settings" };
	}
	return { page: "notfound" };
}

export function parseSearch(search: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of new URLSearchParams(search)) out[k] = v;
	return out;
}

export function buildSearch(q: Record<string, string | undefined>): string {
	const sp = new URLSearchParams();
	for (const [k, v] of Object.entries(q)) if (v) sp.set(k, v);
	const s = sp.toString();
	return s ? `?${s}` : "";
}

export type Loc = { path: string; query: Record<string, string> };

function read(): Loc {
	if (typeof location === "undefined") return { path: "/", query: {} };
	return {
		path: location.pathname,
		query: parseSearch(location.search),
	};
}

export const loc = signal<Loc>(read());

function write(path: string, query: Record<string, string>, replace: boolean) {
	const url = path + buildSearch(query);
	if (url !== location.pathname + location.search)
		history[replace ? "replaceState" : "pushState"](null, "", url);
	loc.value = { path, query };
}

/** Navigate to "/path?query"; the global `servers` filter is carried over unless given. */
export function navigate(to: string, replace = false) {
	const u = new URL(to, location.origin);
	const query = parseSearch(u.search);
	const servers = loc.value.query.servers;
	if (query.servers === undefined && servers) query.servers = servers;
	write(u.pathname, query, replace);
	if (!replace) window.scrollTo(0, 0);
}

/** Patch query parameters of the current page (undefined/"" removes). */
export function setQuery(patch: Record<string, string | undefined>) {
	const query = { ...loc.value.query };
	for (const [k, v] of Object.entries(patch)) {
		if (v) query[k] = v;
		else delete query[k];
	}
	write(loc.value.path, query, true);
}

if (typeof window !== "undefined")
	window.addEventListener("popstate", () => {
		loc.value = read();
	});

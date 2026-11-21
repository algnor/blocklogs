import { toYmd } from "@aomc-server/block-ui/format";
import { effect, signal } from "@preact/signals";
import { servers } from "./live";
import { loc, setQuery } from "./router";

/* ---- server colours ---- */
export const PALETTE = [
	"#52a535",
	"#3fc3ef",
	"#f9801d",
	"#d150c6",
	"#fed83d",
	"#e1372e",
	"#8c7bff",
	"#1ccfc0",
	"#ff9bb9",
	"#a55e2a",
];

export function serverColor(id: number): string {
	return PALETTE[
		((id % PALETTE.length) + PALETTE.length) % PALETTE.length
	] as string;
}

/* ---- servers store: fed live, see live.ts ---- */
export { refreshServers, servers, serversError } from "./live";

export function serverName(id: number): string {
	return servers.value?.find((s) => s.id === id)?.name ?? `#${id}`;
}

/* ---- server filter (empty = all) ---- */
export function parseIds(s: string | null | undefined): number[] {
	if (!s) return [];
	return [
		...new Set(
			s
				.split(",")
				.map(Number)
				.filter((n) => Number.isInteger(n) && n > 0),
		),
	].sort((a, b) => a - b);
}

const SERVERS_KEY = "blocklogs.servers";

function initialServers(): number[] {
	const fromUrl = loc.value.query.servers;
	if (fromUrl !== undefined) return parseIds(fromUrl);
	try {
		return parseIds(localStorage.getItem(SERVERS_KEY));
	} catch {
		return [];
	}
}

export const selectedServers = signal<number[]>(initialServers());

export function setSelectedServers(ids: number[]) {
	selectedServers.value = [...ids].sort((a, b) => a - b);
}

effect(() => {
	const s = selectedServers.value.join(",");
	try {
		localStorage.setItem(SERVERS_KEY, s);
	} catch {}
	if ((loc.peek().query.servers ?? "") !== s)
		setQuery({ servers: s || undefined });
});

effect(() => {
	const fromUrl = loc.value.query.servers ?? "";
	if (fromUrl !== selectedServers.peek().join(","))
		selectedServers.value = parseIds(fromUrl);
});

/* ---- date range ---- */
export type Preset = "7d" | "30d" | "90d" | "1y" | "all" | "custom";
export type RangeState = { preset: Preset; since: string; until: string };

const RANGE_KEY = "blocklogs.range";
const PRESET_DAYS: Record<string, number> = {
	"7d": 7,
	"30d": 30,
	"90d": 90,
	"1y": 365,
};

export function rangeDates(
	r: RangeState,
	now = new Date(),
): { since?: string; until?: string } {
	if (r.preset === "all") return {};
	if (r.preset === "custom")
		return { since: r.since || undefined, until: r.until || undefined };
	const days = PRESET_DAYS[r.preset] ?? 30;
	return { since: toYmd(new Date(now.getTime() - days * 86400000)) };
}

function initialRange(): RangeState {
	try {
		const r = JSON.parse(
			localStorage.getItem(RANGE_KEY) ?? "null",
		) as RangeState | null;
		if (r && typeof r.preset === "string")
			return { preset: r.preset, since: r.since ?? "", until: r.until ?? "" };
	} catch {}
	return { preset: "30d", since: "", until: "" };
}

export const range = signal<RangeState>(initialRange());

effect(() => {
	try {
		localStorage.setItem(RANGE_KEY, JSON.stringify(range.value));
	} catch {}
});

/** The stats query for one server: the chosen date range, whatever the sidebar selection is. */
export function serverQuery(id: number) {
	return { ...statsQuery(), servers: String(id) };
}

/** Query params shared by the stats endpoints; reads signals, so call it while rendering. */
export function statsQuery(withRange = true) {
	const ids = selectedServers.value;
	const dates = withRange ? rangeDates(range.value) : {};
	return {
		servers: ids.length ? ids.join(",") : undefined,
		since: dates.since,
		until: dates.until,
	};
}

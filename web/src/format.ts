const nf1 = new Intl.NumberFormat("en-US", {
	minimumFractionDigits: 1,
	maximumFractionDigits: 1,
});
const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function int(n: number): string {
	return nf0.format(n);
}

/** Hours with one decimal: "7,153.2h". */
export function hours(h: number): string {
	return `${nf1.format(h)}h`;
}

export function secsToHours(secs: number): number {
	return secs / 3600;
}

export function percent(fraction: number): string {
	return `${(fraction * 100).toFixed(1)}%`;
}

/** "1h 05m", "4m 12s", "9s". */
export function duration(secs: number): string {
	const s = Math.max(0, Math.round(secs));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
	if (m > 0) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
	return `${s}s`;
}

export function bytes(n: number): string {
	if (n < 1024) return `${n} B`;
	const units = ["KiB", "MiB", "GiB", "TiB"];
	let v = n / 1024;
	let i = 0;
	while (v >= 1024 && i < units.length - 1) {
		v /= 1024;
		i++;
	}
	return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

/** Parses "YYYY-MM-DD HH:MM:SS.mmm" (UTC) or an ISO string. */
export function parseTs(ts: string): Date {
	if (/[zZ]|[+-]\d\d:?\d\d$/.test(ts)) return new Date(ts);
	return new Date(`${ts.replace(" ", "T")}Z`);
}

/** "2026-01-02 03:04" from a log timestamp. */
export function shortTs(ts: string | null): string {
	return ts ? ts.slice(0, 16) : "-";
}

export function shortDate(ts: string | null): string {
	return ts ? ts.slice(0, 10) : "-";
}

export function relative(ts: string | null, now = Date.now()): string {
	if (!ts) return "never";
	const t = parseTs(ts).getTime();
	if (Number.isNaN(t)) return "-";
	const diff = Math.round((now - t) / 1000);
	if (diff < 0) return "in the future";
	if (diff < 45) return "just now";
	const units: [number, string][] = [
		[60, "m"],
		[3600, "h"],
		[86400, "d"],
		[86400 * 30, "mo"],
		[86400 * 365, "y"],
	];
	if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
	if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
	if (diff < 86400 * 60) return `${Math.floor(diff / 86400)}d ago`;
	if (diff < 86400 * 365) return `${Math.floor(diff / (86400 * 30))}mo ago`;
	void units;
	return `${Math.floor(diff / (86400 * 365))}y ago`;
}

export function ymd(d: Date): string {
	return d.toISOString().slice(0, 10);
}

import { formatRelative as relative } from "@aomc-server/block-ui/format";

/** The server writes log timestamps in UTC, as "YYYY-MM-DD HH:MM:SS" or as ISO 8601. */
export const parseTs = (ts: string): Date =>
	/[zZ]|[+-]\d\d:?\d\d$/.test(ts)
		? new Date(ts)
		: new Date(`${ts.replace(" ", "T")}Z`);

export const formatShortTs = (ts: string | null): string =>
	ts ? ts.slice(0, 16) : "-";

export const formatShortDate = (ts: string | null): string =>
	ts ? ts.slice(0, 10) : "-";

export const secsToHours = (secs: number): number => secs / 3600;

/** `formatRelative` for a log timestamp ("never" for none). */
export const formatRelativeTs = (ts: string | null): string =>
	relative(ts ? parseTs(ts) : null);

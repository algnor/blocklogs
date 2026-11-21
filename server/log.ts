import type { LogEntry } from "../shared/events";
import { hub } from "./hub";

const KEEP = 500;
const ring: LogEntry[] = [];
let nextId = 1;

/**
 * Writes to the activity log: the console, the recent history (what a new client is sent first)
 * and every client following `log`, right now. No database, so anything may call it.
 */
export function activity(
	serverId: number | null,
	level: LogEntry["level"],
	message: string,
) {
	const entry: LogEntry = {
		id: nextId++,
		ts: new Date().toISOString(),
		serverId,
		level,
		message,
	};
	ring.push(entry);
	if (ring.length > KEEP) ring.splice(0, ring.length - KEEP);
	const line = `[${serverId ?? "-"}] ${message}`;
	if (level === "error") console.error(line);
	else if (level === "warn") console.warn(line);
	else console.log(line);
	hub.emit("log", { entries: [entry] });
}

/** The most recent entries, oldest first. */
export const recentActivity = (n = 200): LogEntry[] => ring.slice(-n);

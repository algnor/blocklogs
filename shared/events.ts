import type { ServerSummary, SyncProgress } from "./api";

/**
 * What the server pushes to clients, by topic. Every push goes through one `EventHub`
 * (server/hub.ts); server/topics.ts says how each topic is snapshotted and server/events.ts
 * streams them over `GET /api/events?topics=a,b`.
 */

export type LogEntry = {
	/** Counts up from 1 since the server started. */
	id: number;
	/** ISO 8601. */
	ts: string;
	/** The server it is about; null for things that are not (the panel's rate limit). */
	serverId: number | null;
	level: "info" | "warn" | "error";
	message: string;
};

/** Every server, with its stats. Sent when a server is added, changed or removed, a sync starts or ends, or the data changes. */
export type ServersEvent = { servers: ServerSummary[] };

/** The syncs running now, by server id, and how far they are. A server that is not here is not syncing. */
export type SyncEvent = { running: Record<number, SyncProgress> };

/**
 * The activity log. A snapshot is the most recent entries and replaces what you have; any other
 * event carries the entries since the last one, to append.
 */
export type LogEvent = { entries: LogEntry[] };

/** New data was ingested or removed: fetch what you show again. Carries nothing. */
export type DataEvent = Record<string, never>;

/** Who is online, by server. Changes when a sync lands, and when a session ages out. */
export type OnlineEvent = { online: { serverId: number; player: string }[] };

export type Events = {
	servers: ServersEvent;
	sync: SyncEvent;
	log: LogEvent;
	data: DataEvent;
	online: OnlineEvent;
};

export type Topic = keyof Events;
export const topicNames = [
	"servers",
	"sync",
	"log",
	"data",
	"online",
] as const satisfies readonly Topic[];

/** What a topic's events carry. */
export type DataOf<T extends string> = T extends Topic ? Events[T] : unknown;

/**
 * One message on the wire. `seq` counts the topic's events since the server started: a snapshot
 * after reconnecting with the same `seq` as the last event you saw means you missed nothing.
 */
export type Envelope =
	| {
			topic: Topic;
			seq: string;
			snapshot: boolean;
			data: Events[Topic];
	  }
	| { topic: string; error: "unknown topic" };

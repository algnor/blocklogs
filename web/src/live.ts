import { createEventStream } from "@aomc-server/block-ui/events";
import { signal } from "@preact/signals";
import type { ServerSummary, SyncProgress } from "../../shared/api";
import type { Events, LogEntry } from "../../shared/events";
import { getJson } from "./api";

const stream = createEventStream<Events>();
const { subscribe } = stream;

/*
 * Everything that arrives live lives here, as signals the pages read:
 *   servers      every server, with its running sync's progress merged in
 *   activityLog  the server's activity log, as it happens
 *   dataRev      goes up when new data landed or who is online changed (useFetch reloads on it)
 *   connection   whether the stream is delivering
 * Pages never poll. While the stream is down each subscription polls instead, so the screen
 * still moves, and the stream takes over again as soon as it works.
 */

export const servers = signal<ServerSummary[] | null>(null);
export const serversError = signal<string | null>(null);
export const activityLog = signal<LogEntry[]>([]);
export const dataRev = signal(0);
export const connection = signal<"connecting" | "live" | "down">("connecting");

const LOG_KEEP = 500;

let base: ServerSummary[] | null = null;
let running: Record<number, SyncProgress> = {};

function publish() {
	if (!base) return;
	// The stream says which syncs run; over REST (stream down) the list carries it itself.
	servers.value =
		connection.value === "live"
			? base.map((s) => {
					const p = running[s.id];
					return p
						? { ...s, lastSyncStatus: "running" as const, progress: p }
						: { ...s, progress: null };
				})
			: base;
}

/** Fetches the list over REST. Used while the stream is down, and to retry after a failure. */
export async function refreshServers() {
	try {
		base = await getJson<ServerSummary[]>("/api/servers");
		serversError.value = null;
		publish();
	} catch (e) {
		serversError.value = (e as Error).message;
	}
}

let started = false;

export function startLive() {
	if (started) return;
	started = true;

	stream.onStatus((status) => {
		connection.value = status;
		publish();
	});

	subscribe("servers", {
		onEvent: ({ servers: list }) => {
			base = list;
			serversError.value = null;
			publish();
		},
		poll: () => void refreshServers(),
		pollMs: 3000,
	});

	subscribe("sync", {
		onEvent: ({ running: now }) => {
			running = now;
			publish();
		},
	});

	subscribe("log", {
		onEvent: ({ entries }, { snapshot }) => {
			activityLog.value = snapshot
				? entries.slice(-LOG_KEEP)
				: [...activityLog.value, ...entries].slice(-LOG_KEEP);
		},
	});

	// The first snapshot is what the page already fetched; anything after is news.
	for (const topic of ["data", "online"] as const) {
		let first = true;
		subscribe(topic, {
			onEvent: (_, { snapshot }) => {
				if (first && snapshot) {
					first = false;
					return;
				}
				first = false;
				dataRev.value++;
			},
		});
	}

	// The first moment, before the stream has said anything.
	void refreshServers();
}

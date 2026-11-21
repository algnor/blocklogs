import type { Events, Topic } from "../shared/events";
import { onlineSnapshot, serversSnapshot, syncSnapshot } from "./live";
import { recentActivity } from "./log";

/** How one topic is followed. Adding a topic = an entry in `Events` (shared/events.ts) and one here. */
export type TopicDef<T extends Topic> = {
	description: string;
	/**
	 * The current state, sent first. Must be synchronous, so nothing is emitted between
	 * subscribing and taking it.
	 */
	snapshot: () => Events[T];
};

export const topics: { [T in Topic]: TopicDef<T> } = {
	servers: {
		description:
			"Every server with its stats. Sent when a server is added, edited or removed, a sync starts or ends, or the data changes.",
		snapshot: serversSnapshot,
	},
	sync: {
		description:
			"The syncs running now, by server id, with how far each is. An event for every step.",
		snapshot: syncSnapshot,
	},
	log: {
		description:
			"The activity log. A snapshot is the recent entries; other events are new entries to append.",
		snapshot: () => ({ entries: recentActivity() }),
	},
	data: {
		description: "New data was ingested or removed: fetch what you show again.",
		snapshot: () => ({}),
	},
	online: {
		description: "Who is online, by server.",
		snapshot: onlineSnapshot,
	},
};

import type { DataOf, Events, Topic } from "../shared/events";

type Listener = (data: never, seq: string) => void;

export type EventHub = ReturnType<typeof createEventHub>;

/** In-memory fan-out of everything the server pushes, keyed by topic. */
export function createEventHub() {
	const boot = Math.random().toString(36).slice(2, 8);
	const listeners = new Map<string, Set<Listener>>();
	const counts = new Map<string, number>();
	const seqOf = (topic: string) => `${boot}.${counts.get(topic) ?? 0}`;
	return {
		emit<T extends Topic>(topic: T, data: Events[T]) {
			counts.set(topic, (counts.get(topic) ?? 0) + 1);
			const seq = seqOf(topic);
			for (const fn of [...(listeners.get(topic) ?? [])])
				(fn as (data: unknown, seq: string) => void)(data, seq);
		},
		subscribe<T extends string>(
			topic: T,
			fn: (data: DataOf<T>, seq: string) => void,
		): () => void {
			const set = listeners.get(topic) ?? new Set();
			listeners.set(topic, set);
			set.add(fn as Listener);
			return () => {
				set.delete(fn as Listener);
				if (set.size === 0) listeners.delete(topic);
			};
		},
		/** The seq of the topic's last event, for snapshots. */
		seq: seqOf,
	};
}

export const hub = createEventHub();

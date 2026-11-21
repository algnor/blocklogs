import type { SyncProgress } from "../shared/api";

/** Which syncs run now and how far they are. Only the sync code writes it; the rest read it. */
export const progress = new Map<number, SyncProgress>();
const running = new Set<number>();

export const isSyncing = (id: number) => running.has(id);

export function begin(id: number): SyncProgress {
	running.add(id);
	const p: SyncProgress = {
		phase: "listing",
		done: 0,
		total: 0,
		current: null,
		errors: 0,
		startedAt: Date.now(),
	};
	progress.set(id, p);
	return p;
}

/** Done: it no longer counts as running, and its progress is dropped. */
export function end(id: number) {
	running.delete(id);
	progress.delete(id);
}

export function runningSyncs(): Record<number, SyncProgress> {
	const out: Record<number, SyncProgress> = {};
	for (const id of running) {
		const p = progress.get(id);
		if (p) out[id] = { ...p };
	}
	return out;
}

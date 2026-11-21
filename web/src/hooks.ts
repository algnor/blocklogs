import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { buildUrl, getJson, type Params } from "./api";
import { dataRev } from "./live";

export type Fetched<T> = {
	data: T | null;
	error: string | null;
	loading: boolean;
	reload: () => void;
};

/**
 * Fetches `path?params` as JSON whenever the resulting URL changes. Stale responses are ignored,
 * old data stays visible while reloading. Pass null to skip.
 */
export function useFetch<T>(
	path: string | null,
	params: Params = {},
	pollMs = 0,
	live = true,
): Fetched<T> {
	const url = path === null ? null : buildUrl(path, params);
	const [state, setState] = useState<{
		data: T | null;
		error: string | null;
		loading: boolean;
	}>({
		data: null,
		error: null,
		loading: url !== null,
	});
	const seq = useRef(0);
	const [tick, setTick] = useState(0);
	const reload = useCallback(() => setTick((t) => t + 1), []);

	useEffect(() => {
		if (url === null) return;
		const id = ++seq.current;
		setState((s) => ({ ...s, loading: true }));
		getJson<T>(url).then(
			(data) => {
				if (id === seq.current) setState({ data, error: null, loading: false });
			},
			(e: Error) => {
				if (id === seq.current)
					setState((s) => ({ ...s, error: e.message, loading: false }));
			},
		);
		return () => {
			seq.current++;
		};
	}, [url, tick]);

	useEffect(() => {
		if (!pollMs) return;
		const h = setInterval(reload, pollMs);
		return () => clearInterval(h);
	}, [pollMs, reload]);

	// New data landed (or who is online changed): fetch again, quietly, once things settle.
	useEffect(() => {
		if (!live || url === null) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let first = true;
		const off = dataRev.subscribe(() => {
			if (first) {
				first = false;
				return;
			}
			clearTimeout(timer);
			timer = setTimeout(reload, 400);
		});
		return () => {
			off();
			clearTimeout(timer);
		};
	}, [live, url, reload]);

	return { ...state, reload };
}

export function useDebounced<T>(value: T, ms = 300): T {
	const [v, setV] = useState(value);
	useEffect(() => {
		const h = setTimeout(() => setV(value), ms);
		return () => clearTimeout(h);
	}, [value, ms]);
	return v;
}

/** A page offset that goes back to 0 whenever `key` (the filters it belongs to) changes. */
export function usePageOffset(key: string): [number, (offset: number) => void] {
	const [state, setState] = useState({ key, offset: 0 });
	const offset = state.key === key ? state.offset : 0;
	return [offset, (o) => setState({ key, offset: o })];
}

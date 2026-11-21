import { type AsyncState, useAsync } from "@aomc-server/block-ui/hooks";
import { buildUrl, getJson, type Params } from "./api";
import { dataRev } from "./live";

export type Fetched<T> = AsyncState<T>;

/**
 * Fetches `path?params` as JSON whenever the resulting URL changes, and again (quietly) when new
 * data lands, see `dataRev`. Pass null to skip.
 */
export function useFetch<T>(
	path: string | null,
	params: Params = {},
	pollMs = 0,
	live = true,
): Fetched<T> {
	const url = path === null ? null : buildUrl(path, params);
	return useAsync<T>(
		url === null ? null : (signal) => getJson<T>(url, signal),
		[url],
		{ pollMs, refresh: live ? dataRev : undefined },
	);
}

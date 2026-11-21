import { afterEach, expect, test } from "bun:test";
import { ApiError, getJson } from "./api";

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

const fetchRejecting = (error: Error) =>
	(globalThis.fetch = (() => Promise.reject(error)) as unknown as typeof fetch);

test("a network failure becomes an ApiError with status 0", async () => {
	fetchRejecting(new TypeError("fetch failed"));
	const error = await getJson("/api/x").catch((e: unknown) => e);
	expect(error).toBeInstanceOf(ApiError);
	expect((error as ApiError).status).toBe(0);
});

test("an aborted request is rethrown as it is", async () => {
	const controller = new AbortController();
	const abort = new DOMException("aborted", "AbortError");
	fetchRejecting(abort);
	controller.abort();
	expect(await getJson("/api/x", controller.signal).catch((e) => e)).toBe(
		abort,
	);

	fetchRejecting(abort);
	expect(await getJson("/api/x").catch((e) => e)).toBe(abort);
});

test("an error response carries the server's message", async () => {
	globalThis.fetch = (async () =>
		Response.json(
			{ error: "nope" },
			{ status: 400 },
		)) as unknown as typeof fetch;
	const error = await getJson("/api/x").catch((e: unknown) => e);
	expect(error).toBeInstanceOf(ApiError);
	expect((error as ApiError).message).toBe("nope");
	expect((error as ApiError).status).toBe(400);
});

import { expect, test } from "bun:test";
import { buildSearch, parseRoute, parseSearch } from "./router";

test("parseRoute", () => {
	expect(parseRoute("/")).toEqual({ page: "overview" });
	expect(parseRoute("/players")).toEqual({ page: "players" });
	expect(parseRoute("/players/Steve%20X")).toEqual({
		page: "player",
		name: "Steve X",
	});
	expect(parseRoute("/logs")).toEqual({ page: "logs", tab: "sessions" });
	expect(parseRoute("/logs/chat/")).toEqual({ page: "logs", tab: "chat" });
	expect(parseRoute("/logs/nope")).toEqual({ page: "notfound" });
	expect(parseRoute("/servers/7")).toEqual({ page: "server", id: 7 });
	expect(parseRoute("/servers/7/")).toEqual({ page: "server", id: 7 });
	expect(parseRoute("/servers/0")).toEqual({ page: "notfound" });
	expect(parseRoute("/servers/abc")).toEqual({ page: "notfound" });
	expect(parseRoute("/servers")).toEqual({ page: "notfound" });
	expect(parseRoute("/geo")).toEqual({ page: "geo" });
	expect(parseRoute("/x/y/z")).toEqual({ page: "notfound" });
});

test("search helpers", () => {
	expect(parseSearch("?servers=1,2&q=a")).toEqual({ servers: "1,2", q: "a" });
	expect(buildSearch({ a: "1", b: undefined, c: "" })).toBe("?a=1");
	expect(buildSearch({})).toBe("");
});

import { expect, test } from "bun:test";
import { parseSettings } from "./settings";

test("parseSettings keeps valid choices and defaults the rest", () => {
	expect(parseSettings(null)).toEqual({ mode: "dark", style: "bedrock" });
	expect(parseSettings('{"mode":"system","style":"xp"}')).toEqual({
		mode: "system",
		style: "xp",
	});
	expect(parseSettings('{"mode":"blue","style":"xp"}')).toEqual({
		mode: "dark",
		style: "xp",
	});
	expect(parseSettings("not json")).toEqual({
		mode: "dark",
		style: "bedrock",
	});
});

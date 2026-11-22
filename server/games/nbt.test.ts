import { expect, test } from "bun:test";
import { parseNbt } from "./nbt";

const s = (x: string) => {
	const b = new TextEncoder().encode(x);
	return [0, b.length, ...b];
};
test("nbt", () => {
	const b = new Uint8Array([
		10,
		...s(""),
		9,
		...s("Inventory"),
		10,
		0,
		0,
		0,
		1,
		1,
		...s("Slot"),
		3,
		8,
		...s("id"),
		...s("minecraft:stone"),
		3,
		...s("count"),
		0,
		0,
		0,
		5,
		0,
		3,
		...s("XpLevel"),
		0,
		0,
		0,
		7,
		0,
	]);
	const r = parseNbt(b) as {
		XpLevel: number;
		Inventory: { id: string }[];
	};
	expect(r.XpLevel).toBe(7);
	expect(r.Inventory[0]?.id).toBe("minecraft:stone");
});

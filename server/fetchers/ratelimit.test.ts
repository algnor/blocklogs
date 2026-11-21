import { expect, test } from "bun:test";
import { RateLimiter } from "./ratelimit";

test("allows a burst, then spaces requests to the sustained rate", async () => {
	const l = new RateLimiter(3000, 2); // 50/s, burst of 2
	const t = Date.now();
	for (let i = 0; i < 6; i++) await l.acquire();
	const took = Date.now() - t;
	expect(took).toBeGreaterThanOrEqual(70); // 4 waits of ~20ms
	expect(took).toBeLessThan(400);
});

test("concurrent callers are served one at a time, in order", async () => {
	const l = new RateLimiter(3000, 1);
	const order: number[] = [];
	await Promise.all(
		[0, 1, 2, 3].map((i) => l.acquire().then(() => order.push(i))),
	);
	expect(order).toEqual([0, 1, 2, 3]);
});

test("penalize pauses everyone", async () => {
	const l = new RateLimiter(60_000, 5);
	await l.acquire();
	l.penalize(80);
	const t = Date.now();
	await l.acquire();
	expect(Date.now() - t).toBeGreaterThanOrEqual(75);
});

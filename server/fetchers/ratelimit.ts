const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A token bucket shared by every request to one panel: `ratePerMin` sustained, bursts up to
 * `capacity`. Callers queue in order. `penalize` pauses everyone, for when the panel says 429.
 */
export class RateLimiter {
	private tokens: number;
	private last = Date.now();
	private blockedUntil = 0;
	private tail: Promise<unknown> = Promise.resolve();

	constructor(
		private readonly ratePerMin: number,
		private readonly capacity = 10,
	) {
		this.tokens = capacity;
	}

	acquire(): Promise<void> {
		const run = this.tail.then(() => this.take());
		this.tail = run.catch(() => {});
		return run;
	}

	/** Nothing is sent for `ms`, and the burst allowance starts again from empty. */
	penalize(ms: number) {
		this.blockedUntil = Math.max(this.blockedUntil, Date.now() + ms);
		this.tokens = 0;
		this.last = this.blockedUntil;
	}

	private async take(): Promise<void> {
		const perMs = this.ratePerMin / 60_000;
		for (;;) {
			const now = Date.now();
			if (now < this.blockedUntil) {
				await sleep(this.blockedUntil - now);
				continue;
			}
			this.tokens = Math.min(
				this.capacity,
				this.tokens + (now - this.last) * perMs,
			);
			this.last = now;
			if (this.tokens >= 1) {
				this.tokens -= 1;
				return;
			}
			await sleep(Math.ceil((1 - this.tokens) / perMs));
		}
	}
}

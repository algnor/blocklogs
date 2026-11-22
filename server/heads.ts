import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config";

const dir = join(config.dataDir, "heads");
const FRESH_MS = 7 * 86_400_000;
const MISS_MS = 3_600_000;
const misses = new Map<string, number>();
const inflight = new Map<string, Promise<Uint8Array | null>>();

export const validHeadName = (name: string) =>
	/^[A-Za-z0-9_.]{1,32}$/.test(name);

async function load(name: string): Promise<Uint8Array | null> {
	const file = join(dir, `${name.toLowerCase()}.png`);
	const f = Bun.file(file);
	const st = await stat(file).catch(() => null);
	if (st && Date.now() - st.mtimeMs < FRESH_MS)
		return new Uint8Array(await f.arrayBuffer());
	try {
		const res = await fetch(
			`https://minotar.net/helm/${encodeURIComponent(name)}/64.png`,
			{ signal: AbortSignal.timeout(8000) },
		);
		if (!res.ok) throw new Error(String(res.status));
		const bytes = new Uint8Array(await res.arrayBuffer());
		await mkdir(dir, { recursive: true });
		await Bun.write(file, bytes);
		return bytes;
	} catch {
		// Serve a stale head over none.
		if (st) return new Uint8Array(await f.arrayBuffer());
		misses.set(name.toLowerCase(), Date.now());
		return null;
	}
}

/** A player's head (helm layer included) as PNG bytes, cached on disk; null when there is none. */
export function playerHead(name: string): Promise<Uint8Array | null> {
	const key = name.toLowerCase();
	const miss = misses.get(key);
	if (miss && Date.now() - miss < MISS_MS) return Promise.resolve(null);
	let p = inflight.get(key);
	if (!p) {
		p = load(name).finally(() => inflight.delete(key));
		inflight.set(key, p);
	}
	return p;
}

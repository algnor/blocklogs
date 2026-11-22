import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InventoryItem, PlayerData } from "../shared/api";
import { db, type ServerRow } from "./db";
import { makeFetcher } from "./fetchers";
import { type Nbt, parseNbt } from "./games/nbt";

type Compound = { [key: string]: Nbt };

const isCompound = (n: Nbt | undefined): n is Compound =>
	typeof n === "object" && n !== null && !Array.isArray(n);
const num = (n: Nbt | undefined) =>
	typeof n === "number" ? n : typeof n === "bigint" ? Number(n) : null;
const list = (n: Nbt | undefined): Nbt[] =>
	Array.isArray(n) ? (n as Nbt[]) : [];

function plainText(s: string): string {
	try {
		const j = JSON.parse(s) as unknown;
		const walk = (x: unknown): string => {
			if (typeof x === "string") return x;
			if (Array.isArray(x)) return x.map(walk).join("");
			if (x && typeof x === "object") {
				const o = x as { text?: unknown; extra?: unknown };
				return walk(o.text ?? "") + walk(o.extra ?? "");
			}
			return "";
		};
		return walk(j) || s;
	} catch {
		return s;
	}
}

function parseItems(n: Nbt | undefined): InventoryItem[] {
	const out: InventoryItem[] = [];
	for (const it of list(n)) {
		if (!isCompound(it) || typeof it.id !== "string") continue;
		const comps = isCompound(it.components) ? it.components : {};
		const legacy = isCompound(it.tag) ? it.tag : {};
		const enchantments: Record<string, number> = {};
		const ench = comps["minecraft:enchantments"];
		if (isCompound(ench)) {
			const levels = isCompound(ench.levels) ? ench.levels : ench;
			for (const [k, v] of Object.entries(levels)) {
				const l = num(v);
				if (l !== null) enchantments[k] = l;
			}
		}
		for (const e of list(legacy.Enchantments))
			if (isCompound(e) && typeof e.id === "string")
				enchantments[e.id] = num(e.lvl) ?? 1;
		const custom = comps["minecraft:custom_name"];
		const legacyName = isCompound(legacy.display) ? legacy.display.Name : null;
		const rawName = typeof custom === "string" ? custom : legacyName;
		out.push({
			slot: num(it.Slot) ?? 0,
			id: it.id,
			count: num(it.count) ?? num(it.Count) ?? 1,
			enchantments,
			name: typeof rawName === "string" ? plainText(rawName) : null,
		});
	}
	return out;
}

function parseInventory(root: Compound): NonNullable<PlayerData["inventory"]> {
	const pos = list(root.Pos).map(num);
	const dim = root.Dimension;
	return {
		items: parseItems(root.Inventory),
		enderChest: parseItems(root.EnderItems),
		health: num(root.Health),
		food: num(root.foodLevel),
		xpLevel: num(root.XpLevel),
		gameMode: num(root.playerGameType),
		dimension: typeof dim === "string" ? dim : null,
		position:
			pos.length === 3 && pos.every((p) => p !== null)
				? (pos as [number, number, number])
				: null,
	};
}

export const DEFAULT_VERSION = "1.21.4";

/** The Minecraft version of the server's most recent boot in its logs, if known. */
export function serverVersion(serverId: number): string | null {
	const r = db
		.query(
			`SELECT data FROM events WHERE server_id=? AND type='boot' AND data GLOB '[0-9]*'
			 ORDER BY ts DESC LIMIT 1`,
		)
		.get(serverId) as { data: string } | null;
	return r?.data ?? null;
}

export function uuidsFor(player: string, serverId: number): string[] {
	const rows = db
		.query(
			`SELECT data AS uuid FROM events WHERE server_id=? AND type='uuid' AND player=? AND data IS NOT NULL
			 UNION SELECT uuid FROM usercache WHERE server_id=? AND name=? COLLATE NOCASE`,
		)
		.all(serverId, player, serverId, player) as { uuid: string }[];
	return [...new Set(rows.map((r) => r.uuid.toLowerCase()))];
}

/** Reads a player's inventory and statistics straight from the server's world folder. */
export async function readPlayerData(
	server: ServerRow,
	player: string,
): Promise<PlayerData> {
	const uuids = uuidsFor(player, server.id);
	const result: PlayerData = {
		player,
		serverId: server.id,
		uuid: uuids[0] ?? "",
		inventory: null,
		stats: null,
		version: serverVersion(server.id),
		errors: [],
	};
	if (!uuids.length) {
		result.errors.push("No UUID is known for this player on this server");
		return result;
	}
	const fetcher = makeFetcher(server);
	const dir = await mkdtemp(join(tmpdir(), "blocklogs-"));
	try {
		let level = "world";
		try {
			const root = await fetcher.list("/");
			if (root.some((f) => f.name === "server.properties")) {
				const dest = join(dir, "server.properties");
				await fetcher.download("/server.properties", dest);
				const m = /^level-name=(.+)$/m.exec(await Bun.file(dest).text());
				if (m?.[1]?.trim() && !m[1].includes("..")) level = m[1].trim();
			}
		} catch {}

		const tryFetch = async (remote: string) => {
			const dest = join(dir, `f${Math.random().toString(36).slice(2)}`);
			try {
				await fetcher.download(remote, dest);
			} catch {
				return null;
			}
			return new Uint8Array(await Bun.file(dest).arrayBuffer());
		};

		for (const uuid of uuids) {
			if (!result.inventory) {
				const raw =
					(await tryFetch(`/${level}/players/data/${uuid}.dat`)) ??
					(await tryFetch(`/${level}/playerdata/${uuid}.dat`));
				if (raw) {
					try {
						const bytes =
							raw[0] === 0x1f && raw[1] === 0x8b ? Bun.gunzipSync(raw) : raw;
						result.inventory = parseInventory(parseNbt(bytes));
						result.uuid = uuid;
					} catch (e) {
						result.errors.push(`playerdata: ${(e as Error).message}`);
					}
				}
			}
			if (!result.stats) {
				const raw =
					(await tryFetch(`/${level}/players/stats/${uuid}.json`)) ??
					(await tryFetch(`/${level}/stats/${uuid}.json`));
				if (raw) {
					try {
						const j = JSON.parse(new TextDecoder().decode(raw)) as {
							stats?: Record<string, Record<string, number>>;
						};
						result.stats = j.stats ?? {};
						if (!result.inventory) result.uuid = uuid;
					} catch (e) {
						result.errors.push(`stats: ${(e as Error).message}`);
					}
				}
			}
		}
		if (!result.inventory && !result.stats)
			result.errors.push(`No playerdata or stats file found in /${level}`);
	} finally {
		await fetcher.close?.().catch(() => {});
		await rm(dir, { recursive: true, force: true });
	}
	return result;
}

import { existsSync, statSync } from "node:fs";
import { rename } from "node:fs/promises";
import { isIP } from "node:net";
import maxmind, { type CountryResponse, type Reader } from "maxmind";
import { mmdbPath } from "./config";

export type GeoInfo = {
	country: string;
	countryName: string;
	continent: string;
	continentName: string;
};

const CONTINENTS: Record<string, string> = {
	AF: "Africa",
	AN: "Antarctica",
	AS: "Asia",
	EU: "Europe",
	NA: "North America",
	OC: "Oceania",
	SA: "South America",
};
const LAN: GeoInfo = {
	country: "LAN",
	countryName: "Private/Local",
	continent: "--",
	continentName: "Private/Local/Unknown",
};
const UNK: GeoInfo = {
	country: "??",
	countryName: "Unknown",
	continent: "??",
	continentName: "Unknown",
};

type Rec = CountryResponse;

let reader: Reader<Rec> | null = null;
const cache = new Map<string, GeoInfo>();

export const geoReady = () => reader !== null;

const DBIP = (d: Date) =>
	`https://download.db-ip.com/free/dbip-country-lite-${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}.mmdb.gz`;

async function download(): Promise<boolean> {
	const now = new Date();
	for (const d of [
		now,
		new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
	]) {
		try {
			const res = await fetch(DBIP(d), {
				headers: { "User-Agent": "blocklogs" },
			});
			if (!res.ok) continue;
			const tmp = `${mmdbPath}.tmp`;
			await Bun.write(
				tmp,
				Bun.gunzipSync(new Uint8Array(await res.arrayBuffer())),
			);
			await rename(tmp, mmdbPath);
			return true;
		} catch (e) {
			console.warn(`[geo] download failed: ${(e as Error).message}`);
		}
	}
	return false;
}

/** Opens the DB-IP database, downloading it first if it is missing or over 35 days old. */
export async function initGeo(): Promise<void> {
	const stale =
		!existsSync(mmdbPath) ||
		Date.now() - statSync(mmdbPath).mtimeMs > 35 * 86400_000;
	if (stale) await download();
	if (!existsSync(mmdbPath)) {
		console.warn("[geo] no GeoIP database; country stats unavailable");
		return;
	}
	reader = await maxmind.open<Rec>(mmdbPath);
	cache.clear();
}

function isPrivate(ip: string): boolean {
	if (isIP(ip) === 4) {
		const [a, b] = ip.split(".").map(Number) as [number, number];
		return (
			a === 10 ||
			a === 127 ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			(a === 169 && b === 254) ||
			a === 0
		);
	}
	const l = ip.toLowerCase();
	return (
		l === "::1" ||
		l.startsWith("fe80") ||
		l.startsWith("fc") ||
		l.startsWith("fd")
	);
}

export function lookup(ip: string | null): GeoInfo {
	if (!ip) return UNK;
	const hit = cache.get(ip);
	if (hit) return hit;
	let res = UNK;
	if (isIP(ip) && isPrivate(ip)) res = LAN;
	else if (reader && isIP(ip)) {
		const rec: Partial<Rec> = reader.get(ip) ?? {};
		const c: Partial<NonNullable<Rec["country"]>> =
			rec.country ?? rec.registered_country ?? {};
		const kc = rec.continent?.code ?? "??";
		if (c.iso_code || kc !== "??")
			res = {
				country: c.iso_code ?? "??",
				countryName: c.names?.en ?? c.iso_code ?? "Unknown",
				continent: kc,
				continentName: rec.continent?.names?.en ?? CONTINENTS[kc] ?? "Unknown",
			};
	}
	cache.set(ip, res);
	return res;
}

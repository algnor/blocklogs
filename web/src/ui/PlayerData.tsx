import {
	Async,
	Card,
	Empty,
	Pager,
	Segmented,
	SortTh,
	Tabs,
	Tile,
} from "@aomc-server/block-ui";
import { formatHours, formatInt } from "@aomc-server/block-ui/format";
import { createContext } from "preact";
import { useContext, useMemo, useState } from "preact/hooks";
import type { InventoryItem, PlayerData } from "../../../shared/api";
import { useFetch } from "../hooks";
import { serverName } from "../state";

type StatMap = Record<string, Record<string, number>>;

const strip = (id: string) => id.replace(/^[a-z0-9_.-]+:/, "");
const pretty = (id: string) =>
	strip(id)
		.replace(/[_/]/g, " ")
		.replace(/^./, (c) => c.toUpperCase());

const GAME_MODES = ["Survival", "Creative", "Adventure", "Spectator"];

const CATEGORY_LABELS: Record<string, string> = {
	custom: "General",
	mined: "Blocks mined",
	crafted: "Items crafted",
	used: "Items used",
	broken: "Tools broken",
	picked_up: "Items picked up",
	dropped: "Items dropped",
	killed: "Mobs killed",
	killed_by: "Killed by",
};
const categoryLabel = (c: string) => CATEGORY_LABELS[strip(c)] ?? pretty(c);
const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS);

function formatStat(category: string, key: string, v: number): string {
	const k = strip(key);
	if (strip(category) === "custom") {
		if (k.endsWith("_one_cm")) {
			const m = v / 100;
			return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
		}
		if (k.endsWith("_time") || k === "play_time" || k === "total_world_time")
			return formatHours(v / 72000);
		if (k.startsWith("damage_")) return `${formatInt(Math.round(v / 10))} ♥`;
	}
	return formatInt(v);
}

const DEFAULT_ICON_VERSION = "1.21.4";
const VersionContext = createContext<string | null>(null);

function ItemIcon(props: { id: string; size?: number }) {
	const version = useContext(VersionContext);
	const name = strip(props.id);
	const [stage, setStage] = useState(0);
	const size = props.size ?? 32;
	const urls: string[] = [];
	for (const v of new Set([version, DEFAULT_ICON_VERSION]))
		if (v)
			for (const dir of ["item", "block"])
				urls.push(
					`https://assets.mcasset.cloud/${v}/assets/minecraft/textures/${dir}/${name}.png`,
				);
	const url = urls[stage];
	if (!url)
		return (
			<span class="inv-fallback" style={{ width: size, height: size }}>
				{name.slice(0, 2).toUpperCase()}
			</span>
		);
	return (
		<img
			class="inv-icon"
			width={size}
			height={size}
			loading="lazy"
			alt=""
			src={url}
			onError={() => setStage(stage + 1)}
		/>
	);
}

function Slot(props: {
	item?: InventoryItem;
	selected?: boolean;
	onPick?: (i: InventoryItem) => void;
	placeholder?: string;
}) {
	const it = props.item;
	if (!it)
		return (
			<div class="inv-slot empty">
				{props.placeholder && <span class="inv-ph">{props.placeholder}</span>}
			</div>
		);
	const enchanted = Object.keys(it.enchantments).length > 0;
	return (
		<button
			type="button"
			class={`inv-slot filled${enchanted ? " enchanted" : ""}${props.selected ? " selected" : ""}`}
			title={it.name ?? pretty(it.id)}
			onClick={() => props.onPick?.(it)}
		>
			<ItemIcon id={it.id} />
			{it.count > 1 && <span class="inv-count">{it.count}</span>}
		</button>
	);
}

function ItemDetail(props: { item: InventoryItem | null }) {
	const it = props.item;
	if (!it)
		return <div class="inv-detail muted">Click an item for details.</div>;
	const ench = Object.entries(it.enchantments);
	return (
		<div class="inv-detail">
			<ItemIcon id={it.id} size={48} />
			<div>
				<strong>{it.name ?? pretty(it.id)}</strong>
				{it.name && <span class="muted"> ({pretty(it.id)})</span>}
				<div>
					<code>{it.id}</code> × {formatInt(it.count)}
				</div>
				{ench.length > 0 && (
					<ul class="plain-list">
						{ench.map(([k, v]) => (
							<li key={k}>
								{pretty(k)} {v}
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}

function Grid(props: {
	items: InventoryItem[];
	from: number;
	to: number;
	selected: InventoryItem | null;
	onPick: (i: InventoryItem) => void;
}) {
	const bySlot = new Map(props.items.map((i) => [i.slot, i]));
	const slots = [];
	for (let s = props.from; s <= props.to; s++) {
		const item = bySlot.get(s);
		slots.push(
			<Slot
				key={s}
				item={item}
				selected={item !== undefined && item === props.selected}
				onPick={props.onPick}
			/>,
		);
	}
	return <div class="inv-grid">{slots}</div>;
}

function Inventory(props: { inv: NonNullable<PlayerData["inventory"]> }) {
	const { inv } = props;
	const [tab, setTab] = useState<"inv" | "ender">("inv");
	const [sel, setSel] = useState<InventoryItem | null>(null);
	const find = (s: number) => inv.items.find((i) => i.slot === s);
	const pick = (i: InventoryItem) => setSel(sel === i ? null : i);
	const totals = useMemo(() => {
		const m = new Map<string, number>();
		for (const i of [...inv.items, ...inv.enderChest])
			m.set(i.id, (m.get(i.id) ?? 0) + i.count);
		return [...m].sort((a, b) => b[1] - a[1]);
	}, [inv]);
	const armor: [number, string][] = [
		[103, "Helmet"],
		[102, "Chestplate"],
		[101, "Leggings"],
		[100, "Boots"],
		[-106, "Offhand"],
	];
	return (
		<>
			<div class="tiles">
				<Tile
					label="Health"
					value={inv.health === null ? "-" : `${(inv.health / 2).toFixed(1)} ♥`}
				/>
				<Tile label="Food" value={inv.food === null ? "-" : String(inv.food)} />
				<Tile
					label="XP level"
					value={inv.xpLevel === null ? "-" : String(inv.xpLevel)}
				/>
				<Tile label="Game mode" value={GAME_MODES[inv.gameMode ?? -1] ?? "-"} />
				<Tile
					label="Dimension"
					value={inv.dimension ? pretty(inv.dimension) : "-"}
				/>
				<Tile
					label="Position"
					value={
						inv.position
							? inv.position.map((p) => Math.round(p)).join(", ")
							: "-"
					}
				/>
			</div>
			<Tabs
				label="Inventory view"
				value={tab}
				onChange={setTab}
				tabs={[
					{ id: "inv", label: `Inventory (${inv.items.length})` },
					{ id: "ender", label: `Ender chest (${inv.enderChest.length})` },
				]}
			/>
			<div class="inv-layout">
				<div>
					{tab === "inv" ? (
						<>
							<div class="inv-armor">
								{armor.map(([s, label]) => (
									<Slot
										key={s}
										item={find(s)}
										placeholder={label}
										selected={find(s) !== undefined && find(s) === sel}
										onPick={pick}
									/>
								))}
							</div>
							<Grid
								items={inv.items}
								from={9}
								to={35}
								selected={sel}
								onPick={pick}
							/>
							<div class="inv-hotbar">
								<Grid
									items={inv.items}
									from={0}
									to={8}
									selected={sel}
									onPick={pick}
								/>
							</div>
						</>
					) : (
						<Grid
							items={inv.enderChest}
							from={0}
							to={26}
							selected={sel}
							onPick={pick}
						/>
					)}
					<ItemDetail item={sel} />
				</div>
				<div class="inv-totals">
					<h4>All items</h4>
					{totals.length === 0 ? (
						<Empty>Empty.</Empty>
					) : (
						<ul class="plain-list">
							{totals.map(([id, n]) => (
								<li key={id}>
									<ItemIcon id={id} size={16} /> {pretty(id)}{" "}
									<span class="muted">× {formatInt(n)}</span>
								</li>
							))}
						</ul>
					)}
				</div>
			</div>
		</>
	);
}

const PAGE = 50;

function Stats(props: { stats: StatMap }) {
	const [cat, setCat] = useState("");
	const [q, setQ] = useState("");
	const [sort, setSort] = useState<"value" | "name">("value");
	const [dir, setDir] = useState<"asc" | "desc">("desc");
	const [offset, setOffset] = useState(0);
	const custom = props.stats["minecraft:custom"] ?? {};
	const cats = useMemo(
		() =>
			Object.keys(props.stats).sort((a, b) => {
				const ia = CATEGORY_ORDER.indexOf(strip(a));
				const ib = CATEGORY_ORDER.indexOf(strip(b));
				return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
			}),
		[props.stats],
	);
	const needle = q.trim().toLowerCase();
	const searching = needle !== "";
	const active = cat || cats[0] || "";

	const rows = useMemo(() => {
		const out: { cat: string; key: string; name: string; value: number }[] = [];
		for (const c of searching ? cats : [active]) {
			for (const [key, value] of Object.entries(props.stats[c] ?? {})) {
				const name = pretty(key);
				if (!searching || name.toLowerCase().includes(needle))
					out.push({ cat: c, key, name, value });
			}
		}
		const sign = dir === "asc" ? 1 : -1;
		out.sort(
			(a, b) =>
				sign *
					(sort === "name"
						? a.name.localeCompare(b.name)
						: a.value - b.value) || a.name.localeCompare(b.name),
		);
		return out;
	}, [props.stats, cats, active, searching, needle, sort, dir]);
	const max = Math.max(1, ...rows.map((r) => r.value));
	const sum = (c: string) =>
		Object.values(props.stats[c] ?? {}).reduce((a, b) => a + b, 0);
	const stat = (k: string) => custom[`minecraft:${k}`] ?? 0;
	const onSort = (col: string) => {
		const c = col as "value" | "name";
		if (c === sort) setDir(dir === "asc" ? "desc" : "asc");
		else {
			setSort(c);
			setDir(c === "name" ? "asc" : "desc");
		}
		setOffset(0);
	};
	const shown = rows.slice(offset, offset + PAGE);

	return (
		<>
			<div class="tiles">
				<Tile
					label="Play time"
					value={formatHours(stat("play_time") / 72000)}
				/>
				<Tile label="Deaths" value={formatInt(stat("deaths"))} />
				<Tile label="Mob kills" value={formatInt(stat("mob_kills"))} />
				<Tile label="Player kills" value={formatInt(stat("player_kills"))} />
				<Tile
					label="Walked"
					value={formatStat("custom", "walk_one_cm", stat("walk_one_cm"))}
				/>
				<Tile label="Blocks mined" value={formatInt(sum("minecraft:mined"))} />
			</div>
			<div class="toolbar">
				<input
					type="search"
					placeholder="Search all statistics…"
					aria-label="Search statistics"
					value={q}
					onInput={(e) => {
						setQ(e.currentTarget.value);
						setOffset(0);
					}}
				/>
			</div>
			{!searching && (
				<Tabs
					label="Statistic category"
					value={active}
					onChange={(c) => {
						setCat(c);
						setOffset(0);
					}}
					tabs={cats.map((c) => ({
						id: c,
						label: `${categoryLabel(c)} (${formatInt(Object.keys(props.stats[c] ?? {}).length)})`,
					}))}
				/>
			)}
			<div class="muted">
				{searching
					? `${formatInt(rows.length)} match${rows.length === 1 ? "" : "es"} across all categories`
					: `${categoryLabel(active)}: total ${formatInt(sum(active))}`}
			</div>
			{rows.length === 0 ? (
				<Empty>Nothing recorded.</Empty>
			) : (
				<>
					<div class="table-wrap">
						<table class="table">
							<thead>
								<tr>
									<SortTh
										label="Statistic"
										col="name"
										sort={sort}
										dir={dir}
										onSort={onSort}
									/>
									<SortTh
										label="Value"
										col="value"
										num
										sort={sort}
										dir={dir}
										onSort={onSort}
									/>
								</tr>
							</thead>
							<tbody>
								{shown.map((r) => (
									<tr key={`${r.cat}/${r.key}`}>
										<td class="stat-cell">
											<span
												class="stat-bar"
												style={{
													width: `${Math.max(1, (r.value / max) * 100)}%`,
												}}
											/>
											<span class="stat-name">
												{!["custom", "killed", "killed_by"].includes(
													strip(r.cat),
												) && <ItemIcon id={r.key} size={16} />}
												{r.name}
												{searching && (
													<span class="muted"> · {categoryLabel(r.cat)}</span>
												)}
											</span>
										</td>
										<td class="num">{formatStat(r.cat, r.key, r.value)}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					<Pager
						offset={offset}
						limit={PAGE}
						total={rows.length}
						onChange={setOffset}
					/>
				</>
			)}
		</>
	);
}

function View(props: { d: PlayerData }) {
	const { inventory, stats } = props.d;
	const [section, setSection] = useState<"inv" | "stats">(
		inventory ? "inv" : "stats",
	);
	return (
		<>
			{props.d.errors.length > 0 && <Empty>{props.d.errors.join("; ")}</Empty>}
			{inventory && stats && (
				<Tabs
					label="Player data"
					value={section}
					onChange={setSection}
					tabs={[
						{ id: "inv", label: "Inventory" },
						{ id: "stats", label: "Statistics" },
					]}
				/>
			)}
			{inventory && (section === "inv" || !stats) && (
				<Inventory inv={inventory} />
			)}
			{stats && (section === "stats" || !inventory) && <Stats stats={stats} />}
		</>
	);
}

/** A player's inventory and statistics on one server, read live from the server's files. */
export function PlayerDataCard(props: { player: string; serverIds: number[] }) {
	const [picked, setPicked] = useState<number | null>(null);
	const serverId = picked ?? props.serverIds[0] ?? null;
	const state = useFetch<PlayerData>(
		serverId === null
			? null
			: `/api/players/${encodeURIComponent(props.player)}/data`,
		{ server: serverId ?? undefined },
		0,
		false,
	);
	return (
		<Card
			title="Inventory & statistics"
			actions={
				props.serverIds.length > 1 ? (
					<Segmented
						small
						label="Server"
						value={String(serverId)}
						options={props.serverIds.map(String)}
						names={Object.fromEntries(
							props.serverIds.map((id) => [String(id), serverName(id)]),
						)}
						onChange={(v) => setPicked(Number(v))}
					/>
				) : undefined
			}
		>
			{serverId === null ? (
				<Empty>No server known for this player.</Empty>
			) : (
				<Async state={state}>
					{(d) => (
						<VersionContext.Provider value={d.version}>
							<View key={serverId} d={d} />
						</VersionContext.Provider>
					)}
				</Async>
			)}
		</Card>
	);
}

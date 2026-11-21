import type { ComponentChildren } from "preact";
import { navigate } from "../router";
import { serverColor, serverName } from "../state";

export function Link(props: {
	to: string;
	class?: string;
	title?: string;
	children: ComponentChildren;
}) {
	return (
		<a
			href={props.to}
			class={props.class}
			title={props.title}
			onClick={(e) => {
				if (
					e.defaultPrevented ||
					e.button !== 0 ||
					e.metaKey ||
					e.ctrlKey ||
					e.shiftKey
				)
					return;
				e.preventDefault();
				navigate(props.to);
			}}
		>
			{props.children}
		</a>
	);
}

export function Page(props: {
	title: string;
	actions?: ComponentChildren;
	children: ComponentChildren;
}) {
	return (
		<div class="page">
			<div class="page-head">
				<h1>{props.title}</h1>
				<div class="page-actions">{props.actions}</div>
			</div>
			<div class="page-inner">{props.children}</div>
		</div>
	);
}

export function Card(props: {
	title?: string;
	actions?: ComponentChildren;
	class?: string;
	children: ComponentChildren;
}) {
	return (
		<section class={`card ${props.class ?? ""}`}>
			{(props.title || props.actions) && (
				<div class="card-head">
					<h2>{props.title}</h2>
					<div class="page-actions">{props.actions}</div>
				</div>
			)}
			{props.children}
		</section>
	);
}

export function Tile(props: {
	label: string;
	value: ComponentChildren;
	hint?: string;
}) {
	return (
		<div class="tile" title={props.hint}>
			<div class="tile-value">{props.value}</div>
			<div class="tile-label">{props.label}</div>
		</div>
	);
}

export function Dot(props: { id: number; label?: boolean }) {
	return (
		<span class="dot-wrap" title={serverName(props.id)}>
			<span class="dot" style={{ background: serverColor(props.id) }} />
			{props.label && <span>{serverName(props.id)}</span>}
		</span>
	);
}

export function ServerDots(props: { ids: number[] }) {
	return (
		<span class="dots">
			{props.ids.map((id) => (
				<Dot key={id} id={id} />
			))}
		</span>
	);
}

const AVATAR_COLORS = [
	"#52a535",
	"#3fc3ef",
	"#f9801d",
	"#d150c6",
	"#c9a400",
	"#e1372e",
	"#8c7bff",
	"#1ccfc0",
];

export function Avatar(props: { name: string; size?: number }) {
	let h = 0;
	for (const c of props.name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
	const size = props.size ?? 24;
	return (
		<span
			class="avatar"
			style={{
				background: AVATAR_COLORS[h % AVATAR_COLORS.length],
				width: `${size}px`,
				height: `${size}px`,
				fontSize: `${Math.round(size * 0.55)}px`,
			}}
			aria-hidden="true"
		>
			{(props.name[0] ?? "?").toUpperCase()}
		</span>
	);
}

export function PlayerLink(props: { name: string }) {
	return (
		<Link to={`/players/${encodeURIComponent(props.name)}`} class="player-link">
			<Avatar name={props.name} size={20} />
			<span>{props.name}</span>
		</Link>
	);
}

export function Loading() {
	return (
		<p class="muted state" role="status">
			Loading…
		</p>
	);
}

export function ErrorBox(props: { message: string; onRetry?: () => void }) {
	return (
		<div class="error-box" role="alert">
			<span>{props.message}</span>
			{props.onRetry && (
				<button type="button" class="btn small" onClick={props.onRetry}>
					Retry
				</button>
			)}
		</div>
	);
}

export function Empty(props: { children?: ComponentChildren }) {
	return <p class="muted state">{props.children ?? "Nothing here yet."}</p>;
}

/** Standard rendering of a fetch's loading / error states; renders `children` once there is data. */
export function Async<T>(props: {
	state: {
		data: T | null;
		error: string | null;
		loading: boolean;
		reload: () => void;
	};
	children: (data: T) => ComponentChildren;
}) {
	const { data, error, loading, reload } = props.state;
	if (data === null) {
		if (error) return <ErrorBox message={error} onRetry={reload} />;
		return <Loading />;
	}
	return (
		<div class={loading ? "fade" : undefined}>
			{error && <ErrorBox message={error} onRetry={reload} />}
			{props.children(data)}
		</div>
	);
}

export function Pager(props: {
	offset: number;
	limit: number;
	total: number;
	onChange: (offset: number) => void;
}) {
	const { offset, limit, total } = props;
	if (total <= limit) return <div class="pager muted">{total} total</div>;
	const page = Math.floor(offset / limit) + 1;
	const pages = Math.ceil(total / limit);
	return (
		<div class="pager">
			<button
				type="button"
				class="btn small"
				disabled={offset <= 0}
				onClick={() => props.onChange(Math.max(0, offset - limit))}
			>
				Prev
			</button>
			<span class="muted">
				Page {page} of {pages} ({total} total)
			</span>
			<button
				type="button"
				class="btn small"
				disabled={offset + limit >= total}
				onClick={() => props.onChange(offset + limit)}
			>
				Next
			</button>
		</div>
	);
}

export function Check(props: {
	checked: boolean;
	disabled?: boolean;
	onChange: (v: boolean) => void;
	children: ComponentChildren;
}) {
	return (
		<label class={`check ${props.disabled ? "disabled" : ""}`}>
			<input
				type="checkbox"
				checked={props.checked}
				disabled={props.disabled}
				onChange={(e) =>
					props.onChange((e.currentTarget as HTMLInputElement).checked)
				}
			/>
			<span class="box" aria-hidden="true" />
			<span>{props.children}</span>
		</label>
	);
}

export function Field(props: {
	label: string;
	hint?: string;
	children: ComponentChildren;
}) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: the control is passed as children
		<label class="field">
			<span class="field-label">{props.label}</span>
			{props.children}
			{props.hint && <span class="hint muted">{props.hint}</span>}
		</label>
	);
}

export function SortTh(props: {
	label: string;
	col: string;
	sort: string;
	dir: "asc" | "desc";
	onSort: (col: string) => void;
	num?: boolean;
}) {
	const active = props.sort === props.col;
	return (
		<th
			class={props.num ? "num" : undefined}
			aria-sort={
				active ? (props.dir === "asc" ? "ascending" : "descending") : "none"
			}
		>
			<button
				type="button"
				class="plain sort"
				onClick={() => props.onSort(props.col)}
			>
				{props.label}
				{active ? (props.dir === "asc" ? " ▲" : " ▼") : ""}
			</button>
		</th>
	);
}

export function rowKey(e: KeyboardEvent, fn: () => void) {
	if (e.key === "Enter" || e.key === " ") {
		e.preventDefault();
		fn();
	}
}

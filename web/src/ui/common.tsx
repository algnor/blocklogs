import { Avatar, Dot } from "@aomc-server/block-ui";
import type { ComponentChildren } from "preact";
import type { SyncProgress } from "../../../shared/api";
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

/** A server as its colour, and its name when `label` is set. */
export function ServerDot(props: { id: number; label?: boolean }) {
	return (
		<Dot
			color={serverColor(props.id)}
			label={props.label ? serverName(props.id) : undefined}
			title={serverName(props.id)}
		/>
	);
}

export function ServerDots(props: { ids: number[] }) {
	return (
		<span class="dots">
			{props.ids.map((id) => (
				<ServerDot key={id} id={id} />
			))}
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

/** What a running sync is doing, for under its progress bar. */
export function syncLabel(p: SyncProgress): string {
	return `${p.phase} ${p.done}/${p.total}${p.errors > 0 ? ` · ${p.errors} errors` : ""}${p.current ? ` · ${p.current}` : ""}`;
}

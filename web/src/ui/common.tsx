import { Avatar, Dot } from "@aomc-server/block-ui";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
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

/** A player's head, or the library's initials avatar until (or unless) it loads. */
export function PlayerHead(props: { name: string; size?: number }) {
	const [failed, setFailed] = useState(false);
	if (failed) return <Avatar name={props.name} size={props.size} />;
	const size = props.size ?? 24;
	return (
		<img
			class="avatar"
			src={`/api/heads/${encodeURIComponent(props.name)}`}
			alt={props.name}
			width={size}
			height={size}
			loading="lazy"
			style={{ "--avatar-size": `${size}px` }}
			onError={() => setFailed(true)}
		/>
	);
}

export function PlayerLink(props: { name: string }) {
	return (
		<Link to={`/players/${encodeURIComponent(props.name)}`} class="player-link">
			<PlayerHead name={props.name} size={20} />
			<span>{props.name}</span>
		</Link>
	);
}

/** What a running sync is doing, for under its progress bar. */
export function syncLabel(p: SyncProgress): string {
	const parts = [`${p.phase} ${p.done}/${p.total}`];
	if (p.errors > 0) parts.push(`${p.errors} errors`);
	if (p.current) parts.push(p.current);
	return parts.join(" · ");
}

import { Card, ConnectionBadge, Dot, Toggle } from "@aomc-server/block-ui";
import { useEffect, useRef, useState } from "preact/hooks";
import { activityLog, connection } from "../live";
import { serverColor } from "../state";

const time = (iso: string) =>
	new Date(iso).toLocaleTimeString([], { hour12: false });

/** The server's activity log, newest at the bottom, following it unless you scroll up. */
export function ActivityLog(props: { serverIds: number[] }) {
	const [problemsOnly, setProblemsOnly] = useState(false);
	const [clearedBefore, setClearedBefore] = useState(0);
	const box = useRef<HTMLDivElement>(null);
	const follow = useRef(true);

	const entries = activityLog.value.filter(
		(e) =>
			e.id > clearedBefore &&
			(!problemsOnly || e.level !== "info") &&
			(props.serverIds.length === 0 ||
				e.serverId === null ||
				props.serverIds.includes(e.serverId)),
	);

	useEffect(() => {
		const el = box.current;
		if (el && follow.current) el.scrollTop = el.scrollHeight;
	}, [entries.length, entries.at(-1)?.id]);

	return (
		<Card
			title="Activity"
			actions={
				<>
					<ConnectionBadge status={connection.value} />
					<Toggle
						inline
						checked={problemsOnly}
						onChange={setProblemsOnly}
						label="Problems only"
					/>
					<button
						type="button"
						class="btn small"
						onClick={() =>
							setClearedBefore(activityLog.value.at(-1)?.id ?? clearedBefore)
						}
					>
						Clear
					</button>
				</>
			}
		>
			<div
				class="activity"
				ref={box}
				role="log"
				aria-live="off"
				onScroll={(e) => {
					const el = e.currentTarget;
					follow.current =
						el.scrollHeight - el.scrollTop - el.clientHeight < 40;
				}}
			>
				{entries.length === 0 && (
					<p class="muted small-text">
						Nothing yet. Syncs report here as they happen: every file, and every
						problem.
					</p>
				)}
				{entries.map((e) => (
					<div key={e.id} class={`activity-row lvl-${e.level}`}>
						<span class="activity-ts mono">{time(e.ts)}</span>
						<Dot
							color={
								e.serverId === null ? "var(--s4)" : serverColor(e.serverId)
							}
						/>
						<span class="activity-msg">{e.message}</span>
					</div>
				))}
			</div>
		</Card>
	);
}

import type { SyncProgress as Progress } from "../../../shared/api";

/** A running sync's progress bar and what it is doing. */
export function SyncProgress(props: { p: Progress }) {
	const { p } = props;
	return (
		<div class="progress-wrap">
			<div
				class="progress"
				role="progressbar"
				aria-valuemin={0}
				aria-valuemax={p.total}
				aria-valuenow={p.done}
			>
				<div
					style={{
						width: `${p.total ? Math.min(100, (p.done / p.total) * 100) : 5}%`,
					}}
				/>
			</div>
			<div class="muted small-text">
				{p.phase} {p.done}/{p.total}
				{p.errors > 0 && ` · ${p.errors} errors`}
				{p.current && ` · ${p.current}`}
			</div>
		</div>
	);
}

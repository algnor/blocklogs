import { type Preset, range } from "../state";

const PRESETS: { id: Preset; label: string }[] = [
	{ id: "7d", label: "7d" },
	{ id: "30d", label: "30d" },
	{ id: "90d", label: "90d" },
	{ id: "1y", label: "1y" },
	{ id: "all", label: "All" },
];

export function RangePicker() {
	const r = range.value;
	return (
		// biome-ignore lint/a11y/useSemanticElements: a fieldset would add unwanted chrome
		<div class="range" role="group" aria-label="Date range">
			{PRESETS.map((p) => (
				<button
					key={p.id}
					type="button"
					class={`btn small ${r.preset === p.id ? "active" : ""}`}
					aria-pressed={r.preset === p.id}
					onClick={() => {
						range.value = { ...r, preset: p.id };
					}}
				>
					{p.label}
				</button>
			))}
			<input
				type="date"
				aria-label="Since"
				value={r.since}
				max={r.until || undefined}
				onChange={(e) => {
					range.value = {
						...r,
						preset: "custom",
						since: e.currentTarget.value,
					};
				}}
			/>
			<span class="muted">to</span>
			<input
				type="date"
				aria-label="Until (exclusive)"
				value={r.until}
				min={r.since || undefined}
				onChange={(e) => {
					range.value = {
						...r,
						preset: "custom",
						until: e.currentTarget.value,
					};
				}}
			/>
		</div>
	);
}

import { Segmented } from "@aomc-server/block-ui";
import { type Preset, range } from "../state";

const PRESETS: Preset[] = ["7d", "30d", "90d", "1y", "all"];
const NAMES: Partial<Record<Preset, string>> = { all: "All" };

/** The date range every stats page uses: a preset, or dates picked by hand ("custom"). */
export function DateRange() {
	const r = range.value;
	return (
		<div class="range">
			<Segmented
				small
				label="Date range"
				value={r.preset}
				options={PRESETS}
				names={NAMES}
				onChange={(preset) => {
					range.value = { ...r, preset };
				}}
			/>
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

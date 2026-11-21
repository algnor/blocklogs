import {
	applyAppearance,
	isModeChoice,
	isStyle,
	type ModeChoice,
	prefersLight,
	resolveMode,
	type StyleId,
} from "@aomc-server/block-ui/theme";
import { effect, signal } from "@preact/signals";

/** What is kept in this browser. The prepaint script in index.html reads the same key. */
export type Settings = { mode: ModeChoice; style: StyleId };

const KEY = "blocklogs.settings";
const DEFAULTS: Settings = { mode: "dark", style: "bedrock" };

/** Settings from what was stored; anything missing or invalid is the default. */
export function parseSettings(raw: string | null): Settings {
	const result = { ...DEFAULTS };
	try {
		const stored = JSON.parse(raw ?? "null") as Partial<Settings> | null;
		if (isModeChoice(stored?.mode)) result.mode = stored.mode;
		if (isStyle(stored?.style)) result.style = stored.style;
	} catch {}
	return result;
}

function read(): string | null {
	try {
		return localStorage.getItem(KEY);
	} catch {
		return null;
	}
}

export const settings = signal<Settings>(parseSettings(read()));

export function updateSettings(patch: Partial<Settings>) {
	settings.value = { ...settings.value, ...patch };
	try {
		localStorage.setItem(KEY, JSON.stringify(settings.value));
	} catch {
		// Storage can be unavailable (private mode); the choice then lasts for this visit only.
	}
}

/** Keeps the mode and style on <html> in line with the settings, and with the system's colours. */
export function followAppearance() {
	return effect(() => {
		applyAppearance({
			mode: resolveMode(settings.value.mode, prefersLight.value),
			style: settings.value.style,
		});
	});
}

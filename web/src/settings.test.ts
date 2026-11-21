import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	followAppearance,
	parseSettings,
	settings,
	updateSettings,
} from "./settings";
import { SETTINGS_KEY } from "./settings-key";

/*
 * prefersLight is read-only and starts following the system when first read, so the fake system
 * has to be in place before anything reads it (nothing does at import time).
 */
const system = {
	matches: false,
	listeners: new Set<(e: { matches: boolean }) => void>(),
	set light(matches: boolean) {
		this.matches = matches;
		for (const fn of this.listeners) fn({ matches });
	},
};
Object.defineProperty(globalThis, "matchMedia", {
	configurable: true,
	value: () => ({
		get matches() {
			return system.matches;
		},
		addEventListener: (_: string, fn: (e: { matches: boolean }) => void) =>
			void system.listeners.add(fn),
	}),
});

test("parseSettings keeps valid choices and defaults the rest", () => {
	expect(parseSettings(null)).toEqual({ mode: "dark", style: "bedrock" });
	expect(parseSettings('{"mode":"system","style":"xp"}')).toEqual({
		mode: "system",
		style: "xp",
	});
	expect(parseSettings('{"mode":"blue","style":"xp"}')).toEqual({
		mode: "dark",
		style: "xp",
	});
	expect(parseSettings("not json")).toEqual({
		mode: "dark",
		style: "bedrock",
	});
});

describe("updateSettings", () => {
	const real = { localStorage: globalThis.localStorage };
	afterEach(() => {
		Object.defineProperty(globalThis, "localStorage", {
			value: real.localStorage,
			configurable: true,
		});
		updateSettings({ mode: "dark", style: "bedrock" });
	});

	const useStorage = (storage: Partial<Storage>) =>
		Object.defineProperty(globalThis, "localStorage", {
			value: storage,
			configurable: true,
		});

	test("keeps the merged settings under SETTINGS_KEY", () => {
		const saved = new Map<string, string>();
		useStorage({ setItem: (k, v) => void saved.set(k, v) });
		updateSettings({ style: "xp" });
		expect(settings.value).toEqual({ mode: "dark", style: "xp" });
		expect(JSON.parse(saved.get(SETTINGS_KEY) ?? "null")).toEqual({
			mode: "dark",
			style: "xp",
		});
	});

	test("still applies the choice when storage throws", () => {
		useStorage({
			setItem: () => {
				throw new Error("QuotaExceededError");
			},
		});
		expect(() => updateSettings({ mode: "light" })).not.toThrow();
		expect(settings.value.mode).toBe("light");
	});
});

describe("followAppearance", () => {
	const real = Object.getOwnPropertyDescriptor(globalThis, "document");
	const dataset: Record<string, string> = {};
	let stop: (() => void) | undefined;

	beforeEach(() => {
		for (const k of Object.keys(dataset)) delete dataset[k];
		Object.defineProperty(globalThis, "document", {
			value: { documentElement: { dataset } },
			configurable: true,
			writable: true,
		});
		Object.defineProperty(globalThis, "localStorage", {
			value: { setItem: () => {} },
			configurable: true,
		});
	});
	afterEach(() => {
		stop?.();
		if (real) Object.defineProperty(globalThis, "document", real);
		else delete (globalThis as { document?: unknown }).document;
		updateSettings({ mode: "dark", style: "bedrock" });
	});

	test("sets data-mode and data-style, and follows changes", () => {
		stop = followAppearance();
		expect(dataset).toMatchObject({ mode: "dark", style: "bedrock" });
		updateSettings({ mode: "light", style: "win98" });
		expect(dataset).toMatchObject({ mode: "light", style: "win98" });
	});

	test("resolves 'system' from the system's colours, and follows them", () => {
		stop = followAppearance();
		updateSettings({ mode: "system" });
		expect(dataset.mode).toBe("dark");
		system.light = true;
		expect(dataset.mode).toBe("light");
		system.light = false;
		expect(dataset.mode).toBe("dark");
	});

	test("ignores the system's colours when the mode is fixed", () => {
		stop = followAppearance();
		updateSettings({ mode: "dark" });
		system.light = true;
		expect(dataset.mode).toBe("dark");
		system.light = false;
	});
});

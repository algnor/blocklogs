import { fileURLToPath } from "node:url";
import { prepaintScript } from "@aomc-server/block-ui/theme";
import preact from "@preact/preset-vite";
import { defineConfig } from "vite";
import { SETTINGS_KEY } from "./src/settings-key";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
	root,
	plugins: [
		preact(),
		{
			// Applies the saved mode and style before the first paint (see settings.ts).
			name: "prepaint",
			transformIndexHtml: () => [
				{
					tag: "script",
					injectTo: "head-prepend",
					children: prepaintScript({ storageKey: SETTINGS_KEY }),
				},
			],
		},
	],
	server: {
		proxy: { "/api": "http://localhost:3000" },
	},
	build: {
		outDir: fileURLToPath(new URL("../dist", import.meta.url)),
		emptyOutDir: true,
	},
});

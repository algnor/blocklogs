import { fileURLToPath } from "node:url";
import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
	root,
	plugins: [preact()],
	server: {
		proxy: { "/api": "http://localhost:3000" },
	},
	build: {
		outDir: fileURLToPath(new URL("../dist", import.meta.url)),
		emptyOutDir: true,
	},
});

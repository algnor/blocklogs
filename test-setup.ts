import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { plugin } from "bun";

const ownModules = join(import.meta.dir, "node_modules");

// Bun loads .env on its own. Tests must never use real credentials (they would talk to the real
// panel) or the real data directory, so drop every PTERO_* variable and point DATA_DIR away.
for (const key of Object.keys(process.env)) {
	if (key.startsWith("PTERO_")) delete process.env[key];
}
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "blocklogs-test-"));

// block-ui is a file: dependency, which Bun installs as symlinks into ../block-ui; tests then load
// the library from there, with its own preact and @preact/signals, and effects in the app would not
// see the library's signals. Load every copy of the peers from this package instead.
const escaped = ownModules.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const foreignPeers = new RegExp(
	`^(?!${escaped}/).*/node_modules/(preact|@preact/signals(-core)?)/.*\\.m?js$`,
);

plugin({
	name: "single-preact",
	setup(build) {
		build.onLoad({ filter: foreignPeers }, (args) => {
			const rel = args.path.replace(/^.*\/node_modules\//, "");
			return {
				contents: `export * from ${JSON.stringify(`${ownModules}/${rel}`)};`,
				loader: "js",
			};
		});
	},
});

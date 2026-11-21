import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Bun loads .env on its own. Tests must never use real credentials (they would talk to the real
// panel) or the real data directory, so drop every PTERO_* variable and point DATA_DIR away.
for (const key of Object.keys(process.env)) {
	if (key.startsWith("PTERO_")) delete process.env[key];
}
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "logs-parser-test-"));

// bun scripts/import-local.ts <name> <dir containing logs/ and crash-reports/>
// Imports a directory on this machine as a server, for testing or for bringing in old logs.
import { db } from "../server/db";
import { syncServer } from "../server/sync";

const [name, dir] = process.argv.slice(2);
if (!name || !dir) {
	console.error("usage: bun scripts/import-local.ts <name> <dir>");
	process.exit(1);
}
const abs = (await import("node:path")).resolve(dir);
const row = db.query("SELECT id FROM servers WHERE name=?").get(name) as {
	id: number;
} | null;
const id =
	row?.id ??
	(
		db
			.query(
				"INSERT INTO servers(name, backend, panel_id) VALUES (?, 'local', ?) RETURNING id",
			)
			.get(name, abs) as { id: number }
	).id;
const t = Date.now();
await syncServer(id);
const s = db
	.query("SELECT last_sync_status, last_sync_error FROM servers WHERE id=?")
	.get(id);
console.log(s, `${((Date.now() - t) / 1000).toFixed(1)}s`);
console.log(
	db.query("SELECT COUNT(*) AS files FROM files WHERE server_id=?").get(id),
	db
		.query("SELECT COUNT(*) AS sessions FROM sessions WHERE server_id=?")
		.get(id),
);
process.exit(0);

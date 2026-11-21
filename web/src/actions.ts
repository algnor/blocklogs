import { send } from "./api";
import { toast } from "./ui/Toast";

/** Start a sync of one server, or of all (null). The server announces it, so nothing to refresh. */
export async function startSync(id: number | null) {
	try {
		await send("POST", id === null ? "/api/sync" : `/api/servers/${id}/sync`);
		toast(id === null ? "Sync started for all servers" : "Sync started");
	} catch (e) {
		toast(`Sync failed: ${(e as Error).message}`, "err");
	}
}

export async function startReparse(id: number, name: string) {
	try {
		await send("POST", `/api/servers/${id}/reparse`);
		toast(`Re-parsing ${name}`);
	} catch (e) {
		toast(`Re-parse failed: ${(e as Error).message}`, "err");
	}
}

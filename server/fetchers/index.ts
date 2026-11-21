import type { ServerRow } from "../db";
import { LocalFetcher } from "./local";
import { PterodactylFetcher } from "./pterodactyl";
import { pterodactylSftp } from "./sftp";
import type { Fetcher } from "./types";

export function makeFetcher(server: ServerRow): Fetcher {
	if (!server.panel_id)
		throw new Error("server has no panel identifier / directory set");
	switch (server.backend) {
		case "local":
			return new LocalFetcher(server.panel_id);
		case "sftp":
			return pterodactylSftp(server.panel_id);
		default:
			return new PterodactylFetcher(server.panel_id);
	}
}

export type * from "./types";

import type { Database } from "bun:sqlite";

export type EventRow = {
	line: number;
	ts: string;
	type: string;
	player: string | null;
	data: string | null;
};

export type CrashInfo = {
	ts: string | null;
	side: string;
	loader: string | null;
	description: string | null;
	exception: string | null;
	suspects: string | null;
};

export type ParsedFile = {
	lines: number;
	events: EventRow[];
	crash?: CrashInfo;
	usercache?: { name: string; uuid: string }[];
	error: string | null;
};

export type SourceKind = "log" | "crash" | "meta";

/** A remote location to sync: files in `dir` (or the single file `dir/name`) matching `match`. */
export type Source = {
	kind: SourceKind;
	dir: string;
	match: RegExp;
	/** Where the server's configured directory overrides `dir`. */
	configDir?: "log_dir" | "crash_dir";
};

export type ParseInput = {
	kind: SourceKind;
	/** Local path of the stored file (gzip). */
	path: string;
	name: string;
	/** Remote modification time, ms. */
	mtimeMs: number;
};

export interface GameParser {
	id: string;
	name: string;
	sources: Source[];
	/** Files that are re-fetched whenever their size or mtime changes (the live log). */
	parseFile(input: ParseInput): Promise<ParsedFile>;
	/** Rebuild the sessions table for a server from its events. Returns players currently online. */
	rebuildSessions(
		db: Database,
		serverId: number,
	): { sessions: number; online: string[] };
}

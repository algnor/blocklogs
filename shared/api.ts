/**
 * The contract between server/ and web/. All timestamps are UTC strings "YYYY-MM-DD HH:MM:SS.mmm"
 * (the log's own time), except `lastSyncAt` which is ISO 8601.
 *
 * Query parameters shared by the stats endpoints:
 *   servers=1,2,3   restrict to these server ids (omit for all servers)
 *   since=YYYY-MM-DD  session start / event time >=
 *   until=YYYY-MM-DD  session start / event time <
 */

export type SyncProgress = {
	phase: "listing" | "downloading" | "sessions" | "done" | "error";
	done: number;
	total: number;
	current: string | null;
	errors: number;
	/** When the sync started, ms since the epoch. */
	startedAt: number;
};

export type ServerSummary = {
	id: number;
	name: string;
	game: string;
	/** How files are fetched: the panel API, SFTP, or a directory on this machine. */
	backend: "ptero" | "sftp" | "local";
	/** Pterodactyl server identifier (or a directory, for the local backend). */
	panelId: string | null;
	logDir: string;
	crashDir: string;
	syncIntervalMin: number;
	enabled: boolean;
	lastSyncAt: string | null;
	lastSyncStatus: "ok" | "error" | "running" | null;
	lastSyncError: string | null;
	/** Present exactly while a sync is running. */
	progress: SyncProgress | null;
	online: string[];
	players: number;
	sessions: number;
	hoursTotal: number;
	hours7d: number;
	hours30d: number;
	crashes: number;
	files: number;
	lastEventAt: string | null;
};

export type ServerInput = {
	name: string;
	game?: string;
	backend?: "ptero" | "sftp" | "local";
	panelId: string;
	logDir?: string;
	crashDir?: string;
	syncIntervalMin?: number;
	enabled?: boolean;
};

/** GET /api/status */
export type AppStatus = {
	panelConfigured: boolean;
	panelUrl: string;
	/** SFTP login (PTERO_SFTP_USER and a password or key) is set. */
	sftpConfigured: boolean;
	geoReady: boolean;
	games: { id: string; name: string }[];
};

/** GET /api/panel/servers: servers visible to the API key. */
export type PanelServerRow = {
	identifier: string;
	name: string;
	description: string;
	node: string;
	imported: boolean;
	/** The panel's state: null when normal, else `suspended`, `installing`, `install_failed` ... */
	status: string | null;
	/** Suspended servers can't be imported: the panel does not let their files be read. */
	suspended: boolean;
};

/** POST /api/panel/import {identifiers}. Suspended servers are skipped, with the reason. */
export type ImportResult = {
	imported: ServerSummary[];
	skipped: { identifier: string; name: string; reason: string }[];
};

/** GET /api/overview */
export type Overview = {
	servers: number;
	players: number;
	sessions: number;
	hoursTotal: number;
	hours7d: number;
	online: { serverId: number; player: string }[];
	crashes7d: number;
};

export type PlayerRow = {
	player: string;
	serverIds: number[];
	sessions: number;
	hours: number;
	firstSeen: string;
	lastSeen: string;
	messages: number;
	commands: number;
	distinctIps: number;
};

/** GET /api/players?q=&sort=hours|sessions|lastSeen|firstSeen|messages|player&dir=asc|desc&limit=&offset= */
export type PlayerList = { total: number; rows: PlayerRow[] };

export type SessionRow = {
	serverId: number;
	player: string;
	start: string;
	end: string;
	secs: number;
	ip: string | null;
	country: string | null;
	closedBy: "leave" | "rejoin" | "stop" | "crash" | "open";
};

/** GET /api/sessions?player=&limit=&offset= (newest first) */
export type SessionList = { total: number; rows: SessionRow[] };

export type MessageRow = {
	serverId: number;
	ts: string;
	player: string;
	type: "chat" | "cmd";
	text: string;
};

/** GET /api/messages?type=chat|cmd&player=&q=&limit=&offset= (newest first) */
export type MessageList = { total: number; rows: MessageRow[] };

export type PlayerIp = {
	ip: string;
	country: string | null;
	countryName: string | null;
	logins: number;
	firstSeen: string;
	lastSeen: string;
};

/** GET /api/players/:name */
export type PlayerProfile = {
	player: string;
	uuids: { uuid: string; serverId: number; source: "log" | "usercache" }[];
	perServer: {
		serverId: number;
		sessions: number;
		hours: number;
		firstSeen: string;
		lastSeen: string;
		messages: number;
		commands: number;
	}[];
	ips: PlayerIp[];
	recentSessions: SessionRow[];
	recentMessages: MessageRow[];
};

export type InventoryItem = {
	/** Minecraft slot number: 0-8 hotbar, 9-35 inventory, 100-103 feet to head, -106 offhand. */
	slot: number;
	id: string;
	count: number;
	/** Enchantments as `id` -> level. */
	enchantments: Record<string, number>;
	name: string | null;
};

/** GET /api/players/:name/data?server=ID, read live from the server's world folder. */
export type PlayerData = {
	player: string;
	serverId: number;
	uuid: string;
	/** Null when the server has no playerdata file for this player. */
	inventory: {
		items: InventoryItem[];
		enderChest: InventoryItem[];
		health: number | null;
		food: number | null;
		xpLevel: number | null;
		gameMode: number | null;
		dimension: string | null;
		position: [number, number, number] | null;
	} | null;
	/** Vanilla statistics: category (`minecraft:mined`) -> stat id -> value. Null when missing. */
	stats: Record<string, Record<string, number>> | null;
	/** Minecraft version from the server's last boot in its logs; null until logs are re-parsed or if absent. */
	version: string | null;
	errors: string[];
};

export type GeoBucket = {
	code: string;
	name: string;
	secs: number;
	/** Percentage of the total, 0-100 (36.5 means 36.5%). */
	share: number;
	players: number;
	sessions: number;
	avgSecsPerPlayer: number;
	topPlayers: { player: string; secs: number }[];
};

/**
 * GET /api/geo?perPlayer=1 (attribute all of a player's time to their most-played country)
 * Continents sorted by time; each has its countries sorted by time.
 */
export type GeoReport = {
	totalSecs: number;
	totals: {
		continents: number;
		countries: number;
		players: number;
		sessions: number;
	};
	continents: (GeoBucket & { countries: GeoBucket[] })[];
};

/** GET /api/servers/:id/info: all-time details that the server list does not carry. */
export type ServerInfo = {
	/** First session start and last session end; null if there are no sessions. */
	range: { first: string | null; last: string | null };
	/** What is stored for the server. */
	files: {
		logs: number;
		crashes: number;
		meta: number;
		/** Size of the stored (compressed) files on the panel, as it was when fetched. */
		bytes: number;
		/** Files that could not be read completely. */
		withErrors: number;
		lastIngestedAt: string | null;
	};
	events: { chat: number; commands: number; joins: number };
	sessions: {
		total: number;
		avgSecs: number;
		longest: { player: string; secs: number; start: string } | null;
		/** How sessions ended: leave, rejoin, stop, crash, open. */
		endedBy: Record<string, number>;
	};
	/** The most players at once (a session counts for at most 24 hours). */
	peak: { players: number; at: string } | null;
	/** Names the server has in its usercache. */
	usercache: number;
};

/** The three activity charts, for all servers together or for one. */
export type ActivitySlice = {
	/** One entry per day in range (days without activity included). */
	daily: { date: string; players: number; sessions: number; hours: number }[];
	/** Average concurrent players by UTC hour of day, and total sessions started that hour. */
	hourOfDay: { hour: number; avgPlayers: number; sessions: number }[];
	/** Session length histogram. */
	lengths: { label: string; count: number }[];
};

/**
 * GET /api/activity. The top level is every selected server together (so `players` counts each
 * player once however many servers they played on). `byServer` has the same charts per server,
 * keyed by server id, over the same days, so they line up and stack.
 */
export type Activity = ActivitySlice & {
	byServer: Record<number, ActivitySlice>;
};

export type CrashRow = {
	fileId: number;
	serverId: number;
	name: string;
	ts: string | null;
	side: "server" | "client";
	loader: string | null;
	description: string | null;
	exception: string | null;
	suspects: string | null;
};

/** GET /api/crashes?limit=&offset= (newest first). GET /api/crashes/:fileId/raw -> text/plain */
export type CrashList = { total: number; rows: CrashRow[] };

export type FileInfo = {
	id: number;
	kind: "log" | "crash" | "meta";
	name: string;
	size: number;
	mtime: number;
	lines: number | null;
	events: number | null;
	error: string | null;
	ingestedAt: string;
};

/** GET /api/servers/:id/files?kind=&limit=&offset= (newest first) */
export type FileList = { total: number; rows: FileInfo[] };

/*
 * Mutations:
 *   GET    /api/servers/:id/info   -> ServerInfo
 *   POST   /api/servers            ServerInput  -> ServerSummary
 *   PATCH  /api/servers/:id        Partial<ServerInput> -> ServerSummary
 *   DELETE /api/servers/:id        (also deletes stored data)
 *   POST   /api/servers/:id/sync   start a sync            -> 202
 *   POST   /api/servers/:id/reparse  re-parse stored files -> 202
 *   POST   /api/sync               sync every enabled server -> 202
 *   POST   /api/panel/import       {identifiers: string[]} -> ImportResult
 * Errors are {error: string} with a 4xx/5xx status.
 */

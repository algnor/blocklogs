export type RemoteFile = { name: string; size: number; mtimeMs: number };

export interface Fetcher {
	/** Files (not directories) directly inside `dir`. A missing directory is an empty list. */
	list(dir: string): Promise<RemoteFile[]>;
	/** Write the remote file's bytes to `dest`. */
	download(path: string, dest: string): Promise<void>;
	/** Release any connection held. Called when a sync ends. */
	close?(): Promise<void>;
}

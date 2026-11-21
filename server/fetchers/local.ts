import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Fetcher, RemoteFile } from "./types";

/** Reads a directory on this machine as if it were a server's file tree. Used for tests and imports. */
export class LocalFetcher implements Fetcher {
	constructor(private readonly root: string) {}

	async list(dir: string): Promise<RemoteFile[]> {
		const abs = join(this.root, dir);
		let names: string[];
		try {
			names = await readdir(abs);
		} catch {
			return [];
		}
		const out: RemoteFile[] = [];
		for (const name of names) {
			const st = await stat(join(abs, name));
			if (st.isFile())
				out.push({ name, size: st.size, mtimeMs: Math.floor(st.mtimeMs) });
		}
		return out;
	}

	async download(path: string, dest: string): Promise<void> {
		await Bun.write(dest, Bun.file(join(this.root, path)));
	}
}

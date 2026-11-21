import { config } from "./config";
import type { ParsedFile, ParseInput } from "./games/types";

type Job = {
	game: string;
	input: ParseInput;
	resolve: (r: ParsedFile) => void;
	reject: (e: Error) => void;
};

/** A fixed set of workers that parse files off the main thread. */
class ParsePool {
	private idle: Worker[] = [];
	private queue: Job[] = [];
	private created = 0;
	private nextId = 0;

	run(game: string, input: ParseInput): Promise<ParsedFile> {
		return new Promise((resolve, reject) => {
			this.queue.push({ game, input, resolve, reject });
			this.pump();
		});
	}

	private pump() {
		while (this.queue.length) {
			let w = this.idle.pop();
			if (!w && this.created < config.workers) {
				w = new Worker(new URL("./parse.worker.ts", import.meta.url));
				this.created++;
			}
			if (!w) return;
			this.dispatch(w, this.queue.shift() as Job);
		}
	}

	private dispatch(w: Worker, job: Job) {
		const id = this.nextId++;
		const done = () => {
			w.onmessage = null;
			w.onerror = null;
			this.idle.push(w);
			this.pump();
		};
		w.onmessage = (
			e: MessageEvent<{ id: number; result?: ParsedFile; error?: string }>,
		) => {
			if (e.data.id !== id) return;
			done();
			if (e.data.result) job.resolve(e.data.result);
			else job.reject(new Error(e.data.error ?? "parse failed"));
		};
		w.onerror = (e) => {
			done();
			job.reject(new Error(e.message));
		};
		w.postMessage({ id, game: job.game, input: job.input });
	}
}

export const pool = new ParsePool();

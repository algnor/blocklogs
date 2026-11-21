import { getGame } from "./games";
import type { ParseInput } from "./games/types";

declare const self: Worker;

self.onmessage = async (
	e: MessageEvent<{ id: number; game: string; input: ParseInput }>,
) => {
	const { id, game, input } = e.data;
	try {
		self.postMessage({ id, result: await getGame(game).parseFile(input) });
	} catch (err) {
		self.postMessage({ id, error: (err as Error).message });
	}
};

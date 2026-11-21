import { minecraft } from "./minecraft";
import type { GameParser } from "./types";

export const games: Record<string, GameParser> = {
	[minecraft.id]: minecraft,
};

export function getGame(id: string): GameParser {
	const g = games[id];
	if (!g) throw new Error(`unknown game: ${id}`);
	return g;
}

export type * from "./types";

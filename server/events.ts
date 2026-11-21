import { Hono } from "hono";
import { type SSEStreamingApi, streamSSE } from "hono/streaming";
import type { Envelope, Events, Topic } from "../shared/events";
import { hub } from "./hub";
import { type TopicDef, topics } from "./topics";

const MAX_TOPICS = 16;
const PING_MS = 20_000;

const isTopic = (raw: string): raw is Topic => Object.hasOwn(topics, raw);

const write = (stream: SSEStreamingApi, envelope: Envelope) =>
	stream.writeSSE({ data: JSON.stringify(envelope) });

/**
 * Streams the topics as server-sent events: for each, its current state first, then every event
 * until the client goes away. Unnamed events whose data is the JSON envelope.
 */
export function streamTopics(
	c: Parameters<typeof streamSSE>[0],
	requested: string[],
) {
	return streamSSE(c, async (stream) => {
		let chain: Promise<unknown> = Promise.resolve();
		const send = (envelope: Envelope) => {
			chain = chain.then(() => write(stream, envelope)).catch(() => {});
		};
		let finish: () => void = () => {};
		const finished = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const undo: (() => void)[] = [];
		stream.onAbort(() => finish());

		for (const raw of [...new Set(requested)].slice(0, MAX_TOPICS)) {
			if (!isTopic(raw)) {
				send({ topic: raw, error: "unknown topic" });
				continue;
			}
			const def = topics[raw] as TopicDef<Topic>;
			// Subscribing and taking the snapshot happen in one synchronous step, so no event
			// can fall between them.
			undo.push(
				hub.subscribe(raw, (data, seq) =>
					send({
						topic: raw,
						seq,
						snapshot: false,
						data: data as Events[Topic],
					}),
				),
			);
			send({
				topic: raw,
				seq: hub.seq(raw),
				snapshot: true,
				data: def.snapshot(),
			});
		}
		if (undo.length === 0) {
			await chain;
			return;
		}

		const ping = setInterval(() => {
			chain = chain.then(() => stream.write(": ping\n\n")).catch(() => {});
		}, PING_MS);
		await finished;
		clearInterval(ping);
		for (const fn of undo) fn();
	});
}

export const eventRoutes = new Hono().get("/", (c) =>
	streamTopics(c, (c.req.query("topics") ?? "").split(",").filter(Boolean)),
);

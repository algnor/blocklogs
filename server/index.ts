import { existsSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { api } from "./api";
import { config } from "./config";
import { eventRoutes } from "./events";
import { initGeo } from "./geo";
import { startLive } from "./live";
import { startScheduler } from "./sync";

const dist = join(import.meta.dir, "..", "dist");

const app = new Hono();
app.route("/api/events", eventRoutes);
app.route("/api", api);
app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

if (existsSync(dist)) {
	app.get("*", async (c) => {
		const path = new URL(c.req.url).pathname;
		const file = Bun.file(join(dist, path));
		// Only serve files inside dist; anything else is a page of the single-page app.
		if (path !== "/" && !path.includes("..") && (await file.exists()))
			return new Response(file);
		return new Response(Bun.file(join(dist, "index.html")));
	});
}

void initGeo().catch((e) => console.warn(`[geo] ${(e as Error).message}`));
startScheduler();
startLive();

Bun.serve({
	port: config.port,
	hostname: config.host,
	fetch: app.fetch,
	idleTimeout: 120,
});
console.log(`blocklogs listening on http://${config.host}:${config.port}`);

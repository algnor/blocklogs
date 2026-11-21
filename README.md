# blocklogs

An internal admin dashboard for game-server logs. It pulls logs from Pterodactyl servers through the panel's client API, parses them into SQLite and shows players, sessions, chat, geography, activity and crash reports across all servers.

Minecraft is supported now (vanilla, Fabric, NeoForge). Parsers are pluggable per game: see `server/games/`.

There is no built-in auth. Put it behind your reverse proxy / SSO. It binds to `127.0.0.1` by default.

## Run

```sh
bun install
cp .env.example .env      # PTERO_URL, PTERO_API_KEY
bun run build             # builds the web app into dist/
bun run start             # http://127.0.0.1:3000
```

### Docker

```sh
cp .env.example .env      # set PTERO_URL and PTERO_API_KEY
docker compose up -d --build
```

The UI is on `http://127.0.0.1:3000`. The compose file only publishes it on localhost, so point your reverse proxy at it (there is no built-in auth). Everything it stores (database, downloaded logs, GeoIP database) is in the `blocklogs-data` volume, mounted at `/data`. The container runs as an unprivileged user and has a healthcheck. To build without compose, give the build the library checkout as a named context: `docker build --build-context block-ui=../block-ui -t blocklogs .`. Update with `git pull && docker compose up -d --build`; back up with `docker run --rm -v blocklogs-data:/data -v "$PWD":/out busybox tar czf /out/blocklogs-data.tgz -C /data .`.

### Development

`bun run dev` (API, watch mode) and `bun run dev:web` (Vite, proxies `/api` to :3000).

### UI

The interface is built on [`@aomc-server/block-ui`](../block-ui) (components, hooks, helpers and the stylesheet shared with blockmap); `web/src/styles.css` only has what is specific to this app. It is installed from `../block-ui` for now (`file:../block-ui` in `package.json`, copied into `node_modules` by `bun install`, so run it again after changing the library). The library ships TypeScript source, which is why Vite is run with `--configLoader runner` (`build` and `dev:web`): Vite's default config loader bundles the config with the library left external, and Node can't import TypeScript from `node_modules`, while the runner loads it through Vite itself (the config uses the library's prepaint script). Pick the colours (system / dark / light) and the style (Bedrock, Windows 98, Windows XP, Modern) under **Settings → Appearance**; it is kept in this browser (`blocklogs.settings`).

Then open **Settings → Import from panel** to add servers. They sync every 15 minutes (per-server setting), or press _Sync now_.

## Configuration (environment)

| Variable                                 | Default              |                                                                                                                       |
| ---------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `PTERO_URL`                              |                      | Panel base URL, e.g. `https://panel.example.com`                                                                      |
| `PTERO_API_KEY`                          |                      | A **client** API key (Account → API Credentials)                                                                      |
| `DATA_DIR`                               | `./data`             | Database, downloaded logs, GeoIP database                                                                             |
| `PORT` / `BIND_HOST`                     | `3000` / `127.0.0.1` |                                                                                                                       |
| `PTERO_SFTP_PASSWORD`                    |                      | The panel account's password for SFTP, or use a key:                                                                  |
| `PTERO_SFTP_USER`                        | looked up            | Panel account username; only set it to override the one the API key belongs to                                        |
| `PTERO_SFTP_KEY_FILE` / `PTERO_SFTP_KEY` |                      | Path to, or inline contents of, an SSH private key added to the panel account (`PTERO_SFTP_PASSPHRASE` if it has one) |
| `PTERO_SFTP_HOST` / `PTERO_SFTP_PORT`    | from the panel       | Override where SFTP is reached (default: the host and port the panel reports for each server)                         |
| `PTERO_RATE_PER_MIN`                     | `200`                | Panel API requests per minute to stay under (the panel's default limit is 240 per key)                                |
| `WORKERS`                                | cpu count - 1        | Parse workers                                                                                                         |
| `DOWNLOADS`                              | `4`                  | Parallel downloads per server                                                                                         |

## SFTP (recommended)

The panel API is rate limited and needs two requests per file, so SFTP is much faster for the first import and for large logs. Each server picks its backend in Settings: **Pterodactyl SFTP**, **Pterodactyl panel API** or a local directory. Servers imported from the panel use SFTP automatically when it is configured.

Pterodactyl's SFTP does not accept API keys. It logs in as the panel _account_: username `<panel username>.<server identifier>` with the account password, or an SSH key added under Account → SSH Keys. The account part of the username is looked up through the panel API from your API key (set `PTERO_SFTP_USER` to override it) and the server identifier is added for you, so only a password or key is needed. The same login works for every server the account can reach. Accounts with two-factor authentication can't use a password over SFTP, so use a key. One connection is opened per sync and shared by all downloads. The host and port come from the panel, so `PTERO_URL` and `PTERO_API_KEY` are still needed for importing servers.

In Docker, mount the **private** key read-only and point `PTERO_SFTP_KEY_FILE` at the path _inside the container_, or pass the key inline in `PTERO_SFTP_KEY` (with `\n` for newlines). The public key (`.pub`) is the one you add to the panel. For example:

```yaml
volumes:
  - blocklogs-data:/data
  - /home/you/.ssh/id_ed25519:/keys/sftp:ro
```

with `PTERO_SFTP_KEY_FILE=/keys/sftp` in `.env`. The container runs as uid 1000, so the key file must be readable by that user. If the key has a passphrase, set `PTERO_SFTP_PASSPHRASE`.

## How it works

- **Fetch.** For each server it lists `/logs`, `/crash-reports` and `/usercache.json` over SFTP (or the panel API) and downloads only files that are new or whose size or mtime changed (the live `latest.log` is re-fetched when it grows). Panel API requests share one rate limiter (token bucket, `PTERO_RATE_PER_MIN`), and a `429` pauses all of them with exponential backoff. Rotated `.gz` logs are stored as-is under `DATA_DIR/files/<server>/…` and the rest are gzipped on arrival.
- **Parse.** Files are decompressed as a stream in worker threads and reduced to events (join with IP, leave, UUID, chat, commands, boot, stop) and, for crash reports, a summary (time, description, exception, loader, suspected mods). Re-parsing after a parser change needs no download: _Re-parse stored files_ in Settings.
- **Sessions.** Built per server from the events: a session ends on leave, rejoin, server stop or a crash (a boot with no preceding stop). A session still open at the end of the data is `open`, and counts as online if the log was written in the last 15 minutes.
- **Geo.** Country and continent from the DB-IP lite database (downloaded automatically, refreshed monthly; CC BY 4.0).

### Live updates

Nothing polls. The server pushes everything over one server-sent-event stream, `GET /api/events?topics=servers,sync,log,data,online` (the structure is the one from aomc-map):

| Topic     | Carries                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------ |
| `servers` | every server with its stats; sent when one is added, edited or removed, a sync starts or ends, or the data changes |
| `sync`    | the syncs running now and how far each is, an event for every file                                                 |
| `log`     | the activity log: every step of every sync, and every problem, as it happens                                       |
| `data`    | new data landed, so pages fetch again                                                                              |
| `online`  | who is online; also changes as sessions age out, with nothing written                                              |

For each topic the first message is its current state (`snapshot: true`), built from the database and never from what was last announced, so a client can't be told something stale. `seq` counts a topic's events: a snapshot after reconnecting with the same `seq` means nothing was missed. The client shares one stream, batches subscriptions, reconnects with backoff, and polls each subscriber while the stream is down (and treats a stream that never says anything, such as behind a buffering proxy, as down). If you put it behind a reverse proxy, turn buffering off for `/api/events` (nginx: `proxy_buffering off;`; the server already sends `X-Accel-Buffering: no`).

The server side is `server/hub.ts` (fan-out), `server/topics.ts` (what each topic's snapshot is), `server/live.ts` (the only place that announces) and `server/events.ts` (the stream). A sync's lifecycle is one function, `runJob` in `server/sync.ts`, so a job can't start twice, always ends, and always tells followers.

The API contract between server and web is in `shared/api.ts`; the events are in `shared/events.ts`.

## Tools

```sh
bun test                    # parser, sessions, panel client, web helpers
bun run lint
bun run typecheck
bun scripts/import-local.ts <name> <dir>   # import a local directory laid out like a server (logs/, crash-reports/)
```

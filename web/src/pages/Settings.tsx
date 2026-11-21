import {
	Async,
	Card,
	Confirm,
	Empty,
	ErrorBox,
	Field,
	Loading,
	Modal,
	Page,
	Pager,
	Toggle,
	toast,
} from "@aomc-server/block-ui";
import {
	formatBytes,
	formatInt,
	formatRelative,
	formatShortTs,
} from "@aomc-server/block-ui/format";
import { MODES, STYLES } from "@aomc-server/block-ui/theme";
import { useState } from "preact/hooks";
import type {
	AppStatus,
	FileList,
	ImportResult,
	PanelServerRow,
	ServerInput,
	ServerSummary,
} from "../../../shared/api";
import { send } from "../api";
import { useFetch } from "../hooks";
import { settings, updateSettings } from "../settings";
import { refreshServers, servers, serversError } from "../state";
import { ServerDot } from "../ui/common";

function StatusCard(props: { status: AppStatus }) {
	const s = props.status;
	return (
		<Card title="Status">
			<div class="kv left">
				<span>Pterodactyl panel</span>
				<b class={s.panelConfigured ? "success" : "error-text"}>
					{s.panelConfigured ? `configured (${s.panelUrl})` : "not configured"}
				</b>
				<span>SFTP login</span>
				<b class={s.sftpConfigured ? "success" : "error-text"}>
					{s.sftpConfigured ? "configured" : "not configured"}
				</b>
				<span>Geo database</span>
				<b class={s.geoReady ? "success" : "error-text"}>
					{s.geoReady ? "ready" : "not ready"}
				</b>
				<span>Games</span>
				<b>{s.games.map((g) => g.name).join(", ") || "-"}</b>
			</div>
			{!s.panelConfigured && (
				<p class="muted">
					The panel is not configured. Set the <code>PTERO_URL</code> and{" "}
					<code>PTERO_API_KEY</code> environment variables and restart the
					server to import servers from a panel and sync their logs.
				</p>
			)}
			{!s.sftpConfigured && (
				<p class="muted">
					SFTP is much faster than the panel API for downloading logs. To use
					it, set <code>PTERO_SFTP_PASSWORD</code> (your panel password) or{" "}
					<code>PTERO_SFTP_KEY_FILE</code>, restart, and switch servers to the
					SFTP backend. The username is looked up through the panel API.
				</p>
			)}
			{!s.geoReady && (
				<p class="muted">
					The IP geolocation database is not available, so country data will be
					empty.
				</p>
			)}
		</Card>
	);
}

const BACKEND_NAMES: Record<ServerSummary["backend"], string> = {
	sftp: "SFTP",
	ptero: "Panel API",
	local: "Local",
};

type Form = {
	name: string;
	game: string;
	backend: ServerSummary["backend"];
	panelId: string;
	logDir: string;
	crashDir: string;
	syncIntervalMin: string;
	enabled: boolean;
};

function toForm(s: ServerSummary | null, games: AppStatus["games"]): Form {
	return {
		name: s?.name ?? "",
		game: s?.game ?? games[0]?.id ?? "minecraft",
		backend: s?.backend ?? "ptero",
		panelId: s?.panelId ?? "",
		logDir: s?.logDir ?? "",
		crashDir: s?.crashDir ?? "",
		syncIntervalMin: String(s?.syncIntervalMin ?? 60),
		enabled: s?.enabled ?? true,
	};
}

function EditModal(props: {
	server: ServerSummary | null;
	games: AppStatus["games"];
	onClose: () => void;
}) {
	const [f, setF] = useState<Form>(toForm(props.server, props.games));
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const set = <K extends keyof Form>(k: K, v: Form[K]) =>
		setF((o) => ({ ...o, [k]: v }));
	const valid = f.name.trim() !== "" && f.panelId.trim() !== "";

	const save = async () => {
		setBusy(true);
		setError(null);
		const body: ServerInput = {
			name: f.name.trim(),
			game: f.game,
			backend: f.backend,
			panelId: f.panelId.trim(),
			enabled: f.enabled,
		};
		if (f.logDir.trim()) body.logDir = f.logDir.trim();
		if (f.crashDir.trim()) body.crashDir = f.crashDir.trim();
		const n = Number(f.syncIntervalMin);
		if (Number.isFinite(n) && n > 0) body.syncIntervalMin = n;
		try {
			if (props.server)
				await send("PATCH", `/api/servers/${props.server.id}`, body);
			else await send("POST", "/api/servers", body);
			toast(props.server ? "Server updated" : "Server added", "ok");
			await refreshServers();
			props.onClose();
		} catch (e) {
			setError((e as Error).message);
			setBusy(false);
		}
	};

	return (
		<Modal
			title={props.server ? `Edit ${props.server.name}` : "Add server"}
			closeOnBackdrop
			onClose={props.onClose}
			footer={
				<>
					<button type="button" class="btn" onClick={props.onClose}>
						Cancel
					</button>
					<button
						type="button"
						class="btn primary"
						disabled={!valid || busy}
						onClick={save}
					>
						Save
					</button>
				</>
			}
		>
			<form
				class="form"
				onSubmit={(e) => {
					e.preventDefault();
					if (valid && !busy) void save();
				}}
			>
				{error && <ErrorBox message={error} />}
				<Field label="Name">
					<input
						value={f.name}
						onInput={(e) => set("name", e.currentTarget.value)}
					/>
				</Field>
				<Field label="Game">
					<select
						value={f.game}
						onChange={(e) => set("game", e.currentTarget.value)}
					>
						{props.games.map((g) => (
							<option key={g.id} value={g.id}>
								{g.name}
							</option>
						))}
					</select>
				</Field>
				<Field label="Backend">
					<select
						value={f.backend}
						onChange={(e) =>
							set("backend", e.currentTarget.value as Form["backend"])
						}
					>
						<option value="sftp">Pterodactyl SFTP (fast)</option>
						<option value="ptero">Pterodactyl panel API</option>
						<option value="local">Local directory</option>
					</select>
				</Field>
				<Field
					label={
						f.backend === "local" ? "Directory" : "Panel server identifier"
					}
					hint={
						f.backend === "local"
							? "Absolute path on the host."
							: "The short id from the panel URL."
					}
				>
					<input
						value={f.panelId}
						onInput={(e) => set("panelId", e.currentTarget.value)}
					/>
				</Field>
				<Field label="Log directory" hint="Leave empty for the game's default.">
					<input
						value={f.logDir}
						onInput={(e) => set("logDir", e.currentTarget.value)}
					/>
				</Field>
				<Field
					label="Crash directory"
					hint="Leave empty for the game's default."
				>
					<input
						value={f.crashDir}
						onInput={(e) => set("crashDir", e.currentTarget.value)}
					/>
				</Field>
				<Field label="Sync interval (minutes)">
					<input
						type="number"
						min={1}
						value={f.syncIntervalMin}
						onInput={(e) => set("syncIntervalMin", e.currentTarget.value)}
					/>
				</Field>
				<Toggle
					inline
					checked={f.enabled}
					onChange={(v) => set("enabled", v)}
					label="Enabled"
				/>
				<button type="submit" hidden />
			</form>
		</Modal>
	);
}

function FilesModal(props: { server: ServerSummary; onClose: () => void }) {
	const [kind, setKind] = useState("");
	const [offset, setOffset] = useState(0);
	const state = useFetch<FileList>(`/api/servers/${props.server.id}/files`, {
		kind,
		limit: 100,
		offset,
	});
	return (
		<Modal
			title={`Files: ${props.server.name}`}
			wide
			closeOnBackdrop
			onClose={props.onClose}
		>
			<div class="toolbar">
				<select
					aria-label="Kind"
					value={kind}
					onChange={(e) => {
						setKind(e.currentTarget.value);
						setOffset(0);
					}}
				>
					<option value="">All kinds</option>
					<option value="log">Logs</option>
					<option value="crash">Crash reports</option>
					<option value="meta">Meta</option>
				</select>
			</div>
			<Async state={state}>
				{(d) =>
					d.rows.length === 0 ? (
						<Empty>No files.</Empty>
					) : (
						<>
							<div class="table-wrap">
								<table class="table">
									<thead>
										<tr>
											<th>Name</th>
											<th>Kind</th>
											<th class="num">Size</th>
											<th class="num">Lines</th>
											<th class="num">Events</th>
											<th>Errors</th>
											<th>Ingested</th>
										</tr>
									</thead>
									<tbody>
										{d.rows.map((r) => (
											<tr key={r.id}>
												<td class="mono">{r.name}</td>
												<td>{r.kind}</td>
												<td class="num">{formatBytes(r.size)}</td>
												<td class="num">
													{r.lines === null ? "-" : formatInt(r.lines)}
												</td>
												<td class="num">
													{r.events === null ? "-" : formatInt(r.events)}
												</td>
												<td class={r.error ? "error-text wrap" : ""}>
													{r.error ?? ""}
												</td>
												<td>{formatShortTs(r.ingestedAt)}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
							<Pager
								offset={offset}
								limit={100}
								total={d.total}
								onChange={setOffset}
							/>
						</>
					)
				}
			</Async>
		</Modal>
	);
}

function ImportModal(props: { onClose: () => void }) {
	const state = useFetch<PanelServerRow[]>("/api/panel/servers");
	const [picked, setPicked] = useState<Set<string>>(new Set());
	const [busy, setBusy] = useState(false);
	const toggle = (id: string, on: boolean) => {
		const n = new Set(picked);
		if (on) n.add(id);
		else n.delete(id);
		setPicked(n);
	};
	const doImport = async () => {
		setBusy(true);
		try {
			const res = (await send<ImportResult>("POST", "/api/panel/import", {
				identifiers: [...picked],
			})) ?? { imported: [], skipped: [] };
			const n = res.imported.length;
			if (n > 0) toast(`Imported ${n} server${n === 1 ? "" : "s"}`, "ok");
			for (const s of res.skipped) toast(`${s.name}: ${s.reason}`, "error");
			await refreshServers();
			if (res.skipped.length === 0) props.onClose();
			else setBusy(false);
		} catch (e) {
			toast(`Import failed: ${(e as Error).message}`, "error");
			setBusy(false);
		}
	};
	return (
		<Modal
			title="Import from panel"
			closeOnBackdrop
			onClose={props.onClose}
			footer={
				<>
					<button type="button" class="btn" onClick={props.onClose}>
						Cancel
					</button>
					<button
						type="button"
						class="btn primary"
						disabled={picked.size === 0 || busy}
						onClick={doImport}
					>
						Import {picked.size || ""}
					</button>
				</>
			}
		>
			<Async state={state}>
				{(rows) =>
					rows.length === 0 ? (
						<Empty>The panel lists no servers.</Empty>
					) : (
						<ul class="plain-list import-list">
							{rows.map((r) => (
								<li key={r.identifier}>
									<Toggle
										inline
										checked={r.imported || picked.has(r.identifier)}
										disabled={r.imported || r.suspended}
										onChange={(v) => toggle(r.identifier, v)}
										label={
											<>
												<b>{r.name}</b>{" "}
												<span class="muted">
													{r.identifier} · {r.node}
												</span>{" "}
												{r.imported && <span class="badge ok">imported</span>}
												{r.suspended && (
													<span
														class="badge error"
														title="The panel does not let a suspended server's files be read."
													>
														suspended
													</span>
												)}
												{r.status && !r.suspended && (
													<span
														class="badge running"
														title="The panel's state for this server."
													>
														{r.status.replace(/_/g, " ")}
													</span>
												)}
												{r.description && (
													<div class="muted small-text">{r.description}</div>
												)}
											</>
										}
									/>
								</li>
							))}
						</ul>
					)
				}
			</Async>
		</Modal>
	);
}

type Dialog =
	| { kind: "edit"; server: ServerSummary | null }
	| { kind: "delete"; server: ServerSummary }
	| { kind: "files"; server: ServerSummary }
	| { kind: "import" };

function AppearanceCard() {
	const { mode, style } = settings.value;
	return (
		<Card title="Appearance">
			<p class="muted small-text">Saved in this browser only.</p>
			<fieldset class="mode-picker">
				<legend class="label">Colours</legend>
				<div class="segmented">
					{MODES.map((m) => (
						<button
							key={m.id}
							type="button"
							class={`btn ${m.id === mode ? "active" : ""}`}
							aria-pressed={m.id === mode}
							onClick={() => updateSettings({ mode: m.id })}
						>
							{m.name}
						</button>
					))}
				</div>
			</fieldset>
			<fieldset class="style-picker">
				<legend class="label">Style</legend>
				{STYLES.map((st) => (
					<label
						key={st.id}
						class={`style-option ${st.id === style ? "selected" : ""}`}
					>
						<input
							class="visually-hidden"
							type="radio"
							name="style"
							value={st.id}
							checked={st.id === style}
							onChange={() => updateSettings({ style: st.id })}
						/>
						<span class="style-preview" data-style={st.id} aria-hidden="true">
							<span class="preview-window">
								<span class="preview-head">Players</span>
								<span class="preview-body">
									<span class="btn small">Sync</span>
									<span class="btn small primary">Save</span>
								</span>
							</span>
						</span>
						<span class="style-name">{st.name}</span>
						<span class="muted hint">{st.hint}</span>
					</label>
				))}
			</fieldset>
		</Card>
	);
}

export function SettingsPage() {
	const status = useFetch<AppStatus>("/api/status");
	const [dialog, setDialog] = useState<Dialog | null>(null);
	const list = servers.value;
	const close = () => setDialog(null);

	const reparse = async (s: ServerSummary) => {
		try {
			await send("POST", `/api/servers/${s.id}/reparse`);
			toast(`Re-parsing ${s.name}`, "ok");
			await refreshServers();
		} catch (e) {
			toast(`Re-parse failed: ${(e as Error).message}`, "error");
		}
	};

	const remove = async (s: ServerSummary) => {
		close();
		try {
			await send("DELETE", `/api/servers/${s.id}`);
			toast(`Deleted ${s.name}`, "ok");
			await refreshServers();
		} catch (e) {
			toast(`Delete failed: ${(e as Error).message}`, "error");
		}
	};

	return (
		<Page embedded stack title="Settings">
			<Async state={status}>{(s) => <StatusCard status={s} />}</Async>
			<Card
				title="Servers"
				actions={
					<>
						<button
							type="button"
							class="btn small"
							disabled={!status.data?.panelConfigured}
							title={
								status.data?.panelConfigured ? "" : "Panel is not configured"
							}
							onClick={() => setDialog({ kind: "import" })}
						>
							Import from panel
						</button>
						<button
							type="button"
							class="btn small primary"
							onClick={() => setDialog({ kind: "edit", server: null })}
						>
							Add server
						</button>
					</>
				}
			>
				{serversError.value && !list && (
					<ErrorBox message={serversError.value} onRetry={refreshServers} />
				)}
				{!list && !serversError.value && <Loading />}
				{list && list.length === 0 && <Empty>No servers configured.</Empty>}
				{list && list.length > 0 && (
					<div class="table-wrap">
						<table class="table">
							<thead>
								<tr>
									<th>Name</th>
									<th>Game</th>
									<th>Backend</th>
									<th>Source</th>
									<th class="num">Every</th>
									<th>Last sync</th>
									<th class="num">Files</th>
									<th />
								</tr>
							</thead>
							<tbody>
								{list.map((s) => (
									<tr key={s.id}>
										<td>
											<ServerDot id={s.id} label />
											{!s.enabled && <span class="badge"> disabled</span>}
										</td>
										<td>{s.game}</td>
										<td>{BACKEND_NAMES[s.backend]}</td>
										<td class="mono wrap">{s.panelId ?? "-"}</td>
										<td class="num">{s.syncIntervalMin}m</td>
										<td>
											{formatRelative(s.lastSyncAt)}{" "}
											<span class={`badge ${s.lastSyncStatus ?? ""}`}>
												{s.lastSyncStatus ?? "never"}
											</span>
										</td>
										<td class="num">{formatInt(s.files)}</td>
										<td class="actions">
											<button
												type="button"
												class="btn small"
												onClick={() => setDialog({ kind: "files", server: s })}
											>
												Files
											</button>
											<button
												type="button"
												class="btn small"
												onClick={() => reparse(s)}
											>
												Re-parse
											</button>
											<button
												type="button"
												class="btn small"
												onClick={() => setDialog({ kind: "edit", server: s })}
											>
												Edit
											</button>
											<button
												type="button"
												class="btn small danger"
												onClick={() => setDialog({ kind: "delete", server: s })}
											>
												Delete
											</button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
				<p class="muted small-text">
					"Re-parse" rebuilds sessions and events from the stored files without
					downloading again.
				</p>
			</Card>

			<AppearanceCard />

			{dialog?.kind === "edit" && (
				<EditModal
					server={dialog.server}
					games={status.data?.games ?? []}
					onClose={close}
				/>
			)}
			{dialog?.kind === "files" && (
				<FilesModal server={dialog.server} onClose={close} />
			)}
			{dialog?.kind === "import" && <ImportModal onClose={close} />}
			{dialog?.kind === "delete" && (
				<Confirm
					title="Delete server"
					confirmLabel="Delete"
					danger
					onClose={close}
					onConfirm={() => remove(dialog.server)}
				>
					<p>
						Delete <b>{dialog.server.name}</b>? All stored files, sessions,
						messages and crash reports for this server are deleted too. This
						cannot be undone.
					</p>
				</Confirm>
			)}
		</Page>
	);
}

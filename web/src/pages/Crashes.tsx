import { useEffect, useState } from "preact/hooks";
import type { CrashList, CrashRow } from "../../../shared/api";
import { getText } from "../api";
import { shortTs } from "../format";
import { useFetch, usePageOffset } from "../hooks";
import { statsQuery } from "../state";
import {
	Async,
	Dot,
	Empty,
	ErrorBox,
	Loading,
	Page,
	Pager,
	rowKey,
} from "../ui/common";
import { Modal } from "../ui/Modal";
import { toast } from "../ui/Toast";

const LIMIT = 50;

function RawModal(props: { crash: CrashRow; onClose: () => void }) {
	const [text, setText] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const id = props.crash.fileId;
	useEffect(() => {
		let live = true;
		getText(`/api/crashes/${id}/raw`).then(
			(t) => live && setText(t),
			(e: Error) => live && setError(e.message),
		);
		return () => {
			live = false;
		};
	}, [id]);
	return (
		<Modal
			title={props.crash.name}
			wide
			onClose={props.onClose}
			footer={
				<>
					<button
						type="button"
						class="btn"
						disabled={text === null}
						onClick={async () => {
							try {
								await navigator.clipboard.writeText(text ?? "");
								toast("Copied crash report");
							} catch {
								toast("Copy failed", "err");
							}
						}}
					>
						Copy
					</button>
					<button type="button" class="btn primary" onClick={props.onClose}>
						Close
					</button>
				</>
			}
		>
			{error ? (
				<ErrorBox message={error} />
			) : text === null ? (
				<Loading />
			) : (
				<pre class="raw">{text}</pre>
			)}
		</Modal>
	);
}

export function CrashesPage() {
	const params = statsQuery(false);
	const [offset, setOffset] = usePageOffset(JSON.stringify(params));
	const [sel, setSel] = useState<CrashRow | null>(null);
	const state = useFetch<CrashList>("/api/crashes", {
		...params,
		limit: LIMIT,
		offset,
	});

	return (
		<Page title="Crashes">
			<Async state={state}>
				{(d) =>
					d.rows.length === 0 ? (
						<Empty>No crash reports.</Empty>
					) : (
						<>
							<div class="table-wrap">
								<table class="stats-table">
									<thead>
										<tr>
											<th>Time (UTC)</th>
											<th>Server</th>
											<th>Side</th>
											<th>Loader</th>
											<th>Description</th>
											<th>Exception</th>
											<th>Suspected mods</th>
										</tr>
									</thead>
									<tbody>
										{d.rows.map((c) => (
											<tr
												key={c.fileId}
												class="click"
												tabIndex={0}
												onClick={() => setSel(c)}
												onKeyDown={(e) => rowKey(e, () => setSel(c))}
											>
												<td class="nowrap">{shortTs(c.ts)}</td>
												<td>
													<Dot id={c.serverId} label />
												</td>
												<td>{c.side}</td>
												<td>{c.loader ?? "-"}</td>
												<td class="wrap">{c.description ?? "-"}</td>
												<td class="wrap mono">{c.exception ?? "-"}</td>
												<td class="wrap">{c.suspects ?? "-"}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
							<Pager
								offset={offset}
								limit={LIMIT}
								total={d.total}
								onChange={setOffset}
							/>
						</>
					)
				}
			</Async>
			{sel && <RawModal crash={sel} onClose={() => setSel(null)} />}
		</Page>
	);
}

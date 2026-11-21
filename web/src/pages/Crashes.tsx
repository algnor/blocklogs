import {
	Async,
	Empty,
	ErrorBox,
	Loading,
	Modal,
	Page,
	Pager,
	rowKey,
	toast,
} from "@aomc-server/block-ui";
import { usePageOffset } from "@aomc-server/block-ui/hooks";
import { useEffect, useState } from "preact/hooks";
import type { CrashList, CrashRow } from "../../../shared/api";
import { getText } from "../api";
import { formatShortTs } from "../format";
import { useFetch } from "../hooks";
import { statsQuery } from "../state";
import { ServerDot } from "../ui/common";

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
			closeOnBackdrop
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
								toast("Copied crash report", "ok");
							} catch {
								toast("Copy failed", "error");
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
		<Page embedded stack title="Crashes">
			<Async state={state}>
				{(d) =>
					d.rows.length === 0 ? (
						<Empty>No crash reports.</Empty>
					) : (
						<>
							<div class="table-wrap">
								<table class="table">
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
												<td class="nowrap">{formatShortTs(c.ts)}</td>
												<td>
													<ServerDot id={c.serverId} label />
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

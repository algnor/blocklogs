import { signal } from "@preact/signals";

type ToastItem = { id: number; text: string; kind: "ok" | "err" };
const toasts = signal<ToastItem[]>([]);
let nextId = 1;

export function toast(text: string, kind: "ok" | "err" = "ok") {
	const id = nextId++;
	toasts.value = [...toasts.value, { id, text, kind }];
	setTimeout(
		() => {
			toasts.value = toasts.value.filter((t) => t.id !== id);
		},
		kind === "err" ? 6000 : 3000,
	);
}

export function Toasts() {
	return (
		<div class="toasts" aria-live="polite">
			{toasts.value.map((t) => (
				<div
					key={t.id}
					class={`toast ${t.kind}`}
					role={t.kind === "err" ? "alert" : "status"}
				>
					{t.text}
				</div>
			))}
		</div>
	);
}

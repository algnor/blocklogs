import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

export function Modal(props: {
	title: string;
	onClose: () => void;
	wide?: boolean;
	children: ComponentChildren;
	footer?: ComponentChildren;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const { onClose } = props;

	useEffect(() => {
		const prev = document.activeElement as HTMLElement | null;
		ref.current?.focus();
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("keydown", onKey);
			prev?.focus?.();
		};
	}, [onClose]);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: backdrop click closes; Escape is handled globally
		<div
			class="modal-backdrop"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div
				class={`modal ${props.wide ? "wide" : ""}`}
				role="dialog"
				aria-modal="true"
				aria-label={props.title}
				tabIndex={-1}
				ref={ref}
			>
				<div class="modal-head">
					<h2>{props.title}</h2>
					<button
						type="button"
						class="btn small close"
						aria-label="Close"
						onClick={onClose}
					>
						×
					</button>
				</div>
				<div class="modal-body">{props.children}</div>
				{props.footer && <div class="modal-foot">{props.footer}</div>}
			</div>
		</div>
	);
}

export function Confirm(props: {
	title: string;
	children: ComponentChildren;
	confirmLabel: string;
	danger?: boolean;
	onConfirm: () => void;
	onClose: () => void;
}) {
	return (
		<Modal
			title={props.title}
			onClose={props.onClose}
			footer={
				<>
					<button type="button" class="btn" onClick={props.onClose}>
						Cancel
					</button>
					<button
						type="button"
						class={`btn ${props.danger ? "danger" : "primary"}`}
						onClick={props.onConfirm}
					>
						{props.confirmLabel}
					</button>
				</>
			}
		>
			{props.children}
		</Modal>
	);
}

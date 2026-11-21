export type Params = Record<
	string,
	string | number | boolean | null | undefined
>;

export class ApiError extends Error {
	status: number;
	constructor(message: string, status: number) {
		super(message);
		this.status = status;
	}
}

export function buildUrl(path: string, params: Params = {}): string {
	const sp = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (v === undefined || v === null || v === "" || v === false) continue;
		sp.set(k, v === true ? "1" : String(v));
	}
	const s = sp.toString();
	return s ? `${path}?${s}` : path;
}

async function request(
	method: string,
	url: string,
	body?: unknown,
): Promise<Response> {
	let res: Response;
	try {
		res = await fetch(url, {
			method,
			headers:
				body === undefined ? undefined : { "content-type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	} catch {
		throw new ApiError("Cannot reach the backend", 0);
	}
	if (!res.ok) {
		let msg = `${res.status} ${res.statusText}`;
		try {
			const j = (await res.clone().json()) as { error?: string };
			if (j.error) msg = j.error;
		} catch {}
		throw new ApiError(msg, res.status);
	}
	return res;
}

export async function getJson<T>(url: string): Promise<T> {
	return (await request("GET", url)).json() as Promise<T>;
}

export async function getText(url: string): Promise<string> {
	return (await request("GET", url)).text();
}

export async function send<T = unknown>(
	method: "POST" | "PATCH" | "DELETE",
	url: string,
	body?: unknown,
): Promise<T | null> {
	const res = await request(method, url, body);
	const text = await res.text();
	return text ? (JSON.parse(text) as T) : null;
}

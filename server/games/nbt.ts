export type Nbt =
	| number
	| bigint
	| string
	| Nbt[]
	| { [key: string]: Nbt }
	| number[]
	| bigint[];

/** Parses a (gunzipped) NBT file and returns its root compound. */
export function parseNbt(bytes: Uint8Array): { [key: string]: Nbt } {
	const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const td = new TextDecoder();
	let o = 0;

	const str = () => {
		const n = v.getUint16(o);
		o += 2;
		const s = td.decode(bytes.subarray(o, o + n));
		o += n;
		return s;
	};

	const payload = (type: number, depth: number): Nbt => {
		if (depth > 64) throw new Error("NBT nested too deeply");
		switch (type) {
			case 1:
				return v.getInt8(o++);
			case 2:
				o += 2;
				return v.getInt16(o - 2);
			case 3:
				o += 4;
				return v.getInt32(o - 4);
			case 4:
				o += 8;
				return v.getBigInt64(o - 8);
			case 5:
				o += 4;
				return v.getFloat32(o - 4);
			case 6:
				o += 8;
				return v.getFloat64(o - 8);
			case 7: {
				const n = v.getInt32(o);
				o += 4;
				const a = Array.from(
					new Int8Array(bytes.buffer, bytes.byteOffset + o, n),
				);
				o += n;
				return a;
			}
			case 8:
				return str();
			case 9: {
				const t = v.getInt8(o++);
				const n = v.getInt32(o);
				o += 4;
				const a: Nbt[] = [];
				for (let i = 0; i < n; i++) a.push(payload(t, depth + 1));
				return a;
			}
			case 10: {
				const c: { [key: string]: Nbt } = {};
				for (;;) {
					const t = v.getInt8(o++);
					if (t === 0) return c;
					const k = str();
					c[k] = payload(t, depth + 1);
				}
			}
			case 11:
			case 12: {
				const n = v.getInt32(o);
				o += 4;
				const a: (number | bigint)[] = [];
				for (let i = 0; i < n; i++) {
					if (type === 11) {
						a.push(v.getInt32(o));
						o += 4;
					} else {
						a.push(v.getBigInt64(o));
						o += 8;
					}
				}
				return a as number[] | bigint[];
			}
			default:
				throw new Error(`unknown NBT tag ${type}`);
		}
	};

	if (v.getInt8(o++) !== 10) throw new Error("NBT root is not a compound");
	str();
	return payload(10, 0) as { [key: string]: Nbt };
}

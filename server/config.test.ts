import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSftpKey, sftpKeyConfigured } from "./config";

const PRIVATE =
	"-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----\n";

test("no key configured", () => {
	expect(sftpKeyConfigured({})).toBe(false);
	expect(readSftpKey({})).toBeUndefined();
});

test("reads an inline key, turning \\n into newlines", () => {
	expect(
		readSftpKey({ PTERO_SFTP_KEY: PRIVATE.trim().replace(/\n/g, "\\n") }),
	).toBe(PRIVATE.trim());
});

test("reads a key file", () => {
	const f = join(mkdtempSync(join(tmpdir(), "key-")), "id");
	writeFileSync(f, PRIVATE);
	expect(sftpKeyConfigured({ PTERO_SFTP_KEY_FILE: f })).toBe(true);
	expect(readSftpKey({ PTERO_SFTP_KEY_FILE: f })).toBe(PRIVATE);
});

test("a missing key file is an error when read, not when checked", () => {
	const env = { PTERO_SFTP_KEY_FILE: "./keys/key.pub" };
	expect(sftpKeyConfigured(env)).toBe(true);
	expect(() => readSftpKey(env)).toThrow(
		/cannot read PTERO_SFTP_KEY_FILE.*ENOENT.*mount/,
	);
});

test("a public key is rejected with an explanation", () => {
	const f = join(mkdtempSync(join(tmpdir(), "key-")), "id.pub");
	writeFileSync(f, "ssh-rsa AAAAB3Nza user@host\n");
	expect(() => readSftpKey({ PTERO_SFTP_KEY_FILE: f })).toThrow(/public key/);
});

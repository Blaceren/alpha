/**
 * The scanner's SAFETY properties are the thing under test, more than its
 * detection is. A scanner that finds secrets but wanders out of its root is a
 * worse tool than one that finds nothing.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LIMITS, ScanRefused, formatReport, scanTree } from "./auditPackageLeakScan";

const roots: string[] = [];

function pkg(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ata-leakscan-"));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("scanTree — safety", () => {
  it("REFUSES an empty root rather than defaulting to anything", () => {
    expect(() => scanTree("")).toThrow(ScanRefused);
  });

  it("REFUSES a filesystem root", () => {
    expect(() => scanTree("/")).toThrow(ScanRefused);
  });

  it("REFUSES a root that is itself a symlink", () => {
    const real = pkg({ "00.md": "clean" });
    const link = path.join(os.tmpdir(), `ata-leakscan-link-${Date.now()}`);
    fs.symlinkSync(real, link);
    try {
      expect(() => scanTree(link)).toThrow(ScanRefused);
    } finally {
      fs.unlinkSync(link);
    }
  });

  it("does NOT follow a symlink inside the package — the incident this encodes", () => {
    const outside = pkg({ "secret.md": "password: hunter2hunter2" });
    const root = pkg({ "00.md": "clean" });
    fs.symlinkSync(outside, path.join(root, "node_modules"));

    const result = scanTree(root);

    expect(result.symlinksFound).toBe(1);
    expect(result.filesScanned).toBe(1); // only 00.md
    expect(result.findings).toHaveLength(0); // the linked tree was never read
  });

  it("refuses to descend a real node_modules too", () => {
    const root = pkg({
      "00.md": "clean",
      "node_modules/pkg/index.md": "password: hunter2hunter2",
    });

    const result = scanTree(root);

    expect(result.directoriesRefused).toBe(1);
    expect(result.findings).toHaveLength(0);
  });

  it("fails LOUDLY when a bound is exceeded rather than truncating silently", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i <= LIMITS.maxFiles; i += 1) files[`f${i}.md`] = "clean";
    const root = pkg(files);

    expect(() => scanTree(root)).toThrow(ScanRefused);
  });

  it("never captures the matched text", () => {
    const root = pkg({ "leak.md": 'password: "correct-horse-battery"' });

    const result = scanTree(root);

    expect(result.findings.length).toBeGreaterThan(0);
    const report = formatReport(result);
    expect(report).not.toContain("correct-horse-battery");
    expect(JSON.stringify(result)).not.toContain("correct-horse-battery");
  });
});

describe("scanTree — detection", () => {
  it.each([
    ["password_assignment", 'password: "s3cr3t-value"'],
    ["password_hash", "hash $2y$10$abcdefghijklmnopqrstuv"],
    ["authorization_header", "Authorization: Bearer abc.def.ghi"],
    ["basic_auth_inline", "curl https://user:s3cr3t@host/path"],
    ["basic_auth_encoded", "Basic dXNlcm5hbWU6cGFzc3dvcmQxMjM="],
    ["provider_query_secret", "GET /api/postbacks/pocket?goal=dep&ow=liveSecretValue"],
    ["private_key", "-----BEGIN PRIVATE KEY-----"],
    ["email_address", "learner.name@gmail.com"],
  ])("detects %s", (secretClass, line) => {
    const root = pkg({ "evidence.md": line });

    const result = scanTree(root);

    expect(result.findings.map((f) => f.secretClass)).toContain(secretClass);
  });

  it("does not fire on the placeholders an audit package legitimately contains", () => {
    const root = pkg({
      "00.md": [
        "password: <redacted>",
        "PASSWORD  displayed once in the terminal; not stored anywhere",
        "login: preprod-crm-admin@ata.invalid",
        "contact: someone@example.com",
        "POCKET_AFFILIATE_BASE_URL=https://host/register?code=REPLACE_CODE",
        "secret: xxxxxxxx",
        "token: ****",
      ].join("\n"),
    });

    const result = scanTree(root);

    expect(result.findings).toHaveLength(0);
  });

  it("does not fire on the digests and build ids every package is full of", () => {
    const root = pkg({
      "identities.md": [
        "backend release 7df71be5a68085831bed58c3f8a69d344a68cbd7",
        "BUILD_ID BG3SPR8-E_GtznIS0unKF",
        "database sha256 e765f7d8af29a448ea77cd0bca61599caf4f4652357727046d966b0287d28463",
        "tree b4aadef1931f6f7fdf7e28fd4984f958de14eb11",
      ].join("\n"),
    });

    const result = scanTree(root);

    expect(result.findings).toHaveLength(0);
  });

  it("reports location and class, and counts what it did not read", () => {
    const root = pkg({ "a.md": "clean", "b.png": "binary-ish", "sub/c.json": '{"ok":true}' });

    const result = scanTree(root);
    const report = formatReport(result);

    expect(result.filesScanned).toBe(2);
    expect(result.filesSkippedBinary).toBe(1);
    expect(report).toContain("symlinks NOT followed 0");
    expect(report).toContain("RESULT: 0 findings");
  });
});

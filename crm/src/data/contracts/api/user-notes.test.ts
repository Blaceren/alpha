import { describe, expect, it } from "vitest";
import {
  countCodePoints,
  crmApiUserNoteCreatedSchema,
  crmApiUserNotesErrorSchema,
  crmApiUserNotesPageSchema,
  crmApiUserNoteSchema,
  NOTE_BODY_MAX_CODE_POINTS,
  validateNoteBody,
} from "./user-notes";

const note = (over: Record<string, unknown> = {}) => ({
  noteId: "note_1",
  body: "Позвонил клиенту",
  authorDisplayName: "Нина Ч.",
  createdAt: "2026-07-20T18:42:00.000Z",
  ...over,
});

describe("note item schema", () => {
  it("accepts a valid note", () => {
    expect(crmApiUserNoteSchema.safeParse(note()).success).toBe(true);
  });

  it("accepts a multiline body and preserves it exactly", () => {
    const parsed = crmApiUserNoteSchema.safeParse(note({ body: "строка1\nстрока2\tтаб" }));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.body).toBe("строка1\nстрока2\tтаб");
  });

  it("keeps HTML-looking text as text", () => {
    const raw = "<script>alert(1)</script> **bold**";
    const parsed = crmApiUserNoteSchema.safeParse(note({ body: raw }));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.body).toBe(raw);
  });

  it.each([
    ["empty noteId", { noteId: "" }],
    ["empty body", { body: "" }],
    ["blank authorDisplayName", { authorDisplayName: "   " }],
    ["invalid datetime", { createdAt: "20.07.2026" }],
    ["non-string body", { body: 42 }],
  ])("rejects %s", (_label, over) => {
    expect(crmApiUserNoteSchema.safeParse(note(over)).success).toBe(false);
  });

  it.each([
    "employeeId",
    "authorId",
    "email",
    "authorEmail",
    "role",
    "staffRole",
    "permissions",
    "effectivePermissions",
    "userId",
    "updatedAt",
    "deletedAt",
    "visibility",
    "pinned",
    "caseId",
    "capabilities",
    "auditId",
    "mock",
  ])("rejects a forbidden extra field: %s", (field) => {
    expect(crmApiUserNoteSchema.safeParse(note({ [field]: "x" })).success).toBe(false);
  });
});

describe("list schema", () => {
  it("accepts a populated page", () => {
    expect(
      crmApiUserNotesPageSchema.safeParse({ items: [note()], nextCursor: "abc" }).success,
    ).toBe(true);
  });

  it("accepts an empty page with a null cursor", () => {
    expect(crmApiUserNotesPageSchema.safeParse({ items: [], nextCursor: null }).success).toBe(true);
  });

  it.each([
    ["numeric nextCursor", { items: [], nextCursor: 5 }],
    ["empty-string nextCursor", { items: [], nextCursor: "" }],
    ["missing nextCursor", { items: [] }],
    ["items not an array", { items: note(), nextCursor: null }],
    ["extra key", { items: [], nextCursor: null, total: 3 }],
  ])("rejects %s", (_label, payload) => {
    expect(crmApiUserNotesPageSchema.safeParse(payload).success).toBe(false);
  });

  it("rejects a page whose item carries a forbidden field", () => {
    expect(
      crmApiUserNotesPageSchema.safeParse({
        items: [note({ employeeId: "emp_1" })],
        nextCursor: null,
      }).success,
    ).toBe(false);
  });
});

describe("create response schema", () => {
  it("accepts the created note", () => {
    expect(crmApiUserNoteCreatedSchema.safeParse(note()).success).toBe(true);
  });

  it("rejects an enveloped create response", () => {
    expect(crmApiUserNoteCreatedSchema.safeParse({ note: note() }).success).toBe(false);
  });
});

describe("error envelope schema", () => {
  it.each(["invalid_input", "unauthorized", "not_found", "internal"])("accepts %s", (code) => {
    expect(
      crmApiUserNotesErrorSchema.safeParse({ code, messageKey: "k", requestId: "r" }).success,
    ).toBe(true);
  });

  it("rejects an unknown code and extra keys", () => {
    expect(
      crmApiUserNotesErrorSchema.safeParse({ code: "teapot", messageKey: "k", requestId: "r" })
        .success,
    ).toBe(false);
    expect(
      crmApiUserNotesErrorSchema.safeParse({
        code: "internal",
        messageKey: "k",
        requestId: "r",
        stack: "…",
      }).success,
    ).toBe(false);
  });
});

describe("code-point counter", () => {
  it("counts ASCII by character", () => {
    expect(countCodePoints("hello")).toBe(5);
  });

  it("counts an astral emoji as one, not two UTF-16 units", () => {
    expect("\u{1F600}".length).toBe(2);
    expect(countCodePoints("\u{1F600}")).toBe(1);
    expect(countCodePoints("\u{1F600}\u{1F600}")).toBe(2);
  });

  it("counts Cyrillic correctly", () => {
    expect(countCodePoints("Заметка")).toBe(7);
  });
});

describe("body validation", () => {
  it("trims surrounding whitespace", () => {
    expect(validateNoteBody("   текст   ")).toEqual({ ok: true, body: "текст" });
    expect(validateNoteBody("\n\n текст \n")).toEqual({ ok: true, body: "текст" });
  });

  it("normalizes CRLF and lone CR to LF", () => {
    expect(validateNoteBody("a\r\nb")).toEqual({ ok: true, body: "a\nb" });
    expect(validateNoteBody("a\rb")).toEqual({ ok: true, body: "a\nb" });
  });

  it("preserves internal newlines, tabs and spaces", () => {
    expect(validateNoteBody("a\n\nb\tc  d")).toEqual({ ok: true, body: "a\n\nb\tc  d" });
  });

  it("accepts Unicode and astral characters", () => {
    expect(validateNoteBody("Заметка \u{1F600}")).toEqual({ ok: true, body: "Заметка \u{1F600}" });
  });

  it.each(["", "   ", "\n\n", "\t", "\r\n"])("rejects a blank body: %j", (raw) => {
    expect(validateNoteBody(raw)).toEqual({ ok: false, reason: "blank" });
  });

  it("accepts exactly 2000 code points and rejects 2001", () => {
    expect(validateNoteBody("a".repeat(NOTE_BODY_MAX_CODE_POINTS)).ok).toBe(true);
    expect(validateNoteBody("a".repeat(NOTE_BODY_MAX_CODE_POINTS + 1))).toEqual({
      ok: false,
      reason: "too_long",
    });
  });

  it("bounds by code points, so 2000 astral emoji are accepted", () => {
    const body = "\u{1F600}".repeat(NOTE_BODY_MAX_CODE_POINTS);
    expect(body.length).toBe(NOTE_BODY_MAX_CODE_POINTS * 2);
    expect(validateNoteBody(body).ok).toBe(true);
    expect(validateNoteBody("\u{1F600}".repeat(NOTE_BODY_MAX_CODE_POINTS + 1)).ok).toBe(false);
  });

  it.each([0x00, 0x07, 0x0b, 0x0c, 0x1b, 0x7f, 0x85])(
    "rejects control character U+%s",
    (cp) => {
      expect(validateNoteBody(`a${String.fromCodePoint(cp)}b`)).toEqual({
        ok: false,
        reason: "control_char",
      });
    },
  );

  it("rejects a non-string", () => {
    expect(validateNoteBody(42)).toEqual({ ok: false, reason: "not_a_string" });
    expect(validateNoteBody(null)).toEqual({ ok: false, reason: "not_a_string" });
  });

  it("never truncates and never strips — it rejects", () => {
    const long = "a".repeat(NOTE_BODY_MAX_CODE_POINTS + 5);
    const result = validateNoteBody(long);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("aaaa");
    // A control character is not silently removed to make the rest valid.
    expect(validateNoteBody(`ok${String.fromCodePoint(0)}text`).ok).toBe(false);
  });

  it("does not interpret HTML or Markdown", () => {
    const raw = "<b>x</b> **y** [z](http://e.test)";
    expect(validateNoteBody(raw)).toEqual({ ok: true, body: raw });
  });
});

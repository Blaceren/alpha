/**
 * TOOLS-V2 — the closed error vocabulary of the tool APIs.
 *
 * The envelope field is `error`, not `code`: the Academy's generic HTTP error
 * reader switches on `body.error`, and a tool error must reach the learner's
 * screen as a named failure rather than as an anonymous category.
 *
 * Never a Zod issue, a Prisma message, a stack or a SQL fragment — a detail is
 * always written by this codebase.
 */
export const TOOL_ERROR_STATUS = {
  TOOL_LOCKED: 403,
  TOOL_VALIDATION: 400,
  TRADE_CARD_NOT_FOUND: 404,
  TRADE_CARD_OPEN_EXISTS: 409,
  TRADE_CARD_STATE_CONFLICT: 409,
  JOURNAL_ENTRY_NOT_FOUND: 404,
  TOOL_RATE_LIMITED: 429,
  TOOL_INTERNAL: 500,
} as const;

export type ToolErrorCode = keyof typeof TOOL_ERROR_STATUS;

export class ToolError extends Error {
  readonly code: ToolErrorCode;
  readonly status: number;
  readonly detail: string | null;

  constructor(code: ToolErrorCode, detail?: string) {
    super(code);
    this.name = "ToolError";
    this.code = code;
    this.status = TOOL_ERROR_STATUS[code];
    this.detail = detail ?? null;
  }
}

export function isToolError(error: unknown): error is ToolError {
  return error instanceof ToolError;
}

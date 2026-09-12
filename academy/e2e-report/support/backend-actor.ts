/**
 * Spec-side wrapper for the protected Backend fixture actor. It shells out to the
 * harness-provided wrapper script (which runs the tsx helper inside the RR-1
 * Backend against the SAME synthetic DB the Academy backend uses). This is the
 * "protected Backend fixture actor" — the mentor review/approve actions and the
 * server-authoritative state checks. It is NOT the Academy learner UI and never
 * runs in the browser.
 */
import { execFileSync } from "node:child_process";
import { ACTOR } from "./config";

export type ActorResult = Record<string, unknown> & { ok: boolean };

export function runActor(action: string, arg?: string): ActorResult {
  if (!ACTOR) throw new Error("CI4_ACTOR wrapper not provided by harness");
  const args = arg === undefined ? [ACTOR, action] : [ACTOR, action, arg];
  const stdout = execFileSync("bash", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  const line = stdout.split("\n").find((l) => l.startsWith("CI4_JSON "));
  if (!line) throw new Error(`actor '${action}' produced no CI4_JSON output`);
  return JSON.parse(line.slice("CI4_JSON ".length)) as ActorResult;
}

export function requestRevision(email: string): ActorResult {
  return runActor("request-revision", email);
}
export function approve(email: string): ActorResult {
  return runActor("approve", email);
}
export function backendState(email: string): ActorResult {
  return runActor("state", email);
}

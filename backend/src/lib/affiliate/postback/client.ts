/**
 * AFFILIATE-PLATFORM-V1 §28/§29 — THE OUTBOUND HTTP OWNER.
 *
 * THIS IS THE ONLY PLACE IN THE BACKEND THAT MAKES AN OUTBOUND REQUEST TO AN
 * ADDRESS A STRANGER CHOSE. Before this phase there was none at all. Every
 * safety property §29 asks for is enforced here, not by the caller, so a future
 * call site cannot obtain a weaker version by passing different arguments.
 *
 * ---------------------------------------------------------------------------
 * WHY `node:https` AND NOT `fetch`
 *
 * Because of one option: `lookup`. The destination guard resolves the hostname,
 * validates EVERY address it returns, and hands back ONE approved address. This
 * client passes a `lookup` that ignores the hostname entirely and returns that
 * exact address. So the address that was checked and the address that is
 * connected to are THE SAME VALUE — not two resolutions of the same name a few
 * milliseconds apart, which is precisely the window DNS rebinding lives in.
 *
 * `fetch` does its own resolution and offers no supported hook for this. Using
 * it would mean validating one thing and connecting to another and calling it
 * protection.
 *
 * TLS STILL VERIFIES THE HOSTNAME. `servername` and the Host header carry the
 * real name, so connecting by address does not weaken certificate validation —
 * a rebinding attacker who wins the race still fails the handshake.
 *
 * ---------------------------------------------------------------------------
 * REDIRECTS ARE FOLLOWED BY HAND
 *
 * `redirect: "follow"` would let a 302 point anywhere, and the guard would
 * never see it. Here each hop is a fresh `resolveDestination` — scheme,
 * credentials, port, host shape, DNS and every address, from scratch — with a
 * hard cap of three hops. A redirect to `http://`, to a private address or to a
 * cloud metadata endpoint is refused at the hop, and the delivery records
 * `blocked_destination`.
 *
 * ---------------------------------------------------------------------------
 * EVERYTHING IS BOUNDED
 *
 * connect 5s · total 10s · 3 redirects · 64 KiB of response body read and then
 * the socket destroyed. A partner endpoint that streams forever, blackholes the
 * connection or answers with a gigabyte cannot hold a worker slot or fill a
 * disk. §28: no unbounded retry storm, and no conversion transaction ever
 * blocked on a slow affiliate endpoint — this owner is never called from one.
 */
import https from "node:https";
import type { LookupAddress } from "node:dns";
import { resolveDestination } from "@/lib/affiliate/postback/destination";

export const POSTBACK_CONNECT_TIMEOUT_MS = 5_000;
export const POSTBACK_TOTAL_TIMEOUT_MS = 10_000;
export const POSTBACK_MAX_REDIRECTS = 3;
export const POSTBACK_MAX_RESPONSE_BYTES = 64 * 1024;
export const POSTBACK_RESPONSE_SNIPPET_MAX = 256;

export type PostbackAttemptOutcome =
  | "delivered"
  | "http_4xx"
  | "http_5xx"
  | "http_other"
  | "timeout"
  | "connect_error"
  | "dns_error"
  | "blocked_destination"
  | "too_many_redirects"
  | "response_too_large";

export type PostbackAttemptResult = {
  readonly outcome: PostbackAttemptOutcome;
  readonly httpStatus: number | null;
  readonly responseSnippet: string | null;
  readonly durationMs: number;
};

/**
 * Reduce a response body to something safe to store.
 *
 * CONTROL CHARACTERS STRIPPED, LENGTH BOUNDED, AND NEVER RENDERED AS HTML by
 * any reader. This is the only value in the platform that a remote server
 * controls end-to-end, so it is treated as hostile text throughout.
 */
export function safeResponseSnippet(body: string): string | null {
  // Every C0 control and DEL collapses to a single space. A stored value with a
  // newline or an ANSI escape in it is a value that can lie to a terminal, a
  // log reader or a CSV export.
  const cleaned = body.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  if (cleaned === "") return null;
  return cleaned.slice(0, POSTBACK_RESPONSE_SNIPPET_MAX);
}

function classifyStatus(status: number): PostbackAttemptOutcome {
  if (status >= 200 && status < 300) return "delivered";
  if (status >= 400 && status < 500) return "http_4xx";
  if (status >= 500 && status < 600) return "http_5xx";
  return "http_other";
}

type SingleHop = {
  status: number;
  location: string | null;
  body: string;
};

/** One request to one approved address. No redirect following happens here. */
async function performHop(
  approved: { url: URL; hostname: string; port: number; address: string; family: 4 | 6 },
  headers: Record<string, string>,
  remainingMs: number,
): Promise<SingleHop> {
  return new Promise<SingleHop>((resolve, reject) => {
    const request = https.request(
      {
        protocol: "https:",
        // CONNECT TO THE APPROVED ADDRESS. `lookup` never consults DNS: it
        // returns the one value the guard already validated.
        //
        // PBDELIV-1 — IT MUST ANSWER IN THE SHAPE `net` ASKED FOR.
        //
        // Node's `net.Socket.connect` calls this shim with `{ all: true }` (Node
        // 20+; measured as `{"hints":32,"all":true}` on the Node 22.14 this
        // deployment runs). With `all` set, Node reads `addresses[0].address`
        // from the second argument. The previous implementation always called
        // back with a bare string, so Node read `undefined` and every single
        // delivery died with `ERR_INVALID_IP_ADDRESS` — classified as
        // `connect_error`, retried six times, and then marked terminal.
        //
        // THE EFFECT WAS TOTAL AND SILENT: no partner postback could reach ANY
        // destination, while the ledger recorded plausible-looking transport
        // failures. It survived because the destination guard has thorough tests
        // and the socket layer had none — the guard was proving the right
        // address was chosen, and nothing was proving it was ever dialled.
        //
        // Both shapes are honoured, so this does not depend on a Node version
        // continuing to behave one way. The SECURITY PROPERTY IS UNCHANGED:
        // exactly one address is ever returned, and it is the approved one.
        host: approved.hostname,
        lookup: (
          _hostname: string,
          options: { all?: boolean } | undefined,
          callback: (
            err: NodeJS.ErrnoException | null,
            address: string | LookupAddress[],
            family?: number,
          ) => void,
        ) => {
          if (options?.all === true) {
            callback(null, [{ address: approved.address, family: approved.family }]);
            return;
          }
          callback(null, approved.address, approved.family);
        },
        // TLS still validates the certificate against the real hostname.
        servername: approved.hostname,
        port: approved.port,
        path: `${approved.url.pathname}${approved.url.search}`,
        method: "GET",
        headers: { ...headers, Host: approved.url.host },
        timeout: Math.min(POSTBACK_CONNECT_TIMEOUT_MS, remainingMs),
      },
      (response) => {
        const chunks: Buffer[] = [];
        let total = 0;
        let aborted = false;

        response.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > POSTBACK_MAX_RESPONSE_BYTES) {
            // A response larger than the bound is not read further. The socket
            // is destroyed rather than drained: draining is what an endpoint
            // that wants to hold a worker slot is counting on.
            aborted = true;
            response.destroy();
            request.destroy();
            reject(Object.assign(new Error("response_too_large"), { ataOutcome: "response_too_large" }));
            return;
          }
          chunks.push(chunk);
        });

        response.on("end", () => {
          if (aborted) return;
          const location = response.headers.location;
          resolve({
            status: response.statusCode ?? 0,
            location: typeof location === "string" ? location : null,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });

        response.on("error", (error) => reject(error));
      },
    );

    request.on("timeout", () => {
      request.destroy(Object.assign(new Error("timeout"), { ataOutcome: "timeout" }));
    });
    request.on("error", (error) => reject(error));
    request.end();
  });
}

function classifyTransportError(error: unknown): PostbackAttemptOutcome {
  const tagged = (error as { ataOutcome?: PostbackAttemptOutcome }).ataOutcome;
  if (tagged !== undefined) return tagged;
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") return "timeout";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "dns_error";
  return "connect_error";
}

/**
 * Deliver one postback.
 *
 * IT NEVER THROWS. Every failure is a bounded outcome, because the caller
 * writes it into an attempt row and a thrown Prisma-or-socket error carrying a
 * remote hostname is exactly the value that must not reach a log line.
 */
export async function deliverPostback(
  requestUrl: string,
  headers: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PostbackAttemptResult> {
  const startedAt = Date.now();
  let currentUrl = requestUrl;

  for (let hop = 0; hop <= POSTBACK_MAX_REDIRECTS; hop += 1) {
    const elapsed = Date.now() - startedAt;
    const remaining = POSTBACK_TOTAL_TIMEOUT_MS - elapsed;
    if (remaining <= 0) {
      return { outcome: "timeout", httpStatus: null, responseSnippet: null, durationMs: elapsed };
    }

    // EVERY HOP IS REVALIDATED FROM SCRATCH. The first one is not special and
    // the third one is not trusted because the first passed.
    const guard = await resolveDestination(currentUrl, env);
    if (!guard.ok) {
      return {
        outcome: guard.reason === "unresolvable" ? "dns_error" : "blocked_destination",
        httpStatus: null,
        responseSnippet: null,
        durationMs: Date.now() - startedAt,
      };
    }

    let hopResult: SingleHop;
    try {
      hopResult = await performHop(
        guard.destination,
        headers,
        POSTBACK_TOTAL_TIMEOUT_MS - (Date.now() - startedAt),
      );
    } catch (error) {
      return {
        outcome: classifyTransportError(error),
        httpStatus: null,
        responseSnippet: null,
        durationMs: Date.now() - startedAt,
      };
    }

    const isRedirect = [301, 302, 303, 307, 308].includes(hopResult.status);
    if (!isRedirect || hopResult.location === null) {
      return {
        outcome: classifyStatus(hopResult.status),
        httpStatus: hopResult.status,
        responseSnippet: safeResponseSnippet(hopResult.body),
        durationMs: Date.now() - startedAt,
      };
    }

    // A relative Location is resolved against the CURRENT hop, then revalidated
    // like any other destination at the top of the next iteration.
    try {
      currentUrl = new URL(hopResult.location, currentUrl).toString();
    } catch {
      return {
        outcome: "blocked_destination",
        httpStatus: hopResult.status,
        responseSnippet: null,
        durationMs: Date.now() - startedAt,
      };
    }
  }

  return {
    outcome: "too_many_redirects",
    httpStatus: null,
    responseSnippet: null,
    durationMs: Date.now() - startedAt,
  };
}

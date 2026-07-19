import net from "node:net";
import { isReportAttachmentTestBackendEnabled } from "@/lib/env";

// Antivirus boundary for V2 report attachments. Production scanning is
// mandatory: an unavailable, timed-out or protocol-broken scanner is a
// retryable failure and the file stays private and non-available (fail
// closed). There is no production no-scan mode.

export const REPORT_ATTACHMENT_SCAN_TIMEOUT_MS = 30_000;

const INSTREAM_CHUNK_BYTES = 64 * 1024;

export class ReportAttachmentScannerError extends Error {
  readonly retryable = true;

  constructor(message: string) {
    // Raw scanner responses, hosts and sockets never leak through this error.
    super(message);
    this.name = "ReportAttachmentScannerError";
  }
}

export function isReportAttachmentScannerError(error: unknown): error is ReportAttachmentScannerError {
  return error instanceof ReportAttachmentScannerError;
}

export type ReportAttachmentScanVerdict = {
  verdict: "clean" | "infected";
  provider: string;
  /** Safe opaque outcome token; never the raw scanner response. */
  reference: string;
};

export type ReportAttachmentScanner = {
  readonly id: string;
  scan(input: { bytes: Uint8Array }): Promise<ReportAttachmentScanVerdict>;
};

type ClamAvConfig = {
  host: string;
  port: number;
  timeoutMs?: number;
};

// ClamAV clamd INSTREAM adapter (documented wire protocol over TCP):
// "zINSTREAM\0" followed by <4-byte big-endian length><chunk> frames and a
// zero-length terminator; clamd answers "stream: OK" or "stream: <sig> FOUND".
export function createClamAvReportAttachmentScanner(config: ClamAvConfig): ReportAttachmentScanner {
  const timeoutMs = config.timeoutMs ?? REPORT_ATTACHMENT_SCAN_TIMEOUT_MS;
  return {
    id: "clamav-instream",
    scan({ bytes }) {
      return new Promise<ReportAttachmentScanVerdict>((resolve, reject) => {
        const socket = net.connect({ host: config.host, port: config.port });
        const response: Buffer[] = [];
        let settled = false;

        const finish = (result: ReportAttachmentScanVerdict | ReportAttachmentScannerError) => {
          if (settled) return;
          settled = true;
          socket.destroy();
          if (result instanceof ReportAttachmentScannerError) reject(result);
          else resolve(result);
        };

        socket.setTimeout(timeoutMs, () => finish(new ReportAttachmentScannerError("report attachment scan timed out")));
        socket.on("error", () => finish(new ReportAttachmentScannerError("report attachment scanner is unavailable")));
        socket.on("connect", () => {
          try {
            socket.write("zINSTREAM\0");
            for (let offset = 0; offset < bytes.byteLength; offset += INSTREAM_CHUNK_BYTES) {
              const chunk = bytes.subarray(offset, Math.min(offset + INSTREAM_CHUNK_BYTES, bytes.byteLength));
              const frame = Buffer.alloc(4);
              frame.writeUInt32BE(chunk.byteLength, 0);
              socket.write(frame);
              socket.write(chunk);
            }
            const terminator = Buffer.alloc(4);
            terminator.writeUInt32BE(0, 0);
            socket.write(terminator);
          } catch {
            finish(new ReportAttachmentScannerError("report attachment scanner is unavailable"));
          }
        });
        socket.on("data", (data) => response.push(data));
        socket.on("close", () => {
          const text = Buffer.concat(response).toString("utf8").replaceAll("\0", "").trim();
          if (/\bOK$/.test(text)) {
            finish({ verdict: "clean", provider: "clamav-instream", reference: "verdict:clean" });
            return;
          }
          if (/\bFOUND$/.test(text)) {
            // The signature name is scanner response data and must not leave
            // this adapter; only the safe verdict token is surfaced.
            finish({ verdict: "infected", provider: "clamav-instream", reference: "verdict:infected" });
            return;
          }
          finish(new ReportAttachmentScannerError("report attachment scanner returned an unexpected result"));
        });
      });
    },
  };
}

export type DeterministicScannerMode = "by-marker" | "infected" | "unavailable" | "timeout";

export type DeterministicReportAttachmentScanner = ReportAttachmentScanner & {
  /** Mutable per-test behavior switch. */
  state: { mode: DeterministicScannerMode };
  readonly scanned: Array<number>;
};

export const DETERMINISTIC_INFECTED_MARKER = "ATA-TEST-INFECTED-MARKER";
export const DETERMINISTIC_UNAVAILABLE_MARKER = "ATA-TEST-SCANNER-UNAVAILABLE-MARKER";

// Injected deterministic scanner for regression tests; a real ClamAV endpoint
// is never contacted from tests.
export function createDeterministicReportAttachmentScanner(): DeterministicReportAttachmentScanner {
  const state = { mode: "by-marker" as DeterministicScannerMode };
  const scanned: number[] = [];
  return {
    id: "deterministic-test",
    state,
    scanned,
    async scan({ bytes }) {
      scanned.push(bytes.byteLength);
      if (state.mode === "unavailable") throw new ReportAttachmentScannerError("report attachment scanner is unavailable");
      if (state.mode === "timeout") throw new ReportAttachmentScannerError("report attachment scan timed out");
      if (state.mode === "by-marker" && Buffer.from(bytes).includes(DETERMINISTIC_UNAVAILABLE_MARKER)) {
        throw new ReportAttachmentScannerError("report attachment scanner is unavailable");
      }
      const infected = state.mode === "infected" ||
        (state.mode === "by-marker" && Buffer.from(bytes).includes(DETERMINISTIC_INFECTED_MARKER));
      return infected
        ? { verdict: "infected", provider: "deterministic-test", reference: "verdict:infected" }
        : { verdict: "clean", provider: "deterministic-test", reference: "verdict:clean" };
    },
  };
}

let regressionScanner: DeterministicReportAttachmentScanner | null = null;

// Production scanner resolution from server-side env. Absent configuration is
// a retryable unavailable scanner: scanning is mandatory and fail closed.
export function getReportAttachmentScanner(env: NodeJS.ProcessEnv = process.env): ReportAttachmentScanner {
  if (isReportAttachmentTestBackendEnabled(env)) {
    // Guarded regression-only backend: never reachable in production (see
    // isReportAttachmentTestBackendEnabled) and never contacts a real clamd.
    if (!regressionScanner) regressionScanner = createDeterministicReportAttachmentScanner();
    return regressionScanner;
  }
  const host = env.REPORT_ATTACHMENT_CLAMAV_HOST?.trim();
  const port = Number(env.REPORT_ATTACHMENT_CLAMAV_PORT ?? "3310");
  if (!host || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ReportAttachmentScannerError("report attachment scanner is not configured");
  }
  return createClamAvReportAttachmentScanner({ host, port });
}

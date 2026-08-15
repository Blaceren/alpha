/**
 * PBDELIV-1 — the outbound delivery client must actually DIAL the address the
 * destination guard approved.
 *
 * THE DEFECT THIS LOCKS. `performHop` passes a custom `lookup` to
 * `https.request` so the socket connects to the one address the SSRF guard
 * validated, never to a second DNS answer. Node's `net.Socket.connect` calls
 * that shim with `{ all: true }` — measured as `{"hints":32,"all":true}` on Node
 * 22.14 — and with `all` set it reads `addresses[0].address`. The shim always
 * called back with a bare string, so Node read `undefined` and threw
 * `ERR_INVALID_IP_ADDRESS`.
 *
 * Every delivery therefore failed with `connect_error`, was retried six times
 * and went terminal. No partner postback could reach ANY destination, and the
 * ledger recorded ordinary-looking transport failures the whole time.
 *
 * WHY IT SURVIVED, AND WHAT THAT IMPLIES FOR THIS TEST. The destination guard is
 * heavily tested and the socket layer was not: the suite proved the right
 * address was CHOSEN and nothing proved it was ever DIALLED. So this test asserts
 * the callback contract in BOTH shapes rather than asserting a delivery outcome
 * — the contract is the thing that broke.
 */
import { describe, expect, it } from "vitest";
import https from "node:https";
import { deliverPostback } from "./client";

type LookupShim = (
  hostname: string,
  options: { all?: boolean } | undefined,
  callback: (err: NodeJS.ErrnoException | null, address: unknown, family?: number) => void,
) => void;

/**
 * Capture the `lookup` the client hands to `https.request`, without opening a
 * socket. Stubbing at the module boundary keeps this a unit test: no network,
 * no receiver, no timing.
 */
function captureLookup(url: string): Promise<LookupShim> {
  return new Promise((resolve, reject) => {
    const original = https.request;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (https as any).request = (options: any) => {
      (https as unknown as { request: typeof original }).request = original;
      resolve(options.lookup as LookupShim);
      // A request object that never completes; the caller's promise is
      // abandoned deliberately and the test does not await it.
      return {
        on() {
          return this;
        },
        end() {},
        destroy() {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
    };
    void deliverPostback(url, {}, {
      ...process.env,
      ATA_ENVIRONMENT: "staging",
      AFFILIATE_POSTBACK_TEST_HOST_ALLOW: "preprod.alfatrade.media:9443",
    }).catch(reject);
  });
}

describe("postback delivery lookup shim", () => {
  it("answers with an ARRAY when net asks for all — the shape Node 20+ actually uses", async () => {
    const lookup = await captureLookup("https://preprod.alfatrade.media:9443/cb");
    const answer = await new Promise<{ address: unknown; family?: number }>((resolve) => {
      lookup("preprod.alfatrade.media", { all: true }, (_e, address, family) =>
        resolve({ address, family }),
      );
    });

    expect(Array.isArray(answer.address)).toBe(true);
    const list = answer.address as Array<{ address: string; family: number }>;
    // EXACTLY ONE. The whole point of the shim is that a second address can
    // never appear, so this asserts the security property too.
    expect(list).toHaveLength(1);
    expect(list[0].address).toBe("127.0.0.1");
    expect(list[0].family).toBe(4);
    // The regression in one line: a bare string here is what Node read as
    // `undefined`, and it is what shipped.
    expect(typeof answer.address).not.toBe("string");
  });

  it("still answers with a bare string when net does not ask for all", async () => {
    const lookup = await captureLookup("https://preprod.alfatrade.media:9443/cb");
    const answer = await new Promise<{ address: unknown; family?: number }>((resolve) => {
      lookup("preprod.alfatrade.media", undefined, (_e, address, family) =>
        resolve({ address, family }),
      );
    });

    expect(answer.address).toBe("127.0.0.1");
    expect(answer.family).toBe(4);
  });

  it("never consults DNS: the hostname it is handed is ignored entirely", async () => {
    const lookup = await captureLookup("https://preprod.alfatrade.media:9443/cb");
    const answer = await new Promise<unknown>((resolve) => {
      // A hostile hostname. The shim must still answer with the approved
      // address, because it does not resolve anything.
      lookup("attacker.example.com", { all: true }, (_e, address) => resolve(address));
    });
    expect(answer).toEqual([{ address: "127.0.0.1", family: 4 }]);
  });
});

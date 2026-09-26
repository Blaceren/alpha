/**
 * PREPROD ACTIVATION AUTHORIZATION — which machine is this.
 *
 * WHY NOT HOSTNAME. A hostname is a label an operator can set, a container can
 * inherit and a restored VM can duplicate. The failure this binding exists to
 * catch is "the reviewed manifest was carried to a different box", and two boxes
 * sharing a hostname is exactly how that happens unnoticed. `/etc/machine-id` is
 * generated once per installation and survives renames, so it answers the
 * question the manifest is actually asking.
 *
 * Hostname is still recorded, as a diagnostic. It makes a refusal readable
 * without making it decidable.
 *
 * NOT A SECRET. `/etc/machine-id` is world-readable by design on systemd hosts.
 * It is nonetheless hashed before it enters a manifest, because a manifest is an
 * evidence artifact that gets read in reports and a raw machine id is a stable
 * cross-service correlator we have no reason to publish. The hash is just as
 * good at answering "same machine?" and worse at everything else.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";

import { PreprodActivationError } from "./errors";

export type HostIdentity = {
  /** sha256 of the raw machine id. Stable per installation. */
  machineIdSha256: string;
  /** Diagnostic only — never compared. */
  hostname: string;
};

/**
 * Injectable so the regression suite can present a second, different machine
 * without touching `/etc`. Production callers pass nothing and read the host.
 */
export type HostIdentityProvider = () => HostIdentity;

export const MACHINE_ID_PATHS: readonly string[] = ["/etc/machine-id", "/var/lib/dbus/machine-id"];

export function hashMachineId(raw: string): string {
  return crypto.createHash("sha256").update(raw.trim()).digest("hex");
}

/**
 * Read this host's identity.
 *
 * A machine with no readable machine id cannot be pinned, and an activation that
 * cannot say which machine it is running on is not one we permit: the refusal is
 * the point, not an inconvenience to work around.
 */
export function readHostIdentity(): HostIdentity {
  for (const candidate of MACHINE_ID_PATHS) {
    let raw: string;
    try {
      raw = fs.readFileSync(candidate, "utf8");
    } catch {
      continue;
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    return { machineIdSha256: hashMachineId(trimmed), hostname: os.hostname() };
  }
  throw new PreprodActivationError(
    "HOST_MISMATCH",
    `no readable machine identity: none of ${MACHINE_ID_PATHS.join(", ")} yielded a value, so this host cannot be pinned`,
  );
}

/** Refuse a manifest prepared for a different installation. */
export function assertHostMatches(expectedMachineIdSha256: string, actual: HostIdentity): void {
  if (expectedMachineIdSha256 === actual.machineIdSha256) return;
  throw new PreprodActivationError(
    "HOST_MISMATCH",
    `this manifest was prepared for a different machine (running on ${actual.hostname}); refusing to activate here`,
    { expected: expectedMachineIdSha256, actual: actual.machineIdSha256 },
  );
}

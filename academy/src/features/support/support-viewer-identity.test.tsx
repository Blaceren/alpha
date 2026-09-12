/**
 * SUPPORT-VIEWER-IDENTITY-1 — the shell names whoever is signed in.
 *
 * On the live release the same authenticated learner read their own name in the
 * shell on /tools and a fixture name on /support, because this route passed a
 * hardcoded one. These cases hold the route to the viewer the server already
 * knows about, and prove the two surfaces agree.
 *
 * NO NEW ENDPOINT AND NO NEW SESSION BEHAVIOUR: the viewer comes from
 * `getServerViewer`, which Tools, Profile and Notifications already call.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const getServerViewer = vi.fn();
vi.mock("@/server/auth/server-session", () => ({ getServerViewer: () => getServerViewer() }));
vi.mock("@/lib/support/support-client", () => ({
  listSupportCases: vi.fn(async () => ({ ok: true, data: [] })),
  getSupportCase: vi.fn(), openSupportCase: vi.fn(), replyToSupportCase: vi.fn(),
}));
vi.mock("@/lib/curriculum/provider", () => ({ getCurriculumView: vi.fn(async () => ({ ok: false, error: {} })) }));
vi.mock("@/config/academy-config", () => ({ getAcademyConfig: () => ({ mode: "api" }) }));
vi.mock("@/components/shell/unread-presence", () => ({ UnreadPresence: () => null }));

import SupportPage from "@/app/(app)/support/page";
import ToolsPage from "@/app/(app)/tools/page";

const ROOT = process.cwd();
const ROUTE = readFileSync(join(ROOT, "src/app/(app)/support/page.tsx"), "utf8");

/** The name the shell exposes, taken from the profile control's accessible name. */
function shellName(container: HTMLElement): string {
  const profile = container.querySelector('[href="/profile"], a[aria-label*="Профиль"], [data-testid*="profile"]');
  const label = profile?.getAttribute("aria-label") ?? profile?.textContent ?? "";
  return label.trim();
}

beforeEach(() => getServerViewer.mockReset());

describe("the Support route", () => {
  it("carries no hardcoded name at all", () => {
    expect(ROUTE).not.toContain("Артём");
    expect(ROUTE).toContain("getServerViewer");
    expect(ROUTE).toContain('viewer?.name ?? "Ученик"');
  });

  it("asks for the viewer through the existing server session, and nothing else", () => {
    // No new endpoint, no client fetch, no session handling of its own.
    expect(ROUTE).not.toMatch(/fetch\(/);
    expect(ROUTE).not.toMatch(/\/api\//);
    expect(ROUTE).toContain('from "@/server/auth/server-session"');
  });

  it("puts the viewer's name in the shell", async () => {
    getServerViewer.mockResolvedValue({ name: "atalerntest" });
    const { container } = render(await SupportPage());
    expect(shellName(container)).toContain("atalerntest");
    expect(container.textContent).not.toContain("Артём");
  });

  it("changes when the viewer changes — the name is read, not coincidence", async () => {
    getServerViewer.mockResolvedValue({ name: "Синтетик Первый" });
    const first = render(await SupportPage());
    expect(shellName(first.container)).toContain("Синтетик Первый");
    first.unmount();

    getServerViewer.mockResolvedValue({ name: "Синтетик Второй" });
    const second = render(await SupportPage());
    expect(shellName(second.container)).toContain("Синтетик Второй");
    expect(shellName(second.container)).not.toContain("Первый");
  });

  it("names nobody when there is no viewer, and leaks nothing", async () => {
    getServerViewer.mockResolvedValue(null);
    const { container } = render(await SupportPage());
    // The same neutral fallback Tools, Profile and Notifications use.
    expect(shellName(container)).toContain("Ученик");
    expect(container.textContent).not.toContain("atalerntest");
  });

  it("keeps Support as the one current destination", async () => {
    getServerViewer.mockResolvedValue({ name: "atalerntest" });
    const { container } = render(await SupportPage());
    const current = [...container.querySelectorAll("[aria-current]")].filter(
      (el) => el.getAttribute("aria-current") !== "false",
    );
    expect(current.length).toBeGreaterThan(0);
    for (const el of current) {
      expect((el.textContent ?? "") + (el.getAttribute("aria-label") ?? "")).toMatch(/Поддержка|Ещё/);
    }
  });

  it("does not bring Community back into the shell", async () => {
    getServerViewer.mockResolvedValue({ name: "atalerntest" });
    const { container } = render(await SupportPage());
    expect(container.querySelector('[href="/community"]')).toBeNull();
    expect(container.textContent).not.toContain("Сообщество");
  });
});

/**
 * THE PROOF THE TWO SURFACES AGREE.
 *
 * One synthetic session, rendered through both routes: the shell has to name
 * the same person on each. This is the case that would have caught the defect.
 */
describe("one session, two surfaces", () => {
  it("shows the same profile name on /tools and /support", async () => {
    getServerViewer.mockResolvedValue({ name: "atalerntest" });

    const support = render(await SupportPage());
    const supportName = shellName(support.container);
    support.unmount();

    const tools = render(await ToolsPage({ searchParams: Promise.resolve({}) }));
    const toolsName = shellName(tools.container);
    tools.unmount();

    expect(supportName).toContain("atalerntest");
    expect(supportName).toBe(toolsName);
  });

  it("still agrees when the viewer read fails on both", async () => {
    getServerViewer.mockResolvedValue(null);
    const support = render(await SupportPage());
    const a = shellName(support.container);
    support.unmount();
    const tools = render(await ToolsPage({ searchParams: Promise.resolve({}) }));
    const b = shellName(tools.container);
    tools.unmount();
    expect(a).toBe(b);
    expect(a).toContain("Ученик");
  });
});

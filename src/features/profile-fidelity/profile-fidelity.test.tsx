/**
 * PROFILE — fidelity, the state machine, and the rules that protect identity.
 *
 * The composition tests are ordinary. The ones worth reading are about what the
 * page is allowed to claim: the identity never moves until the server confirms
 * it, a failed save keeps the learner's draft, a whitespace-only change is not
 * a change, and the value that becomes canonical is the SERVER'S — not the one
 * that was typed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfileFidelity } from "@/features/profile-fidelity/profile-fidelity";
import {
  COPY,
  NAME_MAX,
  NAME_MIN,
  cancel,
  editDraft,
  initial,
  isDirty,
  isEditing,
  openEdit,
  save,
  saveConfirmed,
  saveFailed,
  validate,
} from "@/features/profile-fidelity/profile-state";

const saveProfileName = vi.fn();
vi.mock("@/lib/profile/profile-client", () => ({
  saveProfileName: (...args: unknown[]) => saveProfileName(...args),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const SRC = (f: string) =>
  readFileSync(join(process.cwd(), "src/features/profile-fidelity", f), "utf8");
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

beforeEach(() => {
  saveProfileName.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------ state machine */

describe("Profile — the state machine", () => {
  it("opens on the server's value, and a null read is a page failure", () => {
    expect(initial("Мария").mode).toBe("VIEW");
    expect(initial(null).mode).toBe("PAGEFAIL");
    expect(initial(null).canonical).toBeNull();
  });

  it("treats a whitespace-only difference as clean, because trimming removes it", () => {
    const editing = openEdit(initial("Мария"));
    expect(isDirty(editing)).toBe(false);
    expect(isDirty(editDraft(editing, "  Мария  "))).toBe(false);
    expect(isDirty(editDraft(editing, "Мария К"))).toBe(true);
  });

  it("never calls VIEW or PAGEFAIL dirty, whatever the draft says", () => {
    expect(isDirty({ ...initial("Мария"), draft: "что-то другое" })).toBe(false);
    expect(isDirty({ ...initial(null), draft: "что-то другое" })).toBe(false);
  });

  it("counts submitting and both failures as still editing", () => {
    expect(isEditing("EDITING")).toBe(true);
    expect(isEditing("SUBMITTING")).toBe(true);
    expect(isEditing("INVALID")).toBe(true);
    expect(isEditing("FAILED")).toBe(true);
    expect(isEditing("VIEW")).toBe(false);
    expect(isEditing("PAGEFAIL")).toBe(false);
  });

  it("validates only what the Backend schema validates", () => {
    expect(validate("Я")).toBe("error_short");
    expect(validate("  Я  ")).toBe("error_short");
    expect(validate("Яр")).toBeNull();
    expect(validate("и".repeat(NAME_MAX))).toBeNull();
    expect(NAME_MIN).toBe(2);
    expect(NAME_MAX).toBe(50);
  });

  it("refuses to submit a second time while one save is in flight", () => {
    const submitting = save(editDraft(openEdit(initial("Мария")), "Мария К")).next;
    expect(submitting.mode).toBe("SUBMITTING");
    const again = save(submitting);
    expect(again.submit).toBe(false);
    expect(again.next).toBe(submitting);
  });

  it("submits the trimmed draft, and only after validation passes", () => {
    const invalid = save(editDraft(openEdit(initial("Мария")), "Я"));
    expect(invalid.submit).toBe(false);
    expect(invalid.next.mode).toBe("INVALID");
    expect(invalid.next.error).toBe("error_short");

    const ok = save(editDraft(openEdit(initial("Мария")), "  Мария К  "));
    expect(ok.submit).toBe(true);
    expect(ok.submit && ok.name).toBe("Мария К");
  });

  it("keeps the draft and the identity untouched when the save fails", () => {
    const submitting = save(editDraft(openEdit(initial("Мария")), "Мария К")).next;
    const failed = saveFailed(submitting);
    expect(failed.mode).toBe("FAILED");
    expect(failed.draft).toBe("Мария К");
    expect(failed.canonical).toBe("Мария");
  });

  it("lets typing clear the failure surface without clearing the attempt", () => {
    const failed = saveFailed(save(editDraft(openEdit(initial("Мария")), "Мария К")).next);
    const typing = editDraft(failed, "Мария Ко");
    expect(typing.mode).toBe("EDITING");
    expect(typing.error).toBeNull();
    expect(typing.draft).toBe("Мария Ко");
  });

  it("makes the SERVER's value canonical, never the draft", () => {
    const submitting = save(editDraft(openEdit(initial("Мария")), "мария к")).next;
    const saved = saveConfirmed(submitting, "Мария К");
    expect(saved.canonical).toBe("Мария К");
    expect(saved.mode).toBe("VIEW");
    expect(saved.draft).toBeNull();
    expect(saved.announce).toBe("Имя сохранено: Мария К.");
  });

  it("throws the draft away on cancel, and nothing else", () => {
    const cancelled = cancel(editDraft(openEdit(initial("Мария")), "Мария К"));
    expect(cancelled.mode).toBe("VIEW");
    expect(cancelled.draft).toBeNull();
    expect(cancelled.canonical).toBe("Мария");
  });
});

/* --------------------------------------------------------------- rendering */

describe("Profile — the frozen composition", () => {
  it("makes the identity the page's h1 in read, and exactly one h1", () => {
    const { container } = render(<ProfileFidelity canonical="Мария Ковалёва" />);
    const h1s = container.querySelectorAll("h1");
    expect(h1s).toHaveLength(1);
    expect(h1s[0]!.className).toContain("p-identity");
    expect(h1s[0]!.textContent).toBe("Мария Ковалёва");
    expect(container.querySelector(".p-coord--page")!.tagName).toBe("P");
    expect(container.querySelector('[data-role="control-locus"]')!.getAttribute("data-open")).toBe("0");
  });

  it("hands the h1 back to the page coordinate once the name is a field value", async () => {
    const { container } = render(<ProfileFidelity canonical="Мария Ковалёва" />);
    await userEvent.click(screen.getByRole("button", { name: COPY.edit }));
    const h1s = container.querySelectorAll("h1");
    expect(h1s).toHaveLength(1);
    expect(h1s[0]!.className).toContain("p-coord--page");
    expect(container.querySelector(".p-identity")).toBeNull();
    expect(container.querySelector('[data-role="control-locus"]')!.getAttribute("data-open")).toBe("1");
  });

  it("keeps the live region mounted in every state, out of the composition", async () => {
    const { container } = render(<ProfileFidelity canonical="Мария" />);
    const region = () => container.querySelector('[data-role="save-status"]');
    expect(region()!.getAttribute("role")).toBe("status");
    expect(region()!.getAttribute("aria-live")).toBe("polite");
    expect(region()!.getAttribute("aria-atomic")).toBe("true");
    expect(region()!.className).toBe("p4-status");
    await userEvent.click(screen.getByRole("button", { name: COPY.edit }));
    expect(region()).not.toBeNull();
  });

  it("opens edit with the caret at the end of the existing value", async () => {
    render(<ProfileFidelity canonical="Мария Ковалёва" />);
    await userEvent.click(screen.getByRole("button", { name: COPY.edit }));
    const input = (await screen.findByLabelText(COPY.identity_label)) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(input.value).toBe("Мария Ковалёва");
    expect(input.selectionStart).toBe(input.value.length);
    expect(input.getAttribute("maxlength")).toBe(String(NAME_MAX));
  });

  it("returns focus to where the learner started when they cancel", async () => {
    render(<ProfileFidelity canonical="Мария" />);
    await userEvent.click(screen.getByRole("button", { name: COPY.edit }));
    await userEvent.click(screen.getByRole("button", { name: COPY.cancel }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: COPY.edit })),
    );
  });

  it("binds a validation failure to the field, never to the page", async () => {
    const { container } = render(<ProfileFidelity canonical="Мария" />);
    await userEvent.click(screen.getByRole("button", { name: COPY.edit }));
    const input = screen.getByLabelText(COPY.identity_label) as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, "Я");
    await userEvent.click(screen.getByRole("button", { name: COPY.save }));

    const error = container.querySelector('[data-role="field-error"]')!;
    expect(error.textContent).toBe(COPY.error_short);
    expect(error.getAttribute("role")).toBe("alert");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toContain("p-field-error");
    expect(container.querySelector('[data-role="page-failure"]')).toBeNull();
    expect(saveProfileName).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it("does not move the identity until the server has confirmed it", async () => {
    let resolveSave: (v: unknown) => void = () => {};
    saveProfileName.mockReturnValue(new Promise((r) => (resolveSave = r)));

    const { container } = render(<ProfileFidelity canonical="Мария" />);
    await userEvent.click(screen.getByRole("button", { name: COPY.edit }));
    const input = screen.getByLabelText(COPY.identity_label) as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, "Мария К");
    await userEvent.click(screen.getByRole("button", { name: COPY.save }));

    /* SUBMITTING is the edit locus with the value held still. */
    const saving = screen.getByRole("button", { name: COPY.saving });
    expect(saving).toHaveProperty("disabled", true);
    expect(saving.getAttribute("aria-busy")).toBe("true");
    expect((screen.getByLabelText(COPY.identity_label) as HTMLInputElement).readOnly).toBe(true);
    expect(container.querySelector(".p-identity")).toBeNull();

    resolveSave({ ok: true, name: "Мария К" });
    await waitFor(() => expect(container.querySelector(".p-identity")).not.toBeNull());
    expect(container.querySelector(".p-identity")!.textContent).toBe("Мария К");
  });

  it("announces the confirmed value and returns focus quietly", async () => {
    saveProfileName.mockResolvedValue({ ok: true, name: "Мария Ковалёва-Штерн" });
    const { container } = render(<ProfileFidelity canonical="Мария" />);
    await userEvent.click(screen.getByRole("button", { name: COPY.edit }));
    await userEvent.type(screen.getByLabelText(COPY.identity_label), "-Штерн");
    await userEvent.click(screen.getByRole("button", { name: COPY.save }));

    await waitFor(() =>
      expect(container.querySelector('[data-role="save-status"]')!.textContent).toBe(
        "Имя сохранено: Мария Ковалёва-Штерн.",
      ),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: COPY.edit })),
    );
  });

  it("takes the server's value even when it differs from what was typed", async () => {
    saveProfileName.mockResolvedValue({ ok: true, name: "Мария К" });
    const { container } = render(<ProfileFidelity canonical="Мария" />);
    await userEvent.click(screen.getByRole("button", { name: COPY.edit }));
    const input = screen.getByLabelText(COPY.identity_label) as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, "мария к");
    await userEvent.click(screen.getByRole("button", { name: COPY.save }));
    await waitFor(() => expect(container.querySelector(".p-identity")).not.toBeNull());
    expect(container.querySelector(".p-identity")!.textContent).toBe("Мария К");
  });

  it("states a failed save at the attempt, keeps the draft, and offers no second retry", async () => {
    saveProfileName.mockResolvedValue({ ok: false, error: { code: "BACKEND_UNAVAILABLE" } });
    const { container } = render(<ProfileFidelity canonical="Мария" />);
    await userEvent.click(screen.getByRole("button", { name: COPY.edit }));
    await userEvent.type(screen.getByLabelText(COPY.identity_label), " К");
    await userEvent.click(screen.getByRole("button", { name: COPY.save }));

    const failure = await waitFor(() => container.querySelector('[data-role="mutation-failure"]')!);
    expect(failure.getAttribute("role")).toBe("alert");
    expect(failure.textContent).toBe(COPY.mutation_failed);
    /* Save above IS the retry — there is never a second control. */
    expect(container.querySelectorAll("button")).toHaveLength(2);
    expect(screen.getByRole("button", { name: COPY.save })).toBeTruthy();
    expect((screen.getByLabelText(COPY.identity_label) as HTMLInputElement).value).toBe("Мария К");
    expect(container.querySelector(".p-identity")).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText(COPY.identity_label)),
    );
  });

  it("shows a page failure as a page alert, with no locus and no identity", () => {
    const { container } = render(<ProfileFidelity canonical={null} />);
    expect(container.querySelector(".p-profile")!.getAttribute("data-mode")).toBe("PAGEFAIL");
    const failure = container.querySelector('[data-role="page-failure"]')!;
    expect(failure.getAttribute("role")).toBe("alert");
    expect(failure.textContent).toContain(COPY.page_failed_lead);
    expect(container.querySelector('[data-role="control-locus"]')).toBeNull();
    expect(container.querySelector(".p-identity")).toBeNull();
    expect(screen.getByRole("button", { name: COPY.page_failed_retry })).toBeTruthy();
    /* Still one h1, and it is the page coordinate. */
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });

  it("keeps the support handoff pointing somewhere real", () => {
    const { container } = render(<ProfileFidelity canonical="Мария" />);
    const link = container.querySelector('[data-role="support-link"]') as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/support");
    expect(container.querySelector('[data-role="consequence"]')!.textContent).toBe(COPY.consequence);
  });
});

/* --------------------------------------------------- the narrow boundary */

describe("Profile — what the page may never become", () => {
  const surface = codeOnly(SRC("profile-fidelity.tsx"));
  const state = codeOnly(SRC("profile-state.ts"));

  it("edits exactly one field", () => {
    expect(surface.match(/<input/g) ?? []).toHaveLength(1);
    for (const field of ["email", "password", "пароль", "телефон", "phone"]) {
      expect(surface.toLowerCase(), field).not.toContain(field);
    }
  });

  it("shows nothing that belongs to another product", () => {
    for (const foreign of ["balance", "баланс", "депозит", "deposit", "affiliate", "партнёр", "Pocket"]) {
      expect(surface, foreign).not.toContain(foreign);
    }
    /* `xp` as a word, not as the middle of `expect` or `export`. */
    expect(surface).not.toMatch(/\bxp\b/i);
  });

  it("never autosaves, never saves on blur, and never guesses the identity", () => {
    expect(surface).not.toContain("onBlur");
    expect(surface).not.toContain("setTimeout");
    expect(state).not.toContain("setTimeout");
    /* The only place canonical is assigned from is the confirmed server value. */
    expect(state.match(/canonical:\s*serverValue/g) ?? []).toHaveLength(1);
    expect(state).not.toMatch(/canonical:\s*state\.draft/);
  });

  it("carries no fixture identity from the prototype", () => {
    for (const fixture of [
      "Мария Ковалёва",
      "Александра Константиновна",
      "Мария Ковалёва-Штерн",
    ]) {
      expect(surface, fixture).not.toContain(fixture);
      expect(state, fixture).not.toContain(fixture);
    }
  });

  it("does not re-create the prototype's shell or its harness", () => {
    expect(surface).not.toContain("<main");
    expect(surface).not.toContain("AcademyShell");
    expect(surface).not.toContain("__ATA_P4");
    expect(surface).not.toContain("qa-diagnostics");
    expect(state).not.toContain("resolve(");
  });

  it("keeps the superseded copy out", () => {
    for (const forbidden of [
      "Имя осталось прежним",
      "Повторить",
      "Поздравляем",
      "Готово!",
      "в верхней панели",
      "сбой чтения",
    ]) {
      expect(state, forbidden).not.toContain(forbidden);
    }
  });
});

/* ------------------------------------------------------------------ styles */

describe("Profile — the stylesheet is scoped and local", () => {
  const css = readFileSync(
    join(process.cwd(), "src/features/profile-fidelity/profile-fidelity.css"),
    "utf8",
  );
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");

  it("makes no remote request", () => {
    expect(bare).not.toContain("@import");
    expect(bare).not.toMatch(/https?:\/\//);
  });

  it("binds both families to the product's local faces", () => {
    expect(bare).toContain('"ATA Manrope"');
    expect(bare).toContain('"ATA IBM Plex Mono"');
    expect(bare).not.toMatch(/"Manrope"/);
    expect(bare).not.toMatch(/"IBM Plex Mono"/);
  });

  it("keeps the :is() focus selector whole rather than splitting it into fragments", () => {
    expect(bare).toContain(".pf .p-profile :is(a, button, input, [tabindex]):focus-visible");
    expect(bare).not.toMatch(/^\s*\[tabindex\]\)/m);
  });

  it("lets no selector escape the .pf namespace", () => {
    const escapees: string[] = [];
    const split = (prelude: string): string[] => {
      const parts: string[] = [];
      let depth = 0;
      let buf = "";
      for (const ch of prelude) {
        if (ch === "(" || ch === "[") depth++;
        else if (ch === ")" || ch === "]") depth--;
        if (ch === "," && depth === 0) {
          parts.push(buf);
          buf = "";
          continue;
        }
        buf += ch;
      }
      parts.push(buf);
      return parts;
    };
    const walk = (block: string) => {
      let i = 0;
      while (i < block.length) {
        const open = block.indexOf("{", i);
        if (open === -1) break;
        const prelude = block.slice(i, open).trim();
        let depth = 1;
        let k = open + 1;
        while (k < block.length && depth > 0) {
          if (block[k] === "{") depth++;
          else if (block[k] === "}") depth--;
          k++;
        }
        const inner = block.slice(open + 1, k - 1);
        if (prelude.startsWith("@")) {
          if (/^@(media|supports)/.test(prelude)) walk(inner);
        } else {
          for (const part of split(prelude)) {
            const s = part.trim();
            if (s && !s.startsWith(".pf") && !s.startsWith("html.pf-root-scope")) escapees.push(s);
          }
        }
        i = k;
      }
    };
    walk(bare);
    expect(escapees).toEqual([]);
  });

  it("keeps the frozen container geometry and the four-layer order", () => {
    expect(bare).toMatch(/\.pf \.p-profile\s*\{[^}]*padding: var\(--p-top\) var\(--p-inset\) var\(--p-bottom\)/);
    expect(bare.indexOf("--p-ground")).toBeLessThan(bare.indexOf(".pf .p-coord"));
  });
});

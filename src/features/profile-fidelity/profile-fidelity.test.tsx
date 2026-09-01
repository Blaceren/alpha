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
const changeProfilePassword = vi.fn();
vi.mock("@/lib/profile/profile-client", () => ({
  saveProfileName: (...args: unknown[]) => saveProfileName(...args),
  changeProfilePassword: (...args: unknown[]) => changeProfilePassword(...args),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const SRC = (f: string) =>
  readFileSync(join(process.cwd(), "src/features/profile-fidelity", f), "utf8");
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

beforeEach(() => {
  saveProfileName.mockReset();
  changeProfilePassword.mockReset();
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
  it("keeps ONE permanent h1 that opening a form does not move", async () => {
    /* This replaces the frozen contract deliberately. The identity used to be
       the h1 in read mode and the word «Профиль» in edit mode, so the page
       heading changed as a side effect of opening a field — which a
       screen-reader user navigating by heading cannot rely on. */
    const { container } = render(<ProfileFidelity canonical="Мария Ковалёва" />);
    const readHeadings = container.querySelectorAll("h1");
    expect(readHeadings).toHaveLength(1);
    expect(readHeadings[0]!.textContent).toBe(COPY.page_title);
    expect(readHeadings[0]!.className).toContain("p-coord--page");
    expect(container.querySelector('[data-role="identity"]')!.textContent).toBe("Мария Ковалёва");

    await userEvent.click(screen.getByRole("button", { name: COPY.edit }));
    const editHeadings = container.querySelectorAll("h1");
    expect(editHeadings).toHaveLength(1);
    expect(editHeadings[0]!.textContent).toBe(COPY.page_title);
  });

  it("states what the page is for, and names both areas", () => {
    render(<ProfileFidelity canonical="Мария" />);
    expect(screen.getByText(COPY.page_lead)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: COPY.section_account })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: COPY.section_security })).toBeTruthy();
  });

  it("replaces the identity with the field when the editor opens", async () => {
    const { container } = render(<ProfileFidelity canonical="Мария Ковалёва" />);
    await userEvent.click(screen.getByRole("button", { name: COPY.edit }));
    expect(container.querySelector('[data-role="identity"]')).toBeNull();
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
    await userEvent.click(screen.getByRole("button", { name: COPY.save_name }));

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
    await userEvent.click(screen.getByRole("button", { name: COPY.save_name }));

    /* SUBMITTING is the edit locus with the value held still. */
    const saving = screen.getByRole("button", { name: COPY.saving });
    expect(saving).toHaveProperty("disabled", true);
    expect(saving.getAttribute("aria-busy")).toBe("true");
    expect((screen.getByLabelText(COPY.identity_label) as HTMLInputElement).readOnly).toBe(true);
    expect(container.querySelector('[data-role="identity"]')).toBeNull();

    resolveSave({ ok: true, name: "Мария К" });
    await waitFor(() => expect(container.querySelector('[data-role="identity"]')).not.toBeNull());
    expect(container.querySelector('[data-role="identity"]')!.textContent).toBe("Мария К");
  });

  it("announces the confirmed value and returns focus quietly", async () => {
    saveProfileName.mockResolvedValue({ ok: true, name: "Мария Ковалёва-Штерн" });
    const { container } = render(<ProfileFidelity canonical="Мария" />);
    await userEvent.click(screen.getByRole("button", { name: COPY.edit }));
    await userEvent.type(screen.getByLabelText(COPY.identity_label), "-Штерн");
    await userEvent.click(screen.getByRole("button", { name: COPY.save_name }));

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
    await userEvent.click(screen.getByRole("button", { name: COPY.save_name }));
    await waitFor(() => expect(container.querySelector('[data-role="identity"]')).not.toBeNull());
    expect(container.querySelector('[data-role="identity"]')!.textContent).toBe("Мария К");
  });

  it("states a failed save at the attempt, keeps the draft, and offers no second retry", async () => {
    saveProfileName.mockResolvedValue({ ok: false, error: { code: "BACKEND_UNAVAILABLE" } });
    const { container } = render(<ProfileFidelity canonical="Мария" />);
    await userEvent.click(screen.getByRole("button", { name: COPY.edit }));
    await userEvent.type(screen.getByLabelText(COPY.identity_label), " К");
    await userEvent.click(screen.getByRole("button", { name: COPY.save_name }));

    const failure = await waitFor(() => container.querySelector('[data-role="mutation-failure"]')!);
    expect(failure.getAttribute("role")).toBe("alert");
    expect(failure.textContent).toBe(COPY.mutation_failed);
    /* Save above IS the retry — the editor never grows a second control. The
       count is scoped to the open editor now that the page also carries the
       security row's affordance. */
    const editorButtons = container.querySelector('[data-role="name-editor"]')!.querySelectorAll("button");
    expect(editorButtons).toHaveLength(2);
    expect(screen.getByRole("button", { name: COPY.save_name })).toBeTruthy();
    expect((screen.getByLabelText(COPY.identity_label) as HTMLInputElement).value).toBe("Мария К");
    expect(container.querySelector('[data-role="identity"]')).toBeNull();
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
    expect(container.querySelector('[data-role="identity"]')).toBeNull();
    expect(screen.getByRole("button", { name: COPY.page_failed_retry })).toBeTruthy();
    /* Still one h1, and it is the page coordinate. */
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });

  it("keeps the support handoff pointing somewhere real, in the row it belongs to", () => {
    const { container } = render(<ProfileFidelity canonical="Мария" />);
    const link = container.querySelector('[data-role="email-support-link"]') as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/support");
    expect(container.querySelector('[data-role="consequence"]')!.textContent).toBe(COPY.consequence);
  });

  it("still hands off from the page-failure state, which has no email row", () => {
    /* The working page carries its handoff in the email row. A page that failed
       to load has no rows at all, so the failure state keeps its own. */
    const { container } = render(<ProfileFidelity canonical={null} />);
    expect(container.querySelector('[data-role="page-failure"]')).toBeTruthy();
    const link = container.querySelector('[data-role="support-link"]') as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/support");
  });
});

/* --------------------------------------------------- the narrow boundary */

describe("Profile — what the page may never become", () => {
  const surface = codeOnly(SRC("profile-fidelity.tsx"));
  const state = codeOnly(SRC("profile-state.ts"));

  it("edits identity and sign-in security, and still nothing else", () => {
    /* THIS REPLACES "edits exactly one field" BY AUTHORISATION.
       ATA-PROFILE-FOUNDATION-1 added the password form the surface used to
       forbid. What has NOT changed is the boundary around it: no phone, no
       balance, no affiliate identity, no staff data — and no email control,
       because that flow has no mail transport behind it. */
    for (const field of ["телефон", "phone", "баланс", "balance", "affiliate", "партнёр"]) {
      expect(surface.toLowerCase(), field).not.toContain(field);
    }
  });

  it("offers no email control, and never calls the pending-email path", async () => {
    render(<ProfileFidelity canonical="Мария" />);
    expect(screen.getByText(COPY.email_label)).toBeTruthy();
    expect(screen.getByText(COPY.email_via_support)).toBeTruthy();
    /* No editor, no field, no promise of a date. */
    expect(screen.queryByRole("button", { name: /email/i })).toBeNull();
    expect(screen.queryByLabelText(/email/i)).toBeNull();
    expect(surface.toLowerCase()).not.toContain("pendingemail");
    expect(surface.toLowerCase()).not.toContain("скоро");
    /* Two links reach /support on this page: the row's own handoff and the
       page-level one the frozen surface already carried. Both are specified, so
       the query names which is which rather than matching on text. */
    const rowLink = document.querySelector('[data-role="email-support-link"]') as HTMLAnchorElement;
    expect(rowLink.getAttribute("href")).toBe("/support");
  });

  it("offers exactly one support path, and it belongs to the email row", () => {
    const { container } = render(<ProfileFidelity canonical="Мария" />);
    const links = [...container.querySelectorAll('a[href="/support"]')];
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute("data-role")).toBe("email-support-link");

    /* Not beside the password section: that is self-service now, and a handoff
       there would send people to support for something the page does itself. */
    const security = container.querySelectorAll("section")[1]!;
    expect(security.querySelectorAll('a[href="/support"]')).toHaveLength(0);

    /* And the sentence that used to make the page-wide promise is gone. */
    expect(container.textContent).not.toContain("Остальные данные учётной записи");
    expect(container.textContent).not.toContain("скоро");
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

/* -------------------------------------------------------------- security */

describe("Profile — changing the password", () => {
  const open = async () => {
    render(<ProfileFidelity canonical="Мария" />);
    await userEvent.click(screen.getByRole("button", { name: COPY.password_edit }));
  };
  const fields = () => ({
    current: screen.getByLabelText(COPY.password_current) as HTMLInputElement,
    next: screen.getByLabelText(COPY.password_new) as HTMLInputElement,
    confirm: screen.getByLabelText(COPY.password_confirm) as HTMLInputElement,
  });
  const fill = async (current: string, next: string, confirm = next) => {
    const f = fields();
    await userEvent.type(f.current, current);
    await userEvent.type(f.next, next);
    await userEvent.type(f.confirm, confirm);
  };
  const submit = () => userEvent.click(screen.getByRole("button", { name: COPY.password_submit }));

  it("gives every field a visible label and the right autocomplete", async () => {
    await open();
    const f = fields();
    expect(f.current.type).toBe("password");
    expect(f.next.type).toBe("password");
    expect(f.confirm.type).toBe("password");
    expect(f.current.getAttribute("autocomplete")).toBe("current-password");
    expect(f.next.getAttribute("autocomplete")).toBe("new-password");
    expect(f.confirm.getAttribute("autocomplete")).toBe("new-password");
    expect(screen.getByText(COPY.password_constraint)).toBeTruthy();
  });

  it("does not move the page heading when the form opens", async () => {
    const { container } = render(<ProfileFidelity canonical="Мария" />);
    await userEvent.click(screen.getByRole("button", { name: COPY.password_edit }));
    const h1s = container.querySelectorAll("h1");
    expect(h1s).toHaveLength(1);
    expect(h1s[0]!.textContent).toBe(COPY.page_title);
  });

  it("catches a mismatch before any request leaves", async () => {
    await open();
    await fill("current-one", "abcdef", "abcdeg");
    await submit();
    expect(await screen.findByText(COPY.password_mismatch)).toBeTruthy();
    expect(changeProfilePassword).not.toHaveBeenCalled();
  });

  it("refuses five characters before any request leaves", async () => {
    await open();
    await fill("current-one", "abcde");
    await submit();
    expect(await screen.findByText(COPY.password_too_short)).toBeTruthy();
    expect(changeProfilePassword).not.toHaveBeenCalled();
  });

  it("accepts six with no uppercase and no digit, and sends exactly two values", async () => {
    changeProfilePassword.mockResolvedValue({ ok: true });
    await open();
    await fill("current-one", "abcdef");
    await submit();
    await waitFor(() => expect(changeProfilePassword).toHaveBeenCalled());
    expect(changeProfilePassword.mock.calls[0]!.slice(0, 2)).toEqual(["current-one", "abcdef"]);
  });

  it("clears every field on success and says so", async () => {
    changeProfilePassword.mockResolvedValue({ ok: true });
    await open();
    await fill("current-one", "abcdef");
    await submit();
    await waitFor(() => expect(screen.getByText(COPY.password_changed)).toBeTruthy());
    /* The form is closed, and nothing typed survives it. */
    expect(screen.queryByLabelText(COPY.password_current)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: COPY.password_edit }));
    const f = fields();
    expect(f.current.value).toBe("");
    expect(f.next.value).toBe("");
    expect(f.confirm.value).toBe("");
  });

  it("says only that the current password was wrong, and keeps the form", async () => {
    changeProfilePassword.mockResolvedValue({ ok: false, wrongCurrent: true });
    await open();
    await fill("wrong-one", "abcdef");
    await submit();
    const error = await screen.findByText(COPY.password_wrong_current);
    expect(error.getAttribute("role")).toBe("alert");
    /* Nothing about the account, and the person's intent is still on screen. */
    expect(fields().next.value).toBe("abcdef");
  });

  it("a server failure changes nothing the page was already showing", async () => {
    changeProfilePassword.mockResolvedValue({
      ok: false, wrongCurrent: false, error: { code: "BACKEND_UNAVAILABLE" },
    });
    await open();
    await fill("current-one", "abcdef");
    await submit();
    expect(await screen.findByText(COPY.password_failed)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: COPY.cancel }));
    expect(screen.getByText("Мария")).toBeTruthy();
  });

  it("cancel sends nothing and keeps nothing", async () => {
    await open();
    await fill("current-one", "abcdef");
    await userEvent.click(screen.getByRole("button", { name: COPY.cancel }));
    expect(changeProfilePassword).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: COPY.password_edit }));
    expect(fields().current.value).toBe("");
  });

  it("a submit in flight cannot be sent twice", async () => {
    let resolve: (v: unknown) => void = () => {};
    changeProfilePassword.mockReturnValue(new Promise((r) => (resolve = r)));
    await open();
    await fill("current-one", "abcdef");
    await submit();
    const busy = screen.getByRole("button", { name: COPY.saving });
    expect(busy).toHaveProperty("disabled", true);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    await userEvent.click(busy);
    expect(changeProfilePassword).toHaveBeenCalledTimes(1);
    resolve({ ok: true });
  });

  it("opens only one editor at a time", async () => {
    render(<ProfileFidelity canonical="Мария" />);
    await userEvent.click(screen.getByRole("button", { name: COPY.edit }));
    expect(screen.getByRole("button", { name: COPY.password_edit })).toHaveProperty("disabled", true);
    await userEvent.click(screen.getByRole("button", { name: COPY.cancel }));
    await userEvent.click(screen.getByRole("button", { name: COPY.password_edit }));
    expect(screen.getByRole("button", { name: COPY.edit })).toHaveProperty("disabled", true);
  });

  it("gives every control a target a thumb can hit", () => {
    /* Named selectors, not a substring. The first version of this test asked
       whether the stylesheet contained `min-height: 44px` anywhere; it did, on
       the row affordances, while the form controls measured 30px on a phone.
       The harness caught that. This asserts each family carries the floor. */
    const css = codeOnly(SRC("profile-fidelity.css"));
    /* The two rules that carry the floor, named exactly. The measurement that
       actually proves it is the harness, which laid these controls out against
       this stylesheet at five viewports; this keeps the rules from being
       deleted between harness runs. */
    expect(css).toMatch(
      /\.pf \.p-name-control,\s*\.pf \.p-save,\s*\.pf \.p-cancel \{\s*min-height: 44px;\s*\}/,
    );
    expect(css).toMatch(/\.pf \.p-edit,\s*\.pf \.p-edit--link \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.pf \.p-cancel \{ min-width: 44px; \}/);
  });

  it("keeps the focus ring visible on every control", () => {
    /* Comments stripped first: the file header QUOTES this selector while
       explaining it, and matching the quotation instead of the rule made the
       assertion read a paragraph of prose for an outline. */
    const css = codeOnly(SRC("profile-fidelity.css"));
    const i = css.indexOf(".pf .p-profile :is(a, button, input, [tabindex]):focus-visible");
    expect(i).toBeGreaterThan(-1);
    const rule = css.slice(i, css.indexOf("}", i));
    expect(rule).toContain("outline");
    expect(rule).not.toContain("outline: none");
    expect(rule).not.toContain("outline:none");
  });

  it("refuses re-entry while a change is in flight, not only by disabling", () => {
    /* Source-level on purpose. The button is `disabled` while submitting, so a
       click cannot reach the handler and a behavioural test passes whether or
       not the guard exists. The guard is what protects the path that is NOT a
       click — a form submit, an Enter key, a future caller. */
    const code = codeOnly(SRC("profile-fidelity.tsx"));
    expect(code).toContain('if (phase === "submitting") return;');
  });
});

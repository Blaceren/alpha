import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfileFidelity } from "@/features/profile-fidelity/profile-fidelity";
import { COPY, canSaveName, NAME_MAX, NAME_MIN } from "@/features/profile-fidelity/profile-state";

/**
 * ATA-PROFILE-NAME-ACTION-WEIGHT-1 — WHEN SAVE IS OFFERED, AND HOW LOUDLY.
 *
 * Measured on the live desktop before this pass: the Save button was 135.17px
 * of solid Signal fill, live from the instant the editor opened, sitting beside
 * a name it was offering to replace with itself. Three things were wrong and
 * only three: the label repeated a noun the row already carried, the fill made
 * the action heavier than the identity, and the button was available when
 * pressing it would have achieved nothing.
 *
 * The 44px target was never one of them, and it is asserted below to make sure
 * shrinking the button did not shrink the thing a finger has to hit.
 */

const saveProfileName = vi.fn();
vi.mock("@/lib/profile/profile-client", () => ({
  saveProfileName: (...a: unknown[]) => saveProfileName(...a),
  changeProfilePassword: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const CANON = "Мария";
const CSS = readFileSync("src/features/profile-fidelity/profile-fidelity.css", "utf8");
const TSX = readFileSync("src/features/profile-fidelity/profile-fidelity.tsx", "utf8");

beforeEach(() => saveProfileName.mockReset());

/** Open the editor and hand back the field and the button. */
async function openEditor() {
  const view = render(<ProfileFidelity canonical={CANON} />);
  await userEvent.click(screen.getByRole("button", { name: COPY.edit }));
  return {
    ...view,
    input: screen.getByLabelText(COPY.identity_label) as HTMLInputElement,
    save: () => screen.getByRole("button", { name: COPY.save_name }) as HTMLButtonElement,
  };
}

async function retype(input: HTMLInputElement, value: string) {
  await userEvent.clear(input);
  if (value) await userEvent.type(input, value);
}

describe("the state predicate", () => {
  const at = (draft: string, mode = "EDITING" as const) =>
    canSaveName({ mode, canonical: CANON, draft, error: null, announce: null });

  // 1
  it("is closed the moment the editor opens, because nothing has changed yet", async () => {
    const { save } = await openEditor();
    expect(save().disabled).toBe(true);
  });

  // 2
  it("does not count whitespace around an unchanged name as a change", () => {
    expect(at(`  ${CANON}  `)).toBe(false);
    expect(at(`\t${CANON}\n`)).toBe(false);
  });

  // 3 · 4
  it("refuses an empty value and a single character", () => {
    expect(at("")).toBe(false);
    expect(at("   ")).toBe(false);
    expect(at("Я")).toBe(false);
    expect(at(" Я ")).toBe(false);
  });

  // 5 · 6
  it("opens at both ends of the allowed range", () => {
    expect(at("Ян")).toBe(true);
    expect("Ян".length).toBe(NAME_MIN);
    expect(at("и".repeat(NAME_MAX))).toBe(true);
  });

  // 7
  it("refuses fifty-one, which `maxLength` alone would not stop on paste", () => {
    expect(at("и".repeat(NAME_MAX + 1))).toBe(false);
  });

  // 8 · 9
  it("opens on a real change and closes again when the name comes back", async () => {
    const { input, save } = await openEditor();
    await retype(input, "Анна");
    expect(save().disabled).toBe(false);
    await retype(input, CANON);
    expect(save().disabled).toBe(true);
  });

  // 10
  it("is closed while a request is in flight", () => {
    expect(canSaveName({ mode: "SUBMITTING", canonical: CANON, draft: "Анна", error: null, announce: null })).toBe(false);
  });

  it("is closed in the states that have no editor at all", () => {
    expect(canSaveName({ mode: "VIEW", canonical: CANON, draft: "Анна", error: null, announce: null })).toBe(false);
    expect(canSaveName({ mode: "PAGEFAIL", canonical: null, draft: "Анна", error: null, announce: null })).toBe(false);
  });
});

describe("the button in the page", () => {
  // 11
  it("keeps the draft and offers the action again after the server refuses", async () => {
    saveProfileName.mockResolvedValue({ ok: false });
    const { input, save } = await openEditor();
    await retype(input, "Анна");
    await userEvent.click(save());
    await waitFor(() => screen.getByText(COPY.mutation_failed));

    expect(input.value).toBe("Анна");
    expect(save().disabled).toBe(false);
  });

  // 12
  it("closes the editor and shows the new name when the server confirms", async () => {
    saveProfileName.mockResolvedValue({ ok: true, name: "Анна" });
    const { input, save, container } = await openEditor();
    await retype(input, "Анна");
    await userEvent.click(save());

    await waitFor(() => expect(container.querySelector('[data-role="name-editor"]')).toBeNull());
    expect(container.querySelector('[data-role="identity"]')!.textContent).toBe("Анна");
  });

  // 13 · 14
  it("says one word, once", async () => {
    const { container } = await openEditor();
    expect(COPY.save_name).toBe("Сохранить");
    expect(container.textContent).not.toContain("Сохранить имя");
    expect(container.querySelectorAll('[data-role="save"]')).toHaveLength(1);
  });

  // 15
  it("belongs to the name editor and never appears in the password form", async () => {
    const view = render(<ProfileFidelity canonical={CANON} />);
    await userEvent.click(screen.getByRole("button", { name: COPY.password_edit }));
    expect(view.container.querySelector('[data-role="save"]')).toBeNull();
    expect(view.container.querySelector('[data-role="name-editor"]')).toBeNull();
  });

  // 16
  it("sends nothing when the editor is cancelled", async () => {
    const { input } = await openEditor();
    await retype(input, "Анна");
    await userEvent.click(screen.getByRole("button", { name: COPY.cancel }));
    expect(saveProfileName).not.toHaveBeenCalled();
  });
});

describe("the request must not move the row", () => {
  /* MEASURED, and this is why the assertions below exist. With the label
     switching to «Сохранение…» the button went 103.88px -> 122.38px and «Отмена»
     went 153.88 -> 172.38 for the length of the request: a control moving
     sideways under the pointer that just pressed it. The actions row stayed
     936px wide, which is exactly why row width was not enough evidence.
     jsdom cannot measure a box, so what is pinned here is the CAUSE — one
     unchanging string — and the harness measures the consequence. */

  it("shows the same word in every state, including while the request runs", async () => {
    let release!: (r: unknown) => void;
    saveProfileName.mockReturnValue(new Promise((r) => { release = r; }));
    const { input, save } = await openEditor();

    expect(save().textContent!.trim()).toBe(COPY.save_name);
    await retype(input, "Анна");
    expect(save().textContent!.trim()).toBe(COPY.save_name);
    await userEvent.click(save());
    await waitFor(() => expect(save().getAttribute("aria-busy")).toBe("true"));
    expect(save().textContent!.trim()).toBe(COPY.save_name);

    release({ ok: false });
    await waitFor(() => screen.getByText(COPY.mutation_failed));
    expect(save().textContent!.trim()).toBe(COPY.save_name);
  });

  it("marks the request with aria-busy and a real disabled, not with the label", async () => {
    let release!: (r: unknown) => void;
    saveProfileName.mockReturnValue(new Promise((r) => { release = r; }));
    const { input, save } = await openEditor();
    await retype(input, "Анна");
    await userEvent.click(save());

    await waitFor(() => expect(save().getAttribute("aria-busy")).toBe("true"));
    expect(save().disabled).toBe(true);
    expect(save().textContent!.trim()).toBe("Сохранить");
    release({ ok: false });
  });

  it("reports progress in the live region instead", async () => {
    let release!: (r: unknown) => void;
    saveProfileName.mockReturnValue(new Promise((r) => { release = r; }));
    const { input, save, container } = await openEditor();
    await retype(input, "Анна");
    await userEvent.click(save());

    const status = container.querySelector('[data-role="save-status"]')!;
    await waitFor(() => expect(status.textContent).toBe(COPY.saving_status));
    expect(status.getAttribute("role")).toBe("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(COPY.saving_status.length).toBeGreaterThan(0);
    release({ ok: false });
  });

  it("renders the label unconditionally, so no state can widen the button", () => {
    /* The mutation this catches: putting `busy ? COPY.saving : COPY.save_name`
       back inside the name button. */
    const button = TSX.slice(TSX.indexOf('data-role="save"'), TSX.indexOf('data-role="cancel"'));
    expect(button).toContain("{COPY.save_name}");
    /* `busy` itself is still legitimate inside this button — it is what sets
       `aria-busy`. What may never come back is a ternary that picks the LABEL,
       because the label is what sets the width. */
    expect(button).not.toContain("COPY.saving");
    expect(button).not.toMatch(/\?\s*COPY\./);
    expect(button).toContain('aria-busy": true as const');
  });

  it("leaves the password button's own label alone", () => {
    /* `saving` is still correct there: a different control, on a different row,
       with nothing beside it to push. */
    expect(TSX).toContain("{pwBusy ? COPY.saving : COPY.password_submit}");
  });
});

describe("weight, and the target underneath it", () => {
  it("declares no width, so the button is as wide as its word", () => {
    const rule = CSS.slice(CSS.indexOf(".pf .p-save {"), CSS.indexOf("}", CSS.indexOf(".pf .p-save {")));
    expect(rule).not.toContain("width:");
    expect(rule).not.toContain("flex: 1");
    expect(rule).toContain("padding: var(--p-action-pad-y) var(--p-save-pad-x)");
  });

  it("keeps the 44px floor that the smaller label must not take away", () => {
    expect(CSS).toContain(".pf .p-save,\n.pf .p-cancel {\n  min-height: 44px;\n}");
    /* The shared pseudo-target makes up the rest of the 44px square. */
    expect(CSS).toContain("width: max(100%, 44px)");
    expect(CSS).toContain("height: max(100%, 44px)");
  });

  it("withdraws the fill when there is nothing to save, and changes nothing else", () => {
    const i = CSS.indexOf(".pf .p-save:disabled {");
    expect(i).toBeGreaterThan(-1);
    const rule = CSS.slice(i, CSS.indexOf("}", i));
    expect(rule).toContain("background: none");
    expect(rule).not.toContain("var(--p-signal)");
    /* Box metrics must be identical to the live state or the row moves. */
    for (const shifting of ["padding", "font", "border-width", "border-radius", "min-height"]) {
      expect(rule, `disabled must not set ${shifting}`).not.toContain(`${shifting}:`);
    }
  });

  it("does not paint hover or active states on a dead button", () => {
    expect(CSS).toContain(".pf .p-save:hover:not(:disabled)");
    expect(CSS).toContain(".pf .p-save:active:not(:disabled)");
  });

  it("never lets a later rule take the focus ring off this button", () => {
    /* The ring comes from one shared rule over every control in the page. A
       later, more specific rule naming `.p-save` could switch it off while the
       shared rule still reads as intact — the first version of this suite
       missed exactly that, and a mutation adding
       `.pf .p-save:focus-visible { outline: none }` survived. */
    expect(CSS).toContain(".pf .p-profile :is(a, button, input, [tabindex]):focus-visible");
    const suppressors = CSS.split("\n").filter(
      (line) => line.includes("p-save") && line.includes(":focus"),
    );
    expect(suppressors, "no rule may target .p-save's focus state on its own").toEqual([]);
    /* The only outline removal allowed is the mouse-focus one, and it is scoped
       to `:focus:not(:focus-visible)` for every control, not to this button. */
    const removals = CSS.split("\n").filter((line) => line.includes("outline: none"));
    for (const line of removals) {
      expect(line, `unexpected outline removal: ${line.trim()}`).toContain(":focus:not(:focus-visible)");
    }
  });

  it("uses a real disabled attribute rather than swallowing pointer events", () => {
    expect(TSX).toContain("disabled={!canSave}");
    const saveRule = CSS.slice(CSS.indexOf(".pf .p-save"), CSS.indexOf(".pf .p-cancel {"));
    expect(saveRule).not.toContain("pointer-events");
  });
});

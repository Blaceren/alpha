import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { ReviewWindow } from "@/features/public-home/review-window";

/**
 * THE WINDOW'S ONE SEQUENCE, AND THE STRIP'S ONE HINT.
 *
 * jsdom has no IntersectionObserver, so the rest of the suite never sees the
 * sequence play. Here the observer is a stand-in that reports the window as
 * reached when the test says so, and the clock is the test's.
 */

type Entry = { isIntersecting: boolean };
let observers: Array<{ report: (visible: boolean) => void; disconnected: boolean }> = [];

class ObserverDouble {
  private record: { report: (visible: boolean) => void; disconnected: boolean };
  constructor(callback: (entries: Entry[]) => void) {
    this.record = { report: (visible) => callback([{ isIntersecting: visible }]), disconnected: false };
    observers.push(this.record);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    this.record.disconnected = true;
  }
}

function mount(reducedMotion = false) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reducedMotion && query.includes("reduce"), media: query }));
  const view = render(<ReviewWindow />);
  const stage = () => view.container.querySelector("#review-window")!.getAttribute("data-stage");
  const strip = () => view.container.querySelector(".evidence-track") as HTMLElement;
  const cards = () => Array.from(view.container.querySelectorAll(".evidence-track > li")) as HTMLElement[];
  const reach = () => act(() => observers.at(-1)!.report(true));
  const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));
  return { ...view, stage, strip, cards, reach, wait };
}

beforeEach(() => {
  observers = [];
  vi.useFakeTimers();
  vi.stubGlobal("IntersectionObserver", ObserverDouble);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Review window — the sequence", () => {
  it("waits for the window to be reached, then moves through the four states, 1.5s each", () => {
    const view = mount();
    expect(view.stage()).toBe("v1");
    view.wait(5000);
    expect(view.stage()).toBe("v1");
    view.reach();
    view.wait(1499);
    expect(view.stage()).toBe("v1");
    view.wait(1);
    expect(view.stage()).toBe("feedback");
    view.wait(1500);
    expect(view.stage()).toBe("v2");
    view.wait(1500);
    expect(view.stage()).toBe("accepted");
    // The strip follows: the card on show, and the ones behind it.
    expect(view.cards().map((card) => card.className.trim())).toEqual(["is-reached", "is-reached", "is-reached", "is-active is-reached"]);
  });

  it("plays once: the window reached again does not start it over", () => {
    const view = mount();
    view.reach();
    expect(observers.at(-1)!.disconnected).toBe(true);
    view.wait(6000);
    expect(view.stage()).toBe("accepted");
    view.reach();
    view.wait(6000);
    expect(view.stage()).toBe("accepted");
  });

  it("does not play under reduced motion: the first state, and the strip as the control", () => {
    const view = mount(true);
    // Nothing is even watched for: there is no sequence to start.
    expect(observers).toHaveLength(0);
    view.wait(6000);
    expect(view.stage()).toBe("v1");
    expect(view.strip()).not.toHaveAttribute("data-hint");
    fireEvent.click(view.cards()[2]!);
    expect(view.stage()).toBe("v2");
  });

  it("stops for good at a press on any card", () => {
    const view = mount();
    view.reach();
    view.wait(1500);
    expect(view.stage()).toBe("feedback");
    fireEvent.click(view.cards()[0]!);
    expect(view.stage()).toBe("v1");
    view.wait(10_000);
    expect(view.stage()).toBe("v1");
    // A sequence that was stopped has no end to hint after.
    expect(view.strip()).not.toHaveAttribute("data-hint");
  });
});

describe("Review window — the strip's hint", () => {
  it("is given once the sequence has played to its end, and taken away again", () => {
    const view = mount();
    view.reach();
    view.wait(4500);
    expect(view.stage()).toBe("accepted");
    // Not while the last state is still settling into the window.
    expect(view.strip()).not.toHaveAttribute("data-hint");
    view.wait(699);
    expect(view.strip()).not.toHaveAttribute("data-hint");
    view.wait(1);
    expect(view.strip()).toHaveAttribute("data-hint");
    view.wait(899);
    expect(view.strip()).toHaveAttribute("data-hint");
    view.wait(1);
    expect(view.strip()).not.toHaveAttribute("data-hint");
    // And never again.
    view.wait(20_000);
    expect(view.strip()).not.toHaveAttribute("data-hint");
    expect(view.stage()).toBe("accepted");
  });

  it("gives way at once to a press made while it is on", () => {
    const view = mount();
    view.reach();
    view.wait(4500 + 700 + 100);
    expect(view.strip()).toHaveAttribute("data-hint");
    fireEvent.click(view.cards()[1]!);
    expect(view.strip()).not.toHaveAttribute("data-hint");
    expect(view.stage()).toBe("feedback");
  });

  it("is never given where nothing played: no observer, no hint", () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    // @ts-expect-error — a browser without the observer
    delete globalThis.IntersectionObserver;
    const view = render(<ReviewWindow />);
    act(() => vi.advanceTimersByTime(10_000));
    expect(view.container.querySelector(".evidence-track")).not.toHaveAttribute("data-hint");
    expect(view.container.querySelector("#review-window")!.getAttribute("data-stage")).toBe("v1");
  });
});

describe("Review window — the stepper a narrow screen shows above it (2026-10-03)", () => {
  const steps = (view: ReturnType<typeof mount>) =>
    Array.from(view.container.querySelectorAll(".rstepper__button")) as HTMLButtonElement[];

  it("numbers the four states in order, names each in one word, and controls the window", () => {
    const view = mount();
    const buttons = steps(view);
    expect(buttons.map((b) => b.querySelector(".rstepper__num")!.textContent)).toEqual(["01", "02", "03", "04"]);
    expect(buttons.map((b) => b.querySelector(".rstepper__label")!.textContent)).toEqual([
      "Отправлена",
      "Разбор",
      "Исправлено",
      "Принята",
    ]);
    for (const button of buttons) expect(button).toHaveAttribute("aria-controls", "review-window");
    // It sits right above the window it switches.
    const stepper = view.container.querySelector(".review__stepper")!;
    expect(stepper.nextElementSibling?.id).toBe("review-window");
  });

  it("switches the window at a press, says which state is on show, and stops the sequence", () => {
    const view = mount();
    view.reach();
    fireEvent.click(steps(view)[1]!);
    expect(view.stage()).toBe("feedback");
    expect(steps(view)[1]).toHaveAttribute("aria-pressed", "true");
    expect(view.container.querySelector(".rstepper__note")!.textContent).toContain("Получен разбор.");
    // The rail is lit as far as the state on show.
    expect((view.container.querySelector(".rstepper") as HTMLElement).style.getPropertyValue("--rs-at")).toBe("1");
    view.wait(10_000);
    expect(view.stage()).toBe("feedback");
  });

  it("follows the sequence while it plays", () => {
    const view = mount();
    view.reach();
    view.wait(1500 * 3);
    expect(view.stage()).toBe("accepted");
    expect(steps(view)[3]).toHaveAttribute("aria-pressed", "true");
    expect(view.container.querySelectorAll(".rstepper__step.is-reached").length).toBe(4);
  });
});

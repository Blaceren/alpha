import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

const replace = vi.fn();
let pathname = "/";
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(search),
}));

import { HistoryEntrySync } from "./history-entry-sync";

/**
 * The browser's side of the story, played by hand: an entry is put into the
 * history the way the browser does it for an in-page link — with no state — and
 * the two events it then reports are dispatched. What is asserted is what this
 * component asks of the History API and of the router; that the router answers
 * by restoring the page is the framework's part, and it is checked in a real
 * browser (`design-memory/reviews/back-after-anchor-review.md`).
 */
function followInPageLink(address: string) {
  // The prototype's own method: an entry with a null state, as a fragment navigation leaves it.
  History.prototype.pushState.call(window.history, null, "", address);
}
const popstate = () => window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
const hashchange = () => window.dispatchEvent(new HashChangeEvent("hashchange"));
const aTurnLater = () => vi.advanceTimersByTime(0);

let replaceState: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  pathname = "/";
  search = "";
  replace.mockReset();
  window.history.replaceState({ router: true }, "", "/");
  replaceState = vi.spyOn(window.history, "replaceState");
});

afterEach(() => {
  replaceState.mockRestore();
  vi.useRealTimers();
});

describe("HistoryEntrySync — an in-page link was followed", () => {
  it("hands the new entry to the router with one replaceState of the same address", () => {
    render(<HistoryEntrySync />);
    followInPageLink("/#review");
    popstate();
    hashchange();
    // Not at once: a page that reads the fragment itself goes first.
    expect(replaceState).not.toHaveBeenCalled();
    aTurnLater();
    // The framework's documented way in: the router takes the address and
    // writes its own state into the entry.
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState).toHaveBeenCalledWith(null, "", "/#review");
    // The page is the same one: the router is not asked to go anywhere.
    expect(replace).not.toHaveBeenCalled();
  });

  it("does it once, whichever of the two events the browser reports", () => {
    render(<HistoryEntrySync />);
    followInPageLink("/#faq");
    hashchange();
    aTurnLater();
    expect(replaceState).toHaveBeenCalledTimes(1);

    // The same link pressed again: the browser replaces the entry and says so
    // with `popstate` alone — the fragment did not change.
    replaceState.mockClear();
    History.prototype.replaceState.call(window.history, null, "", "/#faq");
    popstate();
    aTurnLater();
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState).toHaveBeenCalledWith(null, "", "/#faq");
  });

  it("keeps the query string of the page the link is on", () => {
    pathname = "/tools/journal";
    search = "card=5";
    window.history.replaceState({ router: true }, "", "/tools/journal?card=5");
    replaceState.mockClear();
    render(<HistoryEntrySync />);
    followInPageLink("/tools/journal?card=5#main");
    popstate();
    hashchange();
    aTurnLater();
    expect(replaceState).toHaveBeenCalledWith(null, "", "/tools/journal?card=5#main");
    expect(replace).not.toHaveBeenCalled();
  });

  it("reads two spellings of one query string as one page", () => {
    pathname = "/lessons";
    search = "q=first+steps";
    render(<HistoryEntrySync />);
    followInPageLink("/lessons?q=first%20steps#main");
    hashchange();
    aTurnLater();
    expect(replaceState).toHaveBeenCalledWith(null, "", "/lessons?q=first%20steps#main");
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("HistoryEntrySync — what it leaves alone", () => {
  it("does nothing to an entry that has a state — the router's own", () => {
    render(<HistoryEntrySync />);
    // Back or Forward between two entries the router made.
    window.history.pushState({ router: true }, "", "/#review");
    replaceState.mockClear();
    popstate();
    hashchange();
    aTurnLater();
    expect(replaceState).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("lets a page that takes the fragment for itself go first, and then has nothing to do", () => {
    pathname = "/reset-password";
    window.history.replaceState({ router: true }, "", "/reset-password");
    render(<HistoryEntrySync />);
    // The reset link's page: it reads the token on `hashchange` and takes it out of the address.
    const page = () => window.history.replaceState({ own: true }, "", "/reset-password");
    window.addEventListener("hashchange", page);
    replaceState.mockClear();

    followInPageLink("/reset-password#token=abc");
    popstate();
    hashchange();
    aTurnLater();

    window.removeEventListener("hashchange", page);
    // One call, the page's own. The token is not written back by this component.
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState).toHaveBeenCalledWith({ own: true }, "", "/reset-password");
    expect(window.location.hash).toBe("");
    expect(replace).not.toHaveBeenCalled();
  });

  it("renders nothing", () => {
    const { container } = render(<HistoryEntrySync />);
    expect(container).toBeEmptyDOMElement();
  });

  it("stops listening, and drops a turn it was waiting for, when it leaves the page", () => {
    const { unmount } = render(<HistoryEntrySync />);
    followInPageLink("/#path");
    hashchange();
    unmount();
    aTurnLater();
    expect(replaceState).not.toHaveBeenCalled();
    popstate();
    hashchange();
    aTurnLater();
    expect(replaceState).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("HistoryEntrySync — Back arrived at an entry the router never saw", () => {
  /* The screen is /login; the entry Back lands on is the public home's, made
     before the page came alive, and it has no state. The router ignores the
     event, so the address is the home's and the screen is not. */
  it("asks the router to show the address — once for the two events of one traversal", () => {
    pathname = "/login";
    window.history.replaceState({ router: true }, "", "/login");
    replaceState.mockClear();
    render(<HistoryEntrySync />);

    History.prototype.replaceState.call(window.history, null, "", "/#review");
    popstate();
    hashchange();
    aTurnLater();

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/#review");
    // The router's tree is another page's: handing THIS entry over with the
    // current tree would put the sign-in page under the home's address for good.
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("does not ask twice when the second event comes after the first was acted on", () => {
    pathname = "/login";
    window.history.replaceState({ router: true }, "", "/login");
    render(<HistoryEntrySync />);

    History.prototype.replaceState.call(window.history, null, "", "/#faq");
    popstate();
    aTurnLater();
    hashchange();
    aTurnLater();
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("asks again on the next traversal, to the same address or another", () => {
    pathname = "/login";
    window.history.replaceState({ router: true }, "", "/login");
    render(<HistoryEntrySync />);

    History.prototype.replaceState.call(window.history, null, "", "/#faq");
    popstate();
    aTurnLater();
    popstate();
    aTurnLater();
    expect(replace).toHaveBeenCalledTimes(2);
    expect(replace).toHaveBeenLastCalledWith("/#faq");
  });

  it("treats the same path with another query string as another page", () => {
    pathname = "/tools/journal";
    search = "card=5";
    window.history.replaceState({ router: true }, "", "/tools/journal?card=5");
    replaceState.mockClear();
    render(<HistoryEntrySync />);

    History.prototype.replaceState.call(window.history, null, "", "/tools/journal?card=9#main");
    popstate();
    aTurnLater();
    expect(replace).toHaveBeenCalledWith("/tools/journal?card=9#main");
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("follows the router: after a navigation the page it compares with is the new one", () => {
    const view = render(<HistoryEntrySync />);
    pathname = "/login";
    view.rerender(<HistoryEntrySync />);
    window.history.replaceState({ router: true }, "", "/login");
    replaceState.mockClear();

    // An in-page link on the page the router is on NOW is handed over, not navigated to.
    followInPageLink("/login#main");
    hashchange();
    aTurnLater();
    expect(replaceState).toHaveBeenCalledWith(null, "", "/login#main");
    expect(replace).not.toHaveBeenCalled();
  });
});

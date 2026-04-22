/**
 * Plan Forge — Phase-31 Slice 1 tests
 *
 * Dashboard live-session: committed-before-timeout badge.
 *
 * Exercises the actual live-session.js module via Node's `vm` module with
 * minimal DOM stubs so we verify real injection behaviour without jsdom.
 * Also includes source-contract checks to anchor the data-testid attribute.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const LS_SRC = readFileSync(
  resolve(HERE, "..", "dashboard", "live-session.js"),
  "utf-8"
);
const HTML_SRC = readFileSync(
  resolve(HERE, "..", "dashboard", "index.html"),
  "utf-8"
);

// ─── DOM stub helpers ────────────────────────────────────────────────────────

function matchesSel(el, sel) {
  const dtM = sel.match(/\[data-testid="([^"]+)"\]/);
  if (dtM) return el._attrs?.["data-testid"] === dtM[1];
  const sliceM = sel.match(/\[data-slice-id="([^"]+)"\]/);
  if (sliceM) return el._attrs?.["data-slice-id"] === sliceM[1];
  return false;
}

function findInTree(children, sel) {
  for (const child of children) {
    if (matchesSel(child, sel)) return child;
    const found = findInTree(child._children || [], sel);
    if (found) return found;
  }
  return null;
}

function makeElement(tag) {
  const el = {
    _tag: tag,
    _attrs: {},
    _children: [],
    className: "",
    textContent: "",
    title: "",
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
    querySelector(sel) { return findInTree(this._children, sel); },
    appendChild(child) { this._children.push(child); return child; },
  };
  return el;
}

function makeContext() {
  const sliceCardsEl = makeElement("div");
  sliceCardsEl._attrs["id"] = "slice-cards";

  let mutationCallback = null;
  const MutationObserver = class {
    constructor(cb) { mutationCallback = cb; }
    observe() {}
    disconnect() {}
  };

  const document_ = {
    readyState: "complete",
    getElementById(id) {
      if (id === "slice-cards") return sliceCardsEl;
      return null;
    },
    createElement(tag) { return makeElement(tag); },
    addEventListener() {},
  };

  const window_ = {
    handleEvent: null,
    liveSession: null,
  };

  const ctx = createContext({ window: window_, document: document_, MutationObserver });
  runInContext(LS_SRC, ctx);

  return {
    window_,
    sliceCardsEl,
    triggerMutation: () => { if (mutationCallback) mutationCallback([]); },
  };
}

// ─── Badge renders on event ───────────────────────────────────────────────────

describe("live-session — badge renders on event", () => {
  it("onSliceTimeoutButCommitted stores the entry keyed by sliceNumber string", () => {
    const { window_ } = makeContext();
    window_.liveSession.onSliceTimeoutButCommitted({
      sliceNumber: 3,
      preSliceHead: "abc1234abcdef",
      postTimeoutHead: "def5678defghi",
      sliceTitle: "Some slice",
    });
    expect(window_.liveSession.committedSHAs.has("3")).toBe(true);
    const entry = window_.liveSession.committedSHAs.get("3");
    expect(entry.preSliceHead).toBe("abc1234abcdef");
    expect(entry.postTimeoutHead).toBe("def5678defghi");
  });

  it("badge is injected into the matching slice card", () => {
    const { window_, sliceCardsEl } = makeContext();
    const card = makeElement("div");
    card._attrs["data-slice-id"] = "3";
    sliceCardsEl._children.push(card);

    window_.liveSession.onSliceTimeoutButCommitted({
      sliceNumber: 3,
      preSliceHead: "abc1234abcdef",
      postTimeoutHead: "def5678defghi",
    });

    const badge = card.querySelector('[data-testid="committed-before-timeout-badge"]');
    expect(badge).not.toBeNull();
  });

  it("badge is re-injected after MutationObserver fires (renderSliceCards re-render)", () => {
    const { window_, sliceCardsEl, triggerMutation } = makeContext();

    window_.liveSession.onSliceTimeoutButCommitted({
      sliceNumber: 2,
      preSliceHead: "111aaaa",
      postTimeoutHead: "222bbbb",
    });

    // Simulate renderSliceCards wiping and rebuilding the DOM
    const freshCard = makeElement("div");
    freshCard._attrs["data-slice-id"] = "2";
    sliceCardsEl._children = [freshCard];
    triggerMutation();

    const badge = freshCard.querySelector('[data-testid="committed-before-timeout-badge"]');
    expect(badge).not.toBeNull();
  });
});

// ─── Badge absent when event not received ────────────────────────────────────

describe("live-session — badge absent without event", () => {
  it("committedSHAs starts empty", () => {
    const { window_ } = makeContext();
    expect(window_.liveSession.committedSHAs.size).toBe(0);
  });

  it("no badge injected when no event fired for slice", () => {
    const { window_, sliceCardsEl } = makeContext();
    const card = makeElement("div");
    card._attrs["data-slice-id"] = "5";
    sliceCardsEl._children.push(card);

    window_.liveSession.injectAllBadges();

    const badge = card.querySelector('[data-testid="committed-before-timeout-badge"]');
    expect(badge).toBeNull();
  });

  it("run-started clears stale committedSHAs", () => {
    const { window_ } = makeContext();
    window_.liveSession.onSliceTimeoutButCommitted({
      sliceNumber: 1,
      preSliceHead: "aaa",
      postTimeoutHead: "bbb",
    });
    expect(window_.liveSession.committedSHAs.size).toBe(1);

    window_.liveSession.liveHandleEvent({ type: "run-started", data: {} });
    expect(window_.liveSession.committedSHAs.size).toBe(0);
  });
});

// ─── Badge markup matches data-testid ────────────────────────────────────────

describe("live-session — badge markup", () => {
  it("badge element has data-testid='committed-before-timeout-badge'", () => {
    const { window_, sliceCardsEl } = makeContext();
    const card = makeElement("div");
    card._attrs["data-slice-id"] = "1";
    sliceCardsEl._children.push(card);

    window_.liveSession.onSliceTimeoutButCommitted({
      sliceNumber: 1,
      preSliceHead: "aabbcc1122334",
      postTimeoutHead: "ddeeff5566778",
    });

    const badge = card.querySelector('[data-testid="committed-before-timeout-badge"]');
    expect(badge._attrs["data-testid"]).toBe("committed-before-timeout-badge");
  });

  it("badge text uses 7-char SHAs with → separator", () => {
    const { window_ } = makeContext();
    const text = window_.liveSession.formatBadgeText("aabbcc1122334", "ddeeff5566778");
    expect(text).toBe("committed-before-timeout (aabbcc1\u2192ddeeff5)");
  });

  it("badge text truncates SHAs longer than 7 chars", () => {
    const { window_ } = makeContext();
    const text = window_.liveSession.formatBadgeText("aaaaaaa12345", "bbbbbbb67890");
    expect(text).toBe("committed-before-timeout (aaaaaaa\u2192bbbbbbb)");
  });

  it("badge text preserves SHAs shorter than 7 chars unchanged", () => {
    const { window_ } = makeContext();
    const text = window_.liveSession.formatBadgeText("abc", "def");
    expect(text).toBe("committed-before-timeout (abc\u2192def)");
  });

  it("existing badge text is updated on upsert (no duplicate)", () => {
    const { window_, sliceCardsEl } = makeContext();
    const card = makeElement("div");
    card._attrs["data-slice-id"] = "4";
    sliceCardsEl._children.push(card);

    window_.liveSession.onSliceTimeoutButCommitted({
      sliceNumber: 4,
      preSliceHead: "aaaaaaaaa",
      postTimeoutHead: "bbbbbbbbb",
    });

    // Second call with updated SHAs
    window_.liveSession.onSliceTimeoutButCommitted({
      sliceNumber: 4,
      preSliceHead: "ccccccccc",
      postTimeoutHead: "ddddddddd",
    });

    const badges = [];
    function collectBadges(children) {
      for (const c of children) {
        if (c._attrs?.["data-testid"] === "committed-before-timeout-badge") badges.push(c);
        collectBadges(c._children || []);
      }
    }
    collectBadges(card._children);

    expect(badges.length).toBe(1);
    expect(badges[0].textContent).toBe("committed-before-timeout (ccccccc\u2192ddddddd)");
  });

  it("live-session.js source contains data-testid='committed-before-timeout-badge'", () => {
    expect(LS_SRC).toContain('data-testid="committed-before-timeout-badge"');
  });
});

// ─── index.html includes live-session.js ──────────────────────────────────────

describe("live-session — index.html wiring", () => {
  it("index.html loads live-session.js after app.js", () => {
    const appIdx = HTML_SRC.indexOf('src="app.js"');
    const lsIdx = HTML_SRC.indexOf('src="live-session.js"');
    expect(lsIdx, "live-session.js script tag not found").toBeGreaterThan(-1);
    expect(lsIdx, "live-session.js must be loaded after app.js").toBeGreaterThan(appIdx);
  });
});

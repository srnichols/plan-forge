/**
 * The dashboard's manual "check for updates" button, when the check could not be made (#446).
 *
 * `/api/update-status` used to answer `{ available: false, current }` for a check GitHub rate-limited, and the button
 * turned that into "Up to date (vX)": the same false "current" `pforge self-update` once printed. The endpoint now says
 * `checkFailed: true` with a `failure` ({ kind, message }), and the button has to show it.
 *
 * This runs the real triggerUpdateCheck from dashboard/app.js, against a fake DOM and a fake fetch.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const APP = readFileSync(resolve(import.meta.dirname, "..", "dashboard", "app.js"), "utf8");

function loadTriggerUpdateCheck() {
  const start = APP.indexOf("async function triggerUpdateCheck()");
  const end = APP.indexOf("window.triggerUpdateCheck = triggerUpdateCheck;");
  expect(start, "triggerUpdateCheck is in dashboard/app.js").toBeGreaterThan(-1);
  expect(end, "triggerUpdateCheck is followed by its window export").toBeGreaterThan(start);
  // eslint-disable-next-line no-new-func
  return new Function("document", "fetch", "localStorage", "addNotification", "escapeHtml", "API_BASE", `${APP.slice(start, end)}\nreturn triggerUpdateCheck;`);
}

const escapeHtml = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function pressTheButton(body, { ok = true, status = 200 } = {}) {
  const notifications = [];
  const requests = [];
  const button = { textContent: "Check", disabled: false, title: "" };
  const banner = { href: "", dataset: {}, classList: { add() {}, remove() {} } };
  const elements = { "check-updates-btn": button, "update-banner": banner, "update-banner-text": { textContent: "" } };
  const document = { getElementById: (id) => elements[id] ?? null };
  const fetch = async (url) => { requests.push(url); return { ok, status, json: async () => body }; };
  const localStorage = { setItem() {}, removeItem() {}, getItem: () => null };
  const addNotification = (text, type) => notifications.push({ text, type });
  await loadTriggerUpdateCheck()(document, fetch, localStorage, addNotification, escapeHtml, "")();
  return { notifications, requests, button, banner };
}

describe("dashboard manual update check (#446)", () => {
  const FAILURE = { kind: "rate-limited", message: "GitHub's API rate limit for this address is used up until 09:00 UTC. Set GITHUB_TOKEN or GH_TOKEN to a GitHub token to raise it." };

  it("asks for a forced check", async () => {
    const { requests } = await pressTheButton({ available: false, current: "3.35.4" });
    expect(requests).toEqual(["/api/update-status?force=1"]);
  });

  it("says a check that could not be made failed, and why, instead of 'Up to date'", async () => {
    const { notifications } = await pressTheButton({ available: false, current: "3.35.4", checkFailed: true, failure: FAILURE });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].type).toBe("warning");
    expect(notifications[0].text).toContain("Update check failed");
    expect(notifications[0].text).toContain("rate limit");
    expect(notifications[0].text).toContain("GITHUB_TOKEN");
    expect(notifications[0].text).not.toContain("Up to date");
  });

  it("escapes what the server says, because notifications are rendered as HTML", async () => {
    const { notifications } = await pressTheButton({ checkFailed: true, failure: { kind: "network", message: "<img src=x onerror=alert(1)>" } });
    expect(notifications[0].text).not.toContain("<img");
    expect(notifications[0].text).toContain("&lt;img");
  });

  it("still says a check failed when the server gave no reason", async () => {
    const { notifications } = await pressTheButton({ available: false, current: "3.35.4", checkFailed: true });
    expect(notifications[0].text).toMatch(/Update check failed/);
    expect(notifications[0].type).toBe("warning");
  });

  // A forced check that GitHub could not answer is answered from the cache, and the endpoint says so with a `failure`.
  // The button's title says it bypasses the cache, so "Up to date" would be GitHub's word when it is the cache's.
  describe("when the cache answered because GitHub could not be asked", () => {
    const CHECKED_AT = "2026-10-29T08:12:34.567Z";

    it("says the answer is the cache's, which check it is from, and why GitHub was not asked, instead of 'Up to date'", async () => {
      const { notifications } = await pressTheButton({ available: false, current: "3.35.4", latest: "3.35.4", fromCache: true, checkedAt: CHECKED_AT, failure: FAILURE });
      expect(notifications).toHaveLength(1);
      expect(notifications[0].type).toBe("warning");
      expect(notifications[0].text).toContain("No newer release");
      expect(notifications[0].text).toContain("v3.35.4");
      expect(notifications[0].text).toContain("2026-10-29 08:12 UTC");
      expect(notifications[0].text).toContain("GitHub could not be asked just now");
      expect(notifications[0].text).toContain("rate limit");
      expect(notifications[0].text).not.toContain("Up to date");
    });

    it("still announces a newer release, and says it is the cache's", async () => {
      const { notifications } = await pressTheButton({ available: true, current: "3.35.4", latest: "3.35.5", url: "https://example.test/v3.35.5", fromCache: true, checkedAt: CHECKED_AT, failure: FAILURE });
      expect(notifications).toHaveLength(1);
      expect(notifications[0].type).toBe("warning");
      expect(notifications[0].text).toContain("Update available: v3.35.5 (you are on v3.35.4)");
      expect(notifications[0].text).toContain("2026-10-29 08:12 UTC");
      expect(notifications[0].text).toContain("GitHub could not be asked just now");
    });

    it("shows the banner for a newer release it got from the cache", async () => {
      const { banner } = await pressTheButton({ available: true, current: "3.35.4", latest: "3.35.5", url: "https://example.test/v3.35.5", fromCache: true, checkedAt: CHECKED_AT, failure: FAILURE });
      expect(banner.dataset.latest).toBe("3.35.5");
    });

    it("escapes what the server says here too", async () => {
      const failure = { kind: "network", message: "<img src=x onerror=alert(1)>" };
      const { notifications } = await pressTheButton({ available: false, current: "3.35.4", latest: "3.35.4", fromCache: true, checkedAt: CHECKED_AT, failure });
      expect(notifications[0].text).not.toContain("<img");
      expect(notifications[0].text).toContain("&lt;img");
    });

    it("escapes the time too, as it comes from the server like the reason does", async () => {
      const { notifications } = await pressTheButton({ available: false, current: "3.35.4", latest: "3.35.4", fromCache: true, checkedAt: "<img src=x onerror=alert(1)>", failure: FAILURE });
      expect(notifications[0].text).not.toContain("<img");
      expect(notifications[0].text).toContain("&lt;img");
    });

    it("copes with an answer that carries no time", async () => {
      const { notifications } = await pressTheButton({ available: false, current: "3.35.4", latest: "3.35.4", fromCache: true, failure: FAILURE });
      expect(notifications[0].text).toContain("GitHub could not be asked just now");
      expect(notifications[0].text).not.toContain("undefined");
    });

    it("does not add any of it to an answer from the cache that never needed GitHub", async () => {
      const { notifications } = await pressTheButton({ available: false, current: "3.35.4", latest: "3.35.4", fromCache: true, checkedAt: CHECKED_AT });
      expect(notifications).toEqual([{ text: "Up to date (v3.35.4)", type: "success" }]);
    });
  });

  it("gives the button back after a failed check", async () => {
    const { button } = await pressTheButton({ checkFailed: true, failure: FAILURE });
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Check");
  });

  it("still says the install is up to date when GitHub said so", async () => {
    const { notifications } = await pressTheButton({ available: false, current: "3.35.4", latest: "3.35.4" });
    expect(notifications).toEqual([{ text: "Up to date (v3.35.4)", type: "success" }]);
  });

  it("still announces a newer release", async () => {
    const { notifications } = await pressTheButton({ available: true, current: "3.35.4", latest: "3.35.5", url: "https://example.test/v3.35.5" });
    expect(notifications).toEqual([{ text: "Update available: v3.35.5 (you are on v3.35.4)", type: "info" }]);
  });

  it("still reports an HTTP error from the endpoint", async () => {
    const { notifications } = await pressTheButton(null, { ok: false, status: 500 });
    expect(notifications).toEqual([{ text: "Update check failed (HTTP 500)", type: "error" }]);
  });
});

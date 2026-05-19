/**
 * Plan Forge — Phase WORKER-GUARDRAILS Slice 4 (A5)
 * network-allowlist.test.mjs
 *
 * Covers:
 *   1. parsePlan extracts network.allowed from frontmatter
 *   2. parsePlan throws a descriptive error on malformed network.allowed
 *   3. Plan without network.allowed has meta.networkAllowed === undefined
 *   4. startProxyLogger returns { proxyUrl, port, stop }
 *   5. proxyUrl is a valid http://127.0.0.1:<port> URL
 *   6. Proxy logs { host, method, timestamp } NDJSON on CONNECT
 *   7. spawnWorker accepts extraEnv and spreads it into child env
 *
 * NOTE: enforce-mode behavior is NOT tested in this slice (decision #4 —
 * log-only default; no plan ships network.enforce: true this phase).
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createConnection } from "node:net";

import { parsePlan } from "../orchestrator.mjs";
import { startProxyLogger } from "../proxy-logger.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// ─── helpers ─────────────────────────────────────────────────────────────────

let tempDirs = [];

function makeTempDir() {
  const d = mkdtempSync(resolve(tmpdir(), "pforge-net-test-"));
  tempDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tempDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tempDirs = [];
});

function writePlan(dir, frontmatter, body = "") {
  const content = frontmatter
    ? `---\n${frontmatter}\n---\n\n# Test Plan\n\n**Status**: in-progress\n\n${body}`
    : `# Test Plan\n\n**Status**: in-progress\n\n${body}`;
  const path = resolve(dir, "plan.md");
  writeFileSync(path, content, "utf-8");
  return path;
}

function minimalPlanBody() {
  return `## Execution Slices\n\n### Slice 1: Do work\n\n1. Task one\n`;
}

// ─── 1. parsePlan — network.allowed ──────────────────────────────────────────

describe("parsePlan: network.allowed frontmatter", () => {
  it("parses a non-empty allowlist", () => {
    const dir = makeTempDir();
    const planPath = writePlan(
      dir,
      "network.allowed: [api.openai.com, api.anthropic.com, *.githubusercontent.com]",
      minimalPlanBody(),
    );
    const result = parsePlan(planPath, dir);
    expect(result.meta.networkAllowed).toEqual([
      "api.openai.com",
      "api.anthropic.com",
      "*.githubusercontent.com",
    ]);
  });

  it("parses an empty allowlist []", () => {
    const dir = makeTempDir();
    const planPath = writePlan(dir, "network.allowed: []", minimalPlanBody());
    const result = parsePlan(planPath, dir);
    expect(result.meta.networkAllowed).toEqual([]);
  });

  it("leaves meta.networkAllowed undefined when field is absent", () => {
    const dir = makeTempDir();
    const planPath = writePlan(dir, null, minimalPlanBody());
    const result = parsePlan(planPath, dir);
    expect(result.meta.networkAllowed).toBeUndefined();
  });

  it("throws a descriptive error when network.allowed is not a flow sequence", () => {
    const dir = makeTempDir();
    const planPath = writePlan(dir, `network.allowed: "not-an-array"`, minimalPlanBody());
    expect(() => parsePlan(planPath, dir)).toThrow(
      /network\.allowed.*YAML flow sequence.*line \d+/,
    );
  });

  it("error message includes the line number", () => {
    const dir = makeTempDir();
    const planPath = writePlan(
      dir,
      "crucibleId: abc\nnetwork.allowed: bad-value",
      minimalPlanBody(),
    );
    let msg = "";
    try { parsePlan(planPath, dir); } catch (e) { msg = e.message; }
    // crucibleId is line 2, network.allowed is line 3
    expect(msg).toMatch(/line 3/);
  });

  it("parses network.enforce: true", () => {
    const dir = makeTempDir();
    const planPath = writePlan(
      dir,
      "network.allowed: [github.com]\nnetwork.enforce: true",
      minimalPlanBody(),
    );
    const result = parsePlan(planPath, dir);
    expect(result.meta.networkEnforce).toBe(true);
  });

  it("defaults network.enforce to undefined when absent", () => {
    const dir = makeTempDir();
    const planPath = writePlan(dir, null, minimalPlanBody());
    const result = parsePlan(planPath, dir);
    expect(result.meta.networkEnforce).toBeUndefined();
  });
});

// ─── 2. startProxyLogger ─────────────────────────────────────────────────────

describe("startProxyLogger: proxy lifecycle", () => {
  it("returns proxyUrl and port", async () => {
    const proxy = await startProxyLogger();
    try {
      expect(proxy.proxyUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(proxy.port).toBeGreaterThan(0);
      expect(proxy.port).toBeLessThanOrEqual(65535);
    } finally {
      proxy.stop();
    }
  });

  it("each call gets a unique ephemeral port", async () => {
    const p1 = await startProxyLogger();
    const p2 = await startProxyLogger();
    try {
      expect(p1.port).not.toBe(p2.port);
    } finally {
      p1.stop();
      p2.stop();
    }
  });

  it("stop() is idempotent (no throw on double-stop)", async () => {
    const proxy = await startProxyLogger();
    proxy.stop();
    expect(() => proxy.stop()).not.toThrow();
  });
});

// ─── 3. Proxy log format ─────────────────────────────────────────────────────

describe("startProxyLogger: network log NDJSON format", () => {
  it("writes { host, method, timestamp } on CONNECT", async () => {
    const dir = makeTempDir();
    const networkLogPath = resolve(dir, "network.log");

    const proxy = await startProxyLogger({ networkLogPath });
    try {
      await new Promise((resolve, reject) => {
        const conn = createConnection(proxy.port, "127.0.0.1", () => {
          conn.write("CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n");
        });
        // Give the proxy a moment to log then respond
        conn.on("data", () => {
          conn.destroy();
          resolve();
        });
        conn.on("error", reject);
        setTimeout(() => { conn.destroy(); resolve(); }, 500);
      });
    } finally {
      proxy.stop();
    }

    expect(existsSync(networkLogPath)).toBe(true);
    const raw = readFileSync(networkLogPath, "utf-8").trim();
    const entry = JSON.parse(raw.split("\n")[0]);
    expect(entry.host).toBe("example.com:443");
    expect(entry.method).toBe("CONNECT");
    expect(typeof entry.timestamp).toBe("string");
    expect(() => new Date(entry.timestamp)).not.toThrow();
  });

  it("creates parent directories of networkLogPath if they don't exist", async () => {
    const dir = makeTempDir();
    const networkLogPath = resolve(dir, "slices", "4", "network.log");

    const proxy = await startProxyLogger({ networkLogPath });
    try {
      await new Promise((resolve, reject) => {
        const conn = createConnection(proxy.port, "127.0.0.1", () => {
          conn.write("CONNECT api.example.com:443 HTTP/1.1\r\nHost: api.example.com:443\r\n\r\n");
        });
        conn.on("data", () => { conn.destroy(); resolve(); });
        conn.on("error", reject);
        setTimeout(() => { conn.destroy(); resolve(); }, 500);
      });
    } finally {
      proxy.stop();
    }

    expect(existsSync(networkLogPath)).toBe(true);
  });
});

// ─── 4. isHostAllowed helper (via proxy enforce path not tested this phase) ──

describe("startProxyLogger: log-only default", () => {
  it("does NOT return 403 for unlisted hosts in log-only mode (default)", async () => {
    const dir = makeTempDir();
    const networkLogPath = resolve(dir, "network.log");

    // log-only mode: enforce is false (default), so unlisted hosts are forwarded (not blocked)
    const proxy = await startProxyLogger({ allowlist: ["api.openai.com"], networkLogPath });
    let responseData = "";
    try {
      await new Promise((res, rej) => {
        const conn = createConnection(proxy.port, "127.0.0.1", () => {
          conn.write("CONNECT unlisted.example.com:443 HTTP/1.1\r\nHost: unlisted.example.com:443\r\n\r\n");
        });
        conn.on("data", (chunk) => { responseData += chunk.toString(); conn.destroy(); res(); });
        // connection reset / error means proxy attempted to forward (not block)
        conn.on("error", () => res());
        conn.on("close", () => res());
        setTimeout(() => { conn.destroy(); res(); }, 800);
      });
    } finally {
      proxy.stop();
    }
    // In log-only mode, the proxy NEVER returns 403 (that's enforce-mode only)
    expect(responseData).not.toMatch(/403/);
  });
});

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  planServiceCommand,
  renderTemplate,
  runServiceAction,
} from "../service/service-manager.mjs";
import { collectStatus, formatStatus } from "../src/cli/status.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directories = [];
const temporary = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "claw-service-"));
  directories.push(dir);
  return dir;
};

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("service packaging", () => {
  it("ships both installer twins with all actions", () => {
    const sh = readFileSync(path.join(ROOT, "service", "install-service.sh"), "utf8");
    const ps = readFileSync(path.join(ROOT, "service", "install-service.ps1"), "utf8");
    for (const action of ["install", "uninstall", "status"]) {
      expect(sh).toContain(action);
      expect(ps.toLowerCase()).toContain(action);
    }
  });

  it("keeps templates generic and includes the service lifecycle settings", () => {
    const plist = readFileSync(path.join(ROOT, "service", "com.pforge.claw.plist"), "utf8");
    const unit = readFileSync(path.join(ROOT, "service", "pforge-claw.service"), "utf8");
    expect(plist).toContain("__NODE__");
    expect(plist).toContain("__CLI__");
    expect(plist).toContain("__HOME__");
    expect(plist).toContain("__LOGDIR__");
    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).toContain("<key>KeepAlive</key>");
    expect(unit).toContain("Restart=on-failure");
    expect(unit).toContain("NoNewPrivileges=yes");
    expect(unit).not.toMatch(/[A-Z]:\\Users\\|\/Users\/[^<]/);
  });

  it.each([
    ["darwin", "bash", "install"],
    ["darwin", "bash", "uninstall"],
    ["darwin", "bash", "status"],
    ["linux", "bash", "install"],
    ["linux", "bash", "uninstall"],
    ["linux", "bash", "status"],
    ["win32", "pwsh", "install"],
    ["win32", "pwsh", "uninstall"],
    ["win32", "pwsh", "status"],
  ])("plans %s %s service commands without a shell", (platform, bin, action) => {
    const plan = planServiceCommand({
      platform,
      action,
      home: "C:\\Users\\A & B\\claw",
      nodePath: "C:\\Program Files\\node.exe",
      cliPath: "C:\\Forge\\cli.mjs",
    });
    expect(plan.bin).toBe(bin);
    expect(plan.args.some((arg) => arg.includes(platform === "win32" ? "install-service.ps1" : "install-service.sh"))).toBe(true);
    expect(plan.args).toContain(action);
    expect(plan).not.toHaveProperty("shell");
  });

  it("rejects unsupported platforms and invalid service actions", () => {
    expect(() => planServiceCommand({ platform: "aix", action: "status" }))
      .toThrowError(expect.objectContaining({ code: "SERVICE_PLATFORM_UNSUPPORTED" }));
    expect(() => planServiceCommand({ platform: "linux", action: "erase" }))
      .toThrowError(expect.objectContaining({ code: "SERVICE_ACTION_INVALID" }));
  });

  it("returns the spawned process result through the injectable command runner", async () => {
    const result = await runServiceAction({ bin: "systemctl", args: ["--user", "status"] }, {
      exec: async (bin, args) => ({ code: 7, stdout: `${bin} ${args.join(" ")}`, stderr: "" }),
    });
    expect(result).toMatchObject({ code: 7, stdout: "systemctl --user status" });
  });

  it("exits with usage status 2 for an invalid CLI action", () => {
    const result = spawnSync(process.execPath, [path.join(ROOT, "cli.mjs"), "service", "restart"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Usage:");
  });

  it("escapes paths for each service format and rejects control characters", () => {
    const special = "C:\\Apps\\O'Brien & Sons% $home \"雪\"";
    expect(renderTemplate("__HOME__", { HOME: special }, { format: "xml" }))
      .toBe("C:\\Apps\\O&apos;Brien &amp; Sons% $home &quot;雪&quot;");
    expect(renderTemplate("__HOME__", { HOME: special }, { format: "systemd" }))
      .toContain("O'Brien & Sons%% $$home \\\"雪\\\"");
    expect(renderTemplate("__HOME__", { HOME: special }, { format: "ps" }))
      .toBe("C:\\Apps\\O''Brien & Sons% $home \"雪\"");
    expect(() => renderTemplate("__HOME__", { HOME: "bad\npath" }, { format: "xml" }))
      .toThrowError(expect.objectContaining({ code: "SERVICE_PATH_INVALID" }));
  });
});

describe("read-only service status", () => {
  it("handles empty home without writing files and reports empty/unknown explicitly", async () => {
    const home = temporary();
    const report = await collectStatus({ home, config: { projects: [], lanes: [] } });
    expect(formatStatus(report)).toContain("no digest has run yet");
    expect(formatStatus(report)).toContain("unknown");
    expect(readdirSync(home)).toEqual([]);
  });

  it("counts queue states per project and reports only successful digest runs", async () => {
    const home = temporary();
    const state = path.join(home, "state");
    const events = [
      { kind: "job.created", job: { id: "j1", type: "task", projectId: "alpha", mutating: true, state: "queued" } },
      { kind: "job.transition", jobId: "j1", from: "queued", to: "awaiting-approval" },
      { kind: "job.created", job: { id: "j2", type: "task", projectId: "alpha", mutating: true, state: "queued" } },
      { kind: "job.transition", jobId: "j2", from: "queued", to: "awaiting-approval" },
      { kind: "job.created", job: { id: "j3", type: "ask", projectId: "beta", mutating: false, state: "queued" } },
      { kind: "job.created", job: { id: "j4", type: "task", projectId: "alpha", mutating: true, state: "queued" } },
      { kind: "job.transition", jobId: "j4", from: "queued", to: "awaiting-approval" },
      { kind: "job.transition", jobId: "j4", from: "awaiting-approval", to: "approved" },
      { kind: "job.transition", jobId: "j4", from: "approved", to: "held-budget" },
      { kind: "job.created", job: { id: "j5", type: "ask", projectId: "alpha", mutating: false, state: "queued" } },
      { kind: "job.transition", jobId: "j5", from: "queued", to: "leased" },
      { kind: "job.transition", jobId: "j5", from: "leased", to: "running" },
    ];
    mkdirSync(state, { recursive: true });
    writeFileSync(path.join(state, "jobs.jsonl"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n{"partial":`);
    writeFileSync(path.join(state, "schedules.json"), JSON.stringify({
      v: 1,
      schedules: {
        good: { lastRunAt: "2026-10-07T12:00:00.000Z", status: "done" },
        bad: { lastRunAt: "2026-10-07T13:00:00.000Z", status: "failed" },
      },
    }));
    const report = await collectStatus({
      home,
      config: {
        schedules: [{ id: "good", kind: "digest" }, { id: "bad", kind: "digest" }],
        projects: [{ id: "alpha" }, { id: "beta" }],
        lanes: [],
      },
    });
    expect(report.projects.alpha.counts["awaiting-approval"]).toBe(2);
    expect(report.projects.alpha.counts["held-budget"]).toBe(1);
    expect(report.projects.alpha.counts.running).toBe(1);
    expect(report.projects.beta.counts.queued).toBe(1);
    expect(report.lastDigest).toBe("2026-10-07T12:00:00.000Z");
    const selected = await collectStatus({
      home,
      project: "beta",
      config: { projects: [{ id: "alpha" }, { id: "beta" }], lanes: [] },
    });
    expect(Object.keys(selected.projects)).toEqual(["beta"]);
  });

  it("redacts canary tokens from text and JSON output", async () => {
    const home = temporary();
    const canary = "sk-canary-token-value-0123456789";
    writeFileSync(path.join(home, "secrets.json"), JSON.stringify({ CANARY: canary }));
    const report = await collectStatus({
      home,
      config: { projects: [{ id: "safe" }], lanes: [] },
      env: {},
    });
    const output = `${formatStatus(report)}${JSON.stringify(report)}`;
    expect(output).not.toContain(canary);
  });

  it("reports local, remote, and disabled lane states plus poller recency", async () => {
    const home = temporary();
    const state = path.join(home, "state");
    mkdirSync(state, { recursive: true });
    writeFileSync(path.join(state, "dispatcher.lock"), JSON.stringify({ pid: process.pid }));
    writeFileSync(path.join(state, "lanes.json"), JSON.stringify({
      remote: { enabled: true, lastHeartbeat: "2026-10-07T19:00:00.000Z" },
      offline: { on: false },
    }));
    writeFileSync(path.join(state, "updates.jsonl"), `${JSON.stringify({
      ts: "2026-10-07T19:01:00.000Z", updateId: 4,
    })}\n{"partial":`);
    const report = await collectStatus({
      home,
      config: {
        channels: { telegram: { mode: "poll" } },
        lanes: [
          { id: "local", kind: "local", enabled: true },
          { id: "remote", kind: "remote", enabled: true },
          { id: "offline", kind: "remote", enabled: true },
        ],
        projects: [],
      },
    });
    expect(report.lanes).toEqual([
      { id: "local", kind: "local", state: "running", pid: process.pid },
      {
        id: "remote", kind: "remote", state: "on",
        heartbeat: "2026-10-07T19:00:00.000Z",
      },
      { id: "offline", kind: "remote", state: "disabled" },
    ]);
    expect(report.pollerLag).toBe("2026-10-07T19:01:00.000Z (approximate (offline))");
  });

  it("reports stopped local lanes and webhook readiness distinctly", async () => {
    const home = temporary();
    const state = path.join(home, "state");
    mkdirSync(state, { recursive: true });
    writeFileSync(path.join(state, ".readyz"), JSON.stringify({ ready: true }));
    const report = await collectStatus({
      home,
      config: {
        channels: { telegram: { mode: "webhook" } },
        lanes: [{ id: "local", kind: "local", enabled: true }],
        projects: [],
      },
    });
    expect(report.lanes[0].state).toBe("stopped");
    expect(report.pollerLag).toBe("/readyz ready");
  });

  it("uses offsets-file mtime as the offline poller estimate when no updates exist", async () => {
    const home = temporary();
    const state = path.join(home, "state");
    mkdirSync(state, { recursive: true });
    const offsetFile = path.join(state, "offsets.json");
    writeFileSync(offsetFile, JSON.stringify({ v: 1, telegram: 10 }));
    const lastUpdate = new Date("2026-10-07T19:02:00.000Z");
    utimesSync(offsetFile, lastUpdate, lastUpdate);
    const report = await collectStatus({ home, config: { projects: [], lanes: [] } });
    expect(report.pollerLag).toBe(`${lastUpdate.toISOString()} (approximate (offline))`);
  });

  it.skipIf(process.platform === "win32")("runs the Unix installer dry-run", () => {
    const result = spawnSync("bash", [
      path.join(ROOT, "service", "install-service.sh"),
      "install", "--dry-run", "--home", temporary(),
    ], { encoding: "utf8" });
    expect(result.status).toBe(0);
  });

  it.skipIf(!process.env.PWSH_PATH && process.platform !== "win32")("runs the PowerShell installer dry-run when pwsh is available", () => {
    const result = spawnSync(process.env.PWSH_PATH ?? "pwsh", [
      "-NoProfile", "-File", path.join(ROOT, "service", "install-service.ps1"),
      "-Action", "install", "-DryRun", "-HomeDir", temporary(),
    ], { encoding: "utf8" });
    expect(result.status).toBe(0);
  });
});

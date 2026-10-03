import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadResumeOnRetry, createWorkerSession, workerSessionName } from "../orchestrator/worker-session.mjs";
import { _buildWorkerInvocation, RESUMED_SESSION_PREAMBLE } from "../orchestrator/worker-spawn.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("loadResumeOnRetry", () => {
  let dir;
  const savedEnv = process.env.PFORGE_RESUME_ON_RETRY;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pf-worker-session-"));
    delete process.env.PFORGE_RESUME_ON_RETRY;
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (savedEnv === undefined) delete process.env.PFORGE_RESUME_ON_RETRY;
    else process.env.PFORGE_RESUME_ON_RETRY = savedEnv;
  });

  it("defaults to true without .forge.json", () => {
    expect(loadResumeOnRetry(dir)).toBe(true);
  });

  it("honours resumeOnRetry: false in .forge.json", () => {
    writeFileSync(join(dir, ".forge.json"), JSON.stringify({ resumeOnRetry: false }));
    expect(loadResumeOnRetry(dir)).toBe(false);
  });

  it("ignores a non-boolean value", () => {
    writeFileSync(join(dir, ".forge.json"), JSON.stringify({ resumeOnRetry: "no" }));
    expect(loadResumeOnRetry(dir)).toBe(true);
  });

  it("falls back to the default on invalid JSON", () => {
    writeFileSync(join(dir, ".forge.json"), "{ not json");
    expect(loadResumeOnRetry(dir)).toBe(true);
  });

  it("PFORGE_RESUME_ON_RETRY=0 overrides the config", () => {
    writeFileSync(join(dir, ".forge.json"), JSON.stringify({ resumeOnRetry: true }));
    process.env.PFORGE_RESUME_ON_RETRY = "0";
    expect(loadResumeOnRetry(dir)).toBe(false);
  });

  it("PFORGE_RESUME_ON_RETRY=1 overrides a disabled config", () => {
    writeFileSync(join(dir, ".forge.json"), JSON.stringify({ resumeOnRetry: false }));
    process.env.PFORGE_RESUME_ON_RETRY = "1";
    expect(loadResumeOnRetry(dir)).toBe(true);
  });
});

describe("createWorkerSession", () => {
  it("creates a fresh pinned session on the first attempt", () => {
    const session = createWorkerSession({ enabled: true });
    const first = session.forAttempt(0);
    expect(first.id).toMatch(UUID);
    expect(first.resume).toBe(false);
  });

  it("resumes the same session on later attempts", () => {
    const session = createWorkerSession({ enabled: true });
    const { id } = session.forAttempt(0);
    session.record({ sessionId: id, exitCode: 1 });
    expect(session.forAttempt(1)).toEqual({ id, resume: true });
    session.record({ sessionId: id, exitCode: 1 });
    expect(session.forAttempt(2)).toEqual({ id, resume: true });
  });

  it("adopts the session ID the worker reported (SDK fresh-session fallback)", () => {
    const session = createWorkerSession({ enabled: true });
    session.forAttempt(0);
    session.record({ sessionId: "11111111-2222-3333-4444-555555555555" });
    expect(session.forAttempt(1)).toEqual({ id: "11111111-2222-3333-4444-555555555555", resume: true });
  });

  it("does not resume before any attempt was recorded", () => {
    const session = createWorkerSession({ enabled: true });
    session.forAttempt(0);
    expect(session.forAttempt(1).resume).toBe(false);
  });

  it("starts fresh on the next attempt when the worker did not pin a session", () => {
    const session = createWorkerSession({ enabled: true });
    const { id } = session.forAttempt(0);
    session.record({ exitCode: 1 });
    const next = session.forAttempt(1);
    expect(next.resume).toBe(false);
    expect(next.id).not.toBe(id);
  });

  it("returns null for every attempt when disabled", () => {
    const session = createWorkerSession({ enabled: false });
    expect(session.forAttempt(0)).toBeNull();
    session.record({ sessionId: "x" });
    expect(session.forAttempt(1)).toBeNull();
  });

  it("gives each slice its own session", () => {
    const a = createWorkerSession({ enabled: true }).forAttempt(0);
    const b = createWorkerSession({ enabled: true }).forAttempt(0);
    expect(a.id).not.toBe(b.id);
  });
});

describe("_buildWorkerInvocation — session pinning", () => {
  const SESSION = "0cb916db-26aa-40f2-86b5-1ba81b225fd2";
  const base = { promptFile: "/tmp/p.md", prompt: "do it", model: "gpt-6-luna" };

  it("pins the Copilot CLI session when the probe found --session-id", () => {
    const chosen = { name: "gh-copilot", features: { sessionPinning: true } };
    const inv = _buildWorkerInvocation({ ...base, chosen, sessionId: SESSION });
    expect(inv.cmd).toBe("copilot");
    expect(inv.args).toContain(`--session-id=${SESSION}`);
    expect(inv.sessionId).toBe(SESSION);
  });

  it("keeps the bare prompt-file mention for a first attempt", () => {
    const chosen = { name: "gh-copilot", features: { sessionPinning: true } };
    const inv = _buildWorkerInvocation({ ...base, chosen, sessionId: SESSION });
    expect(inv.args).toContain("@/tmp/p.md");
    expect(inv.resumed).toBe(false);
  });

  it("turns the prompt into an explicit instruction when resuming", () => {
    const chosen = { name: "gh-copilot", features: { sessionPinning: true } };
    const inv = _buildWorkerInvocation({ ...base, chosen, sessionId: SESSION, resume: true });
    expect(inv.args).not.toContain("@/tmp/p.md");
    expect(inv.args).toContain("Carry out the instructions in @/tmp/p.md now.");
    expect(inv.resumed).toBe(true);
  });

  it("does not report a resume when the CLI cannot pin the session", () => {
    const chosen = { name: "gh-copilot", features: { sessionPinning: false } };
    const inv = _buildWorkerInvocation({ ...base, chosen, sessionId: SESSION, resume: true });
    expect(inv.args).toContain("@/tmp/p.md");
    expect(inv.resumed).toBe(false);
  });

  it("pins the session on the gh copilot fallback invocation too", () => {
    const chosen = { name: "gh-copilot", usingFallback: true, features: { sessionPinning: true } };
    const inv = _buildWorkerInvocation({ ...base, chosen, sessionId: SESSION });
    expect(inv.cmd).toBe("gh");
    expect(inv.args).toContain(`--session-id=${SESSION}`);
  });

  it("does not pin when the installed CLI lacks --session-id", () => {
    const chosen = { name: "gh-copilot", features: { sessionPinning: false } };
    const inv = _buildWorkerInvocation({ ...base, chosen, sessionId: SESSION });
    expect(inv.args.some((a) => a.startsWith("--session-id"))).toBe(false);
    expect(inv.sessionId).toBeNull();
  });

  it("does not pin without a session ID", () => {
    const chosen = { name: "gh-copilot", features: { sessionPinning: true } };
    const inv = _buildWorkerInvocation({ ...base, chosen });
    expect(inv.args.some((a) => a.startsWith("--session-id"))).toBe(false);
    expect(inv.sessionId).toBeNull();
  });

  it("does not pin workers whose invocation declares no sessionArg", () => {
    const chosen = { name: "grok", features: { sessionPinning: true } };
    const inv = _buildWorkerInvocation({ ...base, chosen, sessionId: SESSION });
    expect(inv.args.some((a) => a.includes(SESSION))).toBe(false);
    expect(inv.sessionId).toBeNull();
  });
});

describe("RESUMED_SESSION_PREAMBLE", () => {
  it("tells a resumed worker to act without asking", () => {
    expect(RESUMED_SESSION_PREAMBLE).toMatch(/did not pass validation/);
    expect(RESUMED_SESSION_PREAMBLE).toMatch(/non-interactive/);
    expect(RESUMED_SESSION_PREAMBLE).toMatch(/do not ask for confirmation/);
    expect(RESUMED_SESSION_PREAMBLE.endsWith("\n\n")).toBe(true);
  });
});

describe("workerSessionName", () => {
  it("names the session after the plan and slice", () => {
    expect(workerSessionName({ planName: "Phase-31-SAFER-RUNS-PLAN", slice: { number: "3", title: "Resume sessions on retry" } }))
      .toBe("pforge Phase-31-SAFER-RUNS-PLAN - slice 3: Resume sessions on retry");
  });

  it("drops characters a Windows command line would interpret", () => {
    const name = workerSessionName({ planName: "p", slice: { number: "1", title: 'Fix "a" & b | c > d % e ^ f (g) !h' } });
    expect(name).not.toMatch(/[&|<>^%!()"]/);
    expect(name).toBe("pforge p - slice 1: Fix a b c d e f g h");
  });

  it("caps the length", () => {
    expect(workerSessionName({ planName: "p", slice: { number: "1", title: "x".repeat(200) } }).length).toBeLessThanOrEqual(80);
  });

  it("is carried on every attempt", () => {
    const sessions = createWorkerSession({ enabled: true, name: "pforge p - slice 1: t" });
    expect(sessions.forAttempt(0)).toMatchObject({ resume: false, name: "pforge p - slice 1: t" });
  });
});

describe("_buildWorkerInvocation — session naming", () => {
  const SESSION = "0cb916db-26aa-40f2-86b5-1ba81b225fd2";
  const base = { promptFile: "/tmp/p.md", prompt: "do it", model: "gpt-6-luna" };
  const chosen = { name: "gh-copilot", features: { sessionPinning: true, sessionNaming: true } };

  it("names a new session", () => {
    const inv = _buildWorkerInvocation({ ...base, chosen, sessionId: SESSION, sessionName: "pforge p - slice 1: t" });
    expect(inv.args).toContain("--name=pforge p - slice 1: t");
  });

  it("does not rename a resumed session", () => {
    const inv = _buildWorkerInvocation({ ...base, chosen, sessionId: SESSION, sessionName: "pforge p - slice 1: t", resume: true });
    expect(inv.args.some((a) => a.startsWith("--name"))).toBe(false);
  });

  it("skips naming on a CLI without --name", () => {
    const old = { name: "gh-copilot", features: { sessionPinning: true, sessionNaming: false } };
    const inv = _buildWorkerInvocation({ ...base, chosen: old, sessionId: SESSION, sessionName: "n" });
    expect(inv.args.some((a) => a.startsWith("--name"))).toBe(false);
  });
});

describe("Guard: slice results carry the worker session", () => {
  const src = readFileSync(resolve(import.meta.dirname, "..", "orchestrator", "run-plan.mjs"), "utf8");
  const builder = src.slice(src.indexOf("function _executeSliceBuildResult"), src.indexOf("function _executeSliceFilesModifiedCheck"));

  it("adds workerSession with a CLI resume command", () => {
    expect(builder).toMatch(/\.\.\._workerSessionInfo\(workerResult\)/);
    expect(builder).toMatch(/resumeCommand: `copilot --resume=\$\{workerResult\.sessionId\}`/);
  });
});

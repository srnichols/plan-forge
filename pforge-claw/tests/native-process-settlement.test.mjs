import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/jobs/worktree.mjs";
import { g1Directory } from "./g1-runner-fixture.mjs";
import { openPosixProcessScope } from "../src/jobs/posix-process-scope.mjs";

vi.mock("node:child_process", { spy: true });

// +60000ms covers real process startup, native snapshots and Windows CI scheduling, not settlement proof.
const NATIVE_TOLERANCE_MS = 60_000;
const PRE_READY_CANCELLATION_MS = 3_000;
const PRE_READY_MARKER = "CLAW_TEST_PRE_READY_SIGTERM_REFUSAL";
const fixtures = [];

async function fixture() {
  const root = await g1Directory("native-process-settlement-");
  const value = { root, pids: [], scripts: [] };
  fixtures.push(value);
  return value;
}

async function nativeAlive(pid) {
  try { process.kill(pid, 0); } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
  if (process.platform === "win32") return true;
  const completed = await run("ps", ["-o", "stat=", "-p", String(pid)]);
  return completed.code === 0 && !completed.stdout.trim().startsWith("Z");
}

async function cleanupOwnedFixture(value) {
  for (const script of value.scripts) {
    try { value.pids.push(Number(await readFile(`${script}.pid`, "utf8"))); } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const pids = [...new Set(value.pids)].filter((pid) => Number.isSafeInteger(pid) && pid > 0);
  if (process.platform === "win32" && pids.length) {
    const stopped = await run("pwsh", ["-NoProfile", "-NonInteractive", "-Command", `
      $ErrorActionPreference = "Stop"
      foreach ($ownedProcessId in (ConvertFrom-Json $env:NATIVE_SETTLEMENT_PIDS)) {
        $owned = Get-Process -Id $ownedProcessId -ErrorAction SilentlyContinue
        if ($null -eq $owned) { continue }
        $null = $owned.Handle
        $identity = Get-CimInstance Win32_Process -Filter ("ProcessId = " + [int]$ownedProcessId)
        if ($null -eq $identity -or $null -eq $identity.CommandLine -or
          -not $identity.CommandLine.Contains($env:NATIVE_SETTLEMENT_ROOT, [StringComparison]::OrdinalIgnoreCase)) { continue }
        Stop-Process -Id $ownedProcessId -Force -ErrorAction Stop
        if (-not $owned.WaitForExit(10000)) { throw "owned native fixture did not stop" }
      }
      exit 0
    `], { env: { ...process.env, NATIVE_SETTLEMENT_ROOT: value.root, NATIVE_SETTLEMENT_PIDS: JSON.stringify(pids) },
      timeoutMs: NATIVE_TOLERANCE_MS });
    expect(stopped.code, stopped.stderr).toBe(0);
  } else {
    for (const pid of pids) {
      const actor = await run("ps", ["-o", "command=", "-p", String(pid)]);
      if (actor.code === 0 && actor.stdout.includes(value.root) && await nativeAlive(pid)) {
        process.kill(pid, "SIGKILL");
      }
    }
  }
  for (const pid of pids) {
    await vi.waitFor(async () => expect(await nativeAlive(pid)).toBe(false), {
      timeout: NATIVE_TOLERANCE_MS, interval: 50,
    });
  }
  await rm(value.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

afterEach(async () => {
  for (const value of fixtures.splice(0)) await cleanupOwnedFixture(value);
});

describe("native owned process settlement", () => {
  it.runIf(process.platform === "linux")("sends private stop when cancellation precedes READY and the actual native root refuses SIGTERM", async () => {
    const value = await fixture();
    const marker = path.join(value.root, "never-started.json");
    const script = path.join(value.root, "never-started.mjs");
    await writeFile(script, `import { writeFileSync } from "node:fs";writeFileSync(${JSON.stringify(marker)},"started");`);
    const original = await vi.importActual("node:child_process");
    const controller = new AbortController();
    const overdue = Promise.withResolvers();
    const onRootReady = vi.fn();
    let root;
    let closed;
    let timer;
    vi.mocked(spawn).mockImplementation((command, args, options) => {
      let forwarded = args;
      if (path.basename(command) === "pwsh") {
        const index = args.indexOf("-EncodedCommand") + 1;
        const bootstrap = Buffer.from(args[index], "base64").toString("utf16le");
        const refusal = `
          Add-Type -TypeDefinition 'public static class ClawTestSignalRefusal {
            static System.Runtime.InteropServices.PosixSignalRegistration registration;
            public static void Install() {
              registration = System.Runtime.InteropServices.PosixSignalRegistration.Create(
                System.Runtime.InteropServices.PosixSignal.SIGTERM, context => context.Cancel = true);
            }
          }'
          [ClawTestSignalRefusal]::Install()
          [Console]::Error.WriteLine("${PRE_READY_MARKER}")
        `;
        forwarded = [...args];
        forwarded[index] = Buffer.from(refusal + bootstrap, "utf16le").toString("base64");
      }
      const child = original.spawn(command, forwarded, options);
      if (path.basename(command) === "pwsh") {
        root = child;
        value.pids.push(child.pid);
        closed = new Promise((resolve) => child.once("close", resolve));
        child.stderr.on("data", (chunk) => {
          if (timer || !chunk.toString().includes(PRE_READY_MARKER)) return;
          // +0ms preserves the existing native control bound; a real runtime marker selects the failure phase.
          timer = setTimeout(() => overdue.reject(new Error("PRE_READY_CANCELLATION_STALLED")), PRE_READY_CANCELLATION_MS);
          controller.abort();
        });
      }
      return child;
    });
    const running = run(process.execPath, [script], {
      cwd: value.root, requireSettlement: true, signal: controller.signal, onRootReady,
    });
    try {
      const result = await Promise.race([running, overdue.promise]);
      expect(result.error?.code).toBe("JOB_CANCELLED");
      expect(result.settlementConfirmed).toBe(false);
      expect(onRootReady).not.toHaveBeenCalled();
      await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
      expect(root.exitCode !== null || root.signalCode !== null).toBe(true);
      expect(root.connected).toBe(false);
    } finally {
      clearTimeout(timer);
      vi.mocked(spawn).mockRestore();
      if (root?.exitCode === null && root.signalCode === null) {
        const scope = await openPosixProcessScope({ rootPid: root.pid, rootProcess: root });
        expect((await scope.terminate()).settlementConfirmed).toBe(true);
        await scope.close();
      }
      await closed;
      await running;
    }
  }, 15_000);

  it("establishes a real held native root before repeated fast argv execution and proves its awaited stop", async () => {
    const value = await fixture();
    const script = path.join(value.root, "fast.mjs");
    await writeFile(script, `
      import { writeFileSync } from "node:fs";
      writeFileSync(import.meta.filename + ".pid", String(process.pid));
      process.stdout.write(JSON.stringify({argv:process.argv.slice(2),value:process.env.NATIVE_SETTLEMENT_VALUE}));
      process.stderr.write("stderr");
    `);
    const args = [script, 'literal "quote" and space', "$not-a-shell;$(not-run)", "trailing\\"];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const completed = await run(process.execPath, args, {
        env: { ...process.env, NATIVE_SETTLEMENT_VALUE: "in-memory-fixture-value" },
        cwd: value.root, requireSettlement: true, timeoutMs: NATIVE_TOLERANCE_MS,
        onRootReady: async (receipt) => {
          value.pids.push(receipt.rootPid);
          await expect(readFile(`${script}.pid`, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
        },
      });
      expect(completed.code, completed.stderr).toBe(0);
      expect(JSON.parse(completed.stdout)).toEqual({
        argv: args.slice(1), value: "in-memory-fixture-value",
      });
      expect(completed.stderr).toBe("stderr");
      expect(completed.settlementConfirmed, JSON.stringify(completed.settlement)).toBe(true);
      expect(completed.settlement.rootReady).toBe(true);
      expect(completed.settlement.rootPid).toBeGreaterThan(0);
      expect(completed.settlement.stoppedPids).toContain(completed.settlement.rootPid);
      expect(await nativeAlive(completed.settlement.rootPid)).toBe(false);
      await rm(`${script}.pid`);
    }
  }, NATIVE_TOLERANCE_MS);

  it("provides real readiness and settlement proof for an otherwise empty fast native Git status", async () => {
    const value = await fixture();
    const repo = path.join(value.root, "repo");
    await mkdir(repo);
    expect((await run("git", ["init", "-b", "main", repo])).code).toBe(0);
    const completed = await run("git", ["-C", repo, "status", "--porcelain"], {
      requireSettlement: true, timeoutMs: NATIVE_TOLERANCE_MS,
    });
    expect(completed, JSON.stringify(completed.settlement)).toMatchObject({
      code: 0, stdout: "", stderr: "", settlementConfirmed: true,
    });
    expect(completed.settlement.rootReady).toBe(true);
    expect(completed.settlement.stoppedPids.length).toBeGreaterThan(0);
  }, NATIVE_TOLERANCE_MS);

  it("awaits cancelled owned Node to detached Node descendants and leaves an unrelated sibling alive", async () => {
    const value = await fixture();
    const parent = path.join(value.root, "parent.mjs");
    const leaf = path.join(value.root, "leaf.mjs");
    const control = path.join(value.root, "control.mjs");
    value.scripts.push(parent, leaf, control);
    await writeFile(leaf, `
      import { writeFileSync } from "node:fs";
      writeFileSync(import.meta.filename + ".pid", String(process.pid));
      setInterval(() => {}, 1000);
    `);
    await writeFile(parent, `
      import { spawn } from "node:child_process";
      import { writeFileSync } from "node:fs";
      writeFileSync(import.meta.filename + ".pid", String(process.pid));
      spawn(process.execPath, [${JSON.stringify(leaf)}], {detached:true,stdio:"ignore",shell:false}).unref();
      setInterval(() => {}, 1000);
    `);
    await writeFile(control, `
      import { writeFileSync } from "node:fs";
      writeFileSync(import.meta.filename + ".pid", String(process.pid));
      setInterval(() => {}, 1000);
    `);
    const sibling = spawn(process.execPath, [control], { stdio: "ignore", shell: false });
    sibling.on("error", (error) => { value.controlError = error; });
    if (sibling.pid) value.pids.push(sibling.pid);
    await vi.waitFor(async () => expect(Number(await readFile(`${control}.pid`, "utf8"))).toBeGreaterThan(0));
    const controller = new AbortController();
    const pending = run(process.execPath, [parent], {
      cwd: value.root, signal: controller.signal, requireSettlement: true, timeoutMs: NATIVE_TOLERANCE_MS,
      onRootReady: (receipt) => value.pids.push(receipt.rootPid),
    });
    try {
      await vi.waitFor(async () => {
        expect(Number(await readFile(`${parent}.pid`, "utf8"))).toBeGreaterThan(0);
        expect(Number(await readFile(`${leaf}.pid`, "utf8"))).toBeGreaterThan(0);
      }, { timeout: NATIVE_TOLERANCE_MS, interval: 50 });
      const parentPid = Number(await readFile(`${parent}.pid`, "utf8"));
      const leafPid = Number(await readFile(`${leaf}.pid`, "utf8"));
      value.pids.push(parentPid, leafPid);
      controller.abort();
      const completed = await pending;
      expect(await nativeAlive(parentPid)).toBe(false);
      expect(await nativeAlive(leafPid)).toBe(false);
      expect(completed, JSON.stringify(completed.settlement)).toMatchObject({
        code: -1, error: { code: "JOB_CANCELLED" }, settlementConfirmed: true,
      });
      expect(completed.settlement.stoppedPids).toContain(leafPid);
      expect(value.controlError).toBeUndefined();
      expect(await nativeAlive(sibling.pid)).toBe(true);
    } finally {
      controller.abort();
      await cleanupOwnedFixture({ ...value, root: value.root });
      expect((await pending).code).toBe(-1);
    }
  }, NATIVE_TOLERANCE_MS);

  it("keeps ordinary callers unchanged and bounds UTF-8 output across both streams in explicit mode", async () => {
    const value = await fixture();
    const script = path.join(value.root, "output.mjs");
    await writeFile(script, 'process.stdout.write("😀".repeat(2048));process.stderr.write("x".repeat(2048));');
    const ordinary = await run(process.execPath, [script], { maxOutput: 127 });
    expect(ordinary.code).toBe(0);
    expect(ordinary.settlementConfirmed).toBeUndefined();
    expect(Buffer.byteLength(ordinary.stdout) + Buffer.byteLength(ordinary.stderr)).toBeLessThanOrEqual(127);
    const completed = await run(process.execPath, [script], {
      maxOutput: 127, requireSettlement: true, timeoutMs: NATIVE_TOLERANCE_MS,
    });
    expect(completed.code).toBe(0);
    expect(completed.settlementConfirmed, JSON.stringify(completed.settlement)).toBe(true);
    expect(Buffer.byteLength(completed.stdout) + Buffer.byteLength(completed.stderr)).toBeLessThanOrEqual(127);
    expect(completed.stdout.includes("\ufffd")).toBe(false);
  }, NATIVE_TOLERANCE_MS);

  it("terminates the natively owned detached actor after its fast parent already exited", async () => {
    const value = await fixture();
    const leaf = path.join(value.root, "escaped-leaf.mjs");
    const parent = path.join(value.root, "escaped-parent.mjs");
    value.scripts.push(leaf, parent);
    await writeFile(leaf, `
      import { writeFileSync } from "node:fs";
      writeFileSync(import.meta.filename + ".pid", String(process.pid));
      setInterval(() => {}, 1000);
    `);
    await writeFile(parent, `
      import { spawn } from "node:child_process";
      import { writeFileSync } from "node:fs";
      writeFileSync(import.meta.filename + ".pid", String(process.pid));
      const actor=spawn(process.execPath,[${JSON.stringify(leaf)}],{detached:true,stdio:"ignore",shell:false});
      actor.unref();
      actor.once("spawn",()=>writeFileSync(${JSON.stringify(`${leaf}.pid`)},String(actor.pid)));
    `);
    const completed = await run(process.execPath, [parent], {
      cwd: value.root, requireSettlement: true, timeoutMs: NATIVE_TOLERANCE_MS,
      onRootReady: (receipt) => value.pids.push(receipt.rootPid),
    });
    await vi.waitFor(async () => expect(Number(await readFile(`${leaf}.pid`, "utf8"))).toBeGreaterThan(0), {
      timeout: NATIVE_TOLERANCE_MS, interval: 50,
    });
    const leafPid = Number(await readFile(`${leaf}.pid`, "utf8"));
    value.pids.push(leafPid);
    expect(completed.code).toBe(0);
    expect(completed.settlementConfirmed, JSON.stringify(completed.settlement)).toBe(true);
    expect(completed.settlement.stoppedPids).toContain(leafPid);
    expect(await nativeAlive(leafPid)).toBe(false);
  }, NATIVE_TOLERANCE_MS);

  it("seals bootstrap loaders but restores the original environment only to the actual argv actor", async () => {
    const value = await fixture();
    const preload = path.join(value.root, "preload.mjs");
    const marker = path.join(value.root, "preload-marker.json");
    const script = path.join(value.root, "env-actor.mjs");
    await writeFile(preload, `
      import { writeFileSync } from "node:fs";
      process.env.NATIVE_PRELOAD_LOADED = "actor-only";
      writeFileSync(${JSON.stringify(marker)}, JSON.stringify({pid:process.pid}));
    `);
    await writeFile(script, 'process.stdout.write(process.env.NATIVE_PRELOAD_LOADED || "missing");');
    const receipts = [];
    const completed = await run(process.execPath, [script], {
      cwd: value.root, requireSettlement: true, timeoutMs: NATIVE_TOLERANCE_MS,
      env: { ...process.env, NODE_OPTIONS: `--import "${pathToFileURL(preload).href}"` },
      onRootReady: async (receipt) => {
        receipts.push(receipt);
        value.pids.push(receipt.rootPid);
        await expect(readFile(marker, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      },
    });
    expect(receipts).toHaveLength(1);
    expect(completed).toMatchObject({ code: 0, stdout: "actor-only", settlementConfirmed: true });
    expect(JSON.parse(await readFile(marker, "utf8")).pid).not.toBe(receipts[0].rootPid);
  }, NATIVE_TOLERANCE_MS);

  it("reports an unstarted pre-aborted operation as unconfirmed, without creating a root", async () => {
    const controller = new AbortController();
    const onRootReady = vi.fn();
    controller.abort();
    const completed = await run(process.execPath, ["-e", "throw new Error('must not run')"], {
      signal: controller.signal, requireSettlement: true, onRootReady,
    });
    expect(completed).toMatchObject({ code: -1, error: { code: "JOB_CANCELLED" }, settlementConfirmed: false });
    expect(onRootReady).not.toHaveBeenCalled();
  });

  it("does not confuse independently born concurrent argv actors with this run's owned execution tree", async () => {
    const value = await fixture();
    const script = path.join(value.root, "concurrent.mjs");
    await writeFile(script, `
      import { writeFileSync } from "node:fs";
      writeFileSync(import.meta.filename + "." + process.argv[2] + ".pid", String(process.pid));
      process.stdout.write(process.argv[2]);
    `);
    const firstReady = Promise.withResolvers();
    const permitFirst = Promise.withResolvers();
    const first = run(process.execPath, [script, "first"], {
      cwd: value.root, requireSettlement: true, timeoutMs: NATIVE_TOLERANCE_MS,
      onRootReady: async (receipt) => {
        value.pids.push(receipt.rootPid);
        firstReady.resolve();
        await permitFirst.promise;
      },
    });
    await firstReady.promise;
    const siblings = ["second", "third", "fourth"].map((id) => run(process.execPath, [script, id], {
      cwd: value.root, requireSettlement: true, timeoutMs: NATIVE_TOLERANCE_MS,
      onRootReady: (receipt) => value.pids.push(receipt.rootPid),
    }));
    permitFirst.resolve();
    const completed = await Promise.all([first, ...siblings]);
    for (const [index, result] of completed.entries()) {
      expect(result.code, JSON.stringify(result)).toBe(0);
      expect(result.settlementConfirmed, JSON.stringify(result.settlement)).toBe(true);
      expect(result.settlement.rootReady).toBe(true);
      expect(result.settlement.stoppedPids).toContain(result.settlement.rootPid);
      expect(result.stdout).toBe(["first", "second", "third", "fourth"][index]);
    }
  }, NATIVE_TOLERANCE_MS);

  it("preserves an independent actor whose birth-qualified creator exits while this root is held", async () => {
    const value = await fixture();
    const creator = path.join(value.root, "independent-creator.mjs");
    const actor = path.join(value.root, "independent-actor.mjs");
    const permit = path.join(value.root, "independent-permit.json");
    value.scripts.push(creator, actor);
    await writeFile(actor, `
      import { writeFileSync } from "node:fs";
      writeFileSync(import.meta.filename + ".pid", String(process.pid));
      setInterval(() => {}, 1000);
    `);
    await writeFile(creator, `
      import { spawn } from "node:child_process";
      import { existsSync, writeFileSync } from "node:fs";
      writeFileSync(import.meta.filename + ".pid", String(process.pid));
      const waiting = setInterval(() => {
        if (!existsSync(${JSON.stringify(permit)})) return;
        clearInterval(waiting);
        const independent = spawn(process.execPath,[${JSON.stringify(actor)}],{
          stdio:"ignore",shell:false,detached:${process.platform === "win32"},
        });
        independent.unref();
        independent.once("spawn",()=>process.exit(0));
      },50);
    `);
    const independent = spawn(process.execPath, [creator], { cwd: value.root, stdio: "ignore", shell: false });
    independent.on("error", (error) => { value.independentError = error; });
    const creatorClosed = new Promise((resolve) => independent.once("close", resolve));
    if (independent.pid) value.pids.push(independent.pid);
    await vi.waitFor(async () => expect(Number(await readFile(`${creator}.pid`, "utf8"))).toBeGreaterThan(0), {
      timeout: NATIVE_TOLERANCE_MS, interval: 50,
    });
    const completed = await run(process.execPath, ["-e", "process.stdout.write('owned fast argv')"], {
      cwd: value.root, requireSettlement: true, timeoutMs: NATIVE_TOLERANCE_MS,
      onRootReady: async (receipt) => {
        value.pids.push(receipt.rootPid);
        await writeFile(permit, "{}");
        // +15000ms bounds fixture readiness; only the actual creator close supplies birth/exit proof.
        await Promise.race([
          creatorClosed,
          new Promise((_, reject) => {
            const timer = setTimeout(() => reject(new Error("independent creator did not exit")), 15_000);
            timer.unref();
            creatorClosed.finally(() => clearTimeout(timer));
          }),
        ]);
        await vi.waitFor(async () => expect(Number(await readFile(`${actor}.pid`, "utf8"))).toBeGreaterThan(0), {
          timeout: NATIVE_TOLERANCE_MS, interval: 50,
        });
        value.pids.push(Number(await readFile(`${actor}.pid`, "utf8")));
      },
    });
    expect(value.independentError).toBeUndefined();
    expect(completed.code, JSON.stringify(completed)).toBe(0);
    expect(completed.settlementConfirmed, JSON.stringify({
      ...completed.settlement, independentCreatorPid: independent.pid,
      independentActorPid: Number(await readFile(`${actor}.pid`, "utf8")),
    })).toBe(true);
    expect(completed.stdout).toBe("owned fast argv");
    const actorPid = Number(await readFile(`${actor}.pid`, "utf8"));
    expect(await nativeAlive(actorPid)).toBe(true);
    expect(completed.settlement.stoppedPids).not.toContain(actorPid);
  }, NATIVE_TOLERANCE_MS);

  it("settles only its native scope when an independent unobserved creator exits", async () => {
    const value = await fixture();
    const actor = path.join(value.root, "unobserved-independent-actor.mjs");
    const owned = path.join(value.root, "waiting-owned.mjs");
    const release = path.join(value.root, "owned-release.json");
    value.scripts.push(actor, owned);
    await writeFile(actor, `
      import { writeFileSync } from "node:fs";
      writeFileSync(import.meta.filename + ".pid", String(process.pid));
      setInterval(() => {},1000);
    `);
    await writeFile(owned, `
      import { existsSync, writeFileSync } from "node:fs";
      writeFileSync(import.meta.filename + ".pid", String(process.pid));
      const waiting=setInterval(()=>{
        if(existsSync(${JSON.stringify(release)})){clearInterval(waiting);process.stdout.write("owned complete");}
      },50);
    `);
    const executing = run(process.execPath, [owned], {
      cwd: value.root, requireSettlement: true, timeoutMs: NATIVE_TOLERANCE_MS,
      onRootReady: (receipt) => value.pids.push(receipt.rootPid),
    });
    await vi.waitFor(async () => expect(Number(await readFile(`${owned}.pid`, "utf8"))).toBeGreaterThan(0), {
      timeout: NATIVE_TOLERANCE_MS, interval: 50,
    });
    const creator = spawn(process.execPath, ["--input-type=module", "-e", `
      const {spawn}=await import("node:child_process");
      const child=spawn(process.execPath,[process.argv[1]],{
        stdio:"ignore",shell:false,detached:true,
      });child.unref();child.once("spawn",()=>process.exit(0));
    `, actor], { cwd: value.root, stdio: "ignore", shell: false });
    if (creator.pid) value.pids.push(creator.pid);
    await new Promise((resolve, reject) => {
      creator.once("close", resolve);
      creator.once("error", reject);
    });
    await vi.waitFor(async () => expect(Number(await readFile(`${actor}.pid`, "utf8"))).toBeGreaterThan(0), {
      timeout: NATIVE_TOLERANCE_MS, interval: 50,
    });
    const actorPid = Number(await readFile(`${actor}.pid`, "utf8"));
    value.pids.push(actorPid);
    await writeFile(release, "{}");
    const completed = await executing;
    const evidence = {
      status: "independent-native-scope-settlement",
      independentCreatorPid: creator.pid, independentActorPid: actorPid,
      independentActorStillAlive: await nativeAlive(actorPid),
      code: completed.code, settlement: completed.settlement,
    };
    const evidenceFile = path.resolve("..", ".forge", "audit", "pforge-claw-native-scope-independent-actor.json");
    await mkdir(path.dirname(evidenceFile), { recursive: true });
    await writeFile(evidenceFile, JSON.stringify(evidence, null, 2));
    expect(completed.code).toBe(0);
    expect(completed.stdout).toBe("owned complete");
    expect(completed.settlementConfirmed, JSON.stringify(completed.settlement)).toBe(true);
    expect(evidence.independentActorStillAlive).toBe(true);
    expect(completed.settlement.stoppedPids).not.toContain(actorPid);
  }, NATIVE_TOLERANCE_MS);
});

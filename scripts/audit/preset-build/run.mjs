#!/usr/bin/env node
/**
 * Preset build runner (#309 Shared Contract).
 *
 *   node scripts/audit/preset-build/run.mjs --stack <name> [--docker-only]
 *
 * Without `--docker-only`: extracts a stack to a temp dir (via extract.mjs),
 * starts any `services` containers the compile manifest declares, runs its
 * `check` command inside `image`, then builds and health-checks every
 * `dockerfile` entry declared in docker/<stack>/manifest.json (if any).
 * Prints a PASS/FAIL line per stage. Exits 1 on any FAIL, 2 on a usage or
 * environment error.
 *
 * With `--docker-only`: skips the compile-check path entirely (and the
 * compile manifest it depends on, which several stacks don't have yet) and
 * only builds + health-checks docker/<stack>/manifest.json's `dockerfile`
 * entries. A stack with no docker manifest trivially passes with zero
 * builds — this is how rust and swift (compile-only today) stay green.
 *
 * See docker/<stack>/manifest.json for each stack's documented Dockerfile
 * coverage and the Dockerfile-build helpers below for the build/run/poll
 * mechanics.
 */

import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest } from "./extract.mjs";
import { codeBlocks, readPreset } from "../preset-quality.mjs";

const REPO = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const PRESETS_ROOT = join(REPO, "presets");
const DOCKER_ROOT = join(REPO, "scripts", "audit", "preset-build", "docker");
const HEALTH_TIMEOUT_MS = 60_000;

function parseArgs(argv) {
  const out = { dockerOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === "--stack") out.stack = argv[++i];
    else if (key === "--docker-only") out.dockerOnly = true;
  }
  return out;
}

/** Run a command, streaming output; return `{ ok, status }`. */
function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  return { ok: result.status === 0, status: result.status };
}

function dockerAvailable() {
  const result = spawnSync("docker", ["info"], { stdio: "ignore" });
  return result.status === 0;
}

/** Start one `services` container (image) on `network`, return its name. */
function startService(name, image, network) {
  const containerName = `preset-build-${name}-${randomUUID().slice(0, 8)}`;
  const env = name === "postgres" ? ["-e", "POSTGRES_PASSWORD=postgres", "-e", "POSTGRES_DB=preset_build"] : [];
  const { ok } = run("docker", [
    "run", "-d", "--rm",
    "--name", containerName,
    "--network", network,
    ...env,
    image,
  ]);
  if (!ok) throw new Error(`failed to start service container ${name} (${image})`);
  return containerName;
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Poll until a Postgres service container accepts connections, or throw. */
function waitForPostgres(containerName, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = spawnSync("docker", ["exec", containerName, "pg_isready", "-U", "postgres"], { stdio: "ignore" });
    if (result.status === 0) {
      // `pg_isready` can return 0 during the brief window between Postgres's
      // init-then-restart startup phases; confirm with a real query before
      // trusting it, with a short settle delay either way.
      sleepMs(500);
      const probe = spawnSync("docker", ["exec", containerName, "psql", "-U", "postgres", "-c", "SELECT 1;"], { stdio: "ignore" });
      if (probe.status === 0) return;
    }
    sleepMs(500);
  }
  throw new Error(`postgres service container ${containerName} did not become ready within ${timeoutMs}ms`);
}

function stopContainer(containerName) {
  spawnSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });
}

/** Run the manifest's `check` command for `stack` inside `image`, with any
 * declared `services` started first. Returns `{ ok }`. */
function runCheck({ stack, buildDir, outDir, manifest }) {
  const network = `preset-build-net-${randomUUID().slice(0, 8)}`;
  const serviceContainers = [];
  const createdNetwork = run("docker", ["network", "create", network]).ok;
  if (!createdNetwork) return { ok: false };

  try {
    const envArgs = [];
    for (const [name, image] of Object.entries(manifest.services ?? {})) {
      const containerName = startService(name, image, network);
      serviceContainers.push(containerName);
      if (name === "postgres") {
        waitForPostgres(containerName);
        envArgs.push("-e", `DATABASE_URL=postgres://postgres:postgres@${containerName}:5432/preset_build`);
      }
    }

    const migrationsDir = join(outDir, "migrations");
    if (existsSync(migrationsDir) && serviceContainers.length) {
      const pgContainer = serviceContainers.find((c) => c.startsWith("preset-build-postgres-"));
      if (pgContainer) {
        const sqlFiles = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
        for (const file of sqlFiles) {
          const sql = readFileSync(join(migrationsDir, file), "utf8");
          const applied = spawnSync("docker", ["exec", "-i", pgContainer, "psql", "-U", "postgres", "-d", "preset_build"], {
            input: sql,
            stdio: ["pipe", "inherit", "inherit"],
          });
          if (applied.status !== 0) return { ok: false };
        }
      }
    }

    // The scaffold commits its own Cargo.lock for reproducible `--locked`
    // checks; only (re)generate one here as a fallback if it's missing.
    const setup = "apt-get update -qq && apt-get install -y -qq pkg-config libssl-dev >/dev/null 2>&1 || true";
    const lockfile = "[ -f Cargo.lock ] || cargo generate-lockfile >/dev/null 2>&1 || true";
    const checkCmd = manifest.check ?? "echo 'no check command in manifest' && exit 1";
    const script = stack === "rust" ? `${setup}; ${lockfile}; ${checkCmd}` : checkCmd;

    const { ok } = run("docker", [
      "run", "--rm",
      "--network", network,
      ...envArgs,
      "-v", `${outDir}:/work`,
      "-w", "/work",
      manifest.image,
      "bash", "-c", script,
    ]);
    return { ok };
  } finally {
    for (const c of serviceContainers) stopContainer(c);
    spawnSync("docker", ["network", "rm", network], { stdio: "ignore" });
  }
}

// ─── Dockerfile builds (#309 Slice 4) ──────────────────────────────────────
//
// A stack's Dockerfile coverage lives separately from its compile manifest,
// in scripts/audit/preset-build/docker/<stack>/manifest.json + scaffold/.
// This keeps rust and swift's existing compile manifests untouched (out of
// this slice's scope) and lets stacks with no compile harness yet (dotnet,
// go, java, python, typescript, php) get Dockerfile coverage on its own.
//
// The manifest/validation shape mirrors extract.mjs's `blocks`/`skip`
// contract, but extract.mjs's validator can't be reused directly: it assumes
// one "main language" per manifest (`language ?? stack`), whereas a docker
// manifest always cares about `dockerfile`-lang blocks regardless of the
// stack's main language.

/** Every `dockerfile` fenced block of presets/<stack>, indexed per file from 0. */
function indexDockerfileBlocks(stack) {
  const files = readPreset(join(PRESETS_ROOT, stack));
  const index = [];
  for (const file of files) {
    let i = 0;
    for (const block of codeBlocks(file.text)) {
      if (block.lang !== "dockerfile") continue;
      index.push({ file: file.rel, index: i, block });
      i++;
    }
  }
  return index;
}

/** `file\tindex` key shared by docker manifest entries and indexed blocks. */
function dockerfileEntryKey(file, index) {
  return `${file}\t${index}`;
}

/** Read scripts/audit/preset-build/docker/<stack>/manifest.json, or `null`
 * if the stack has no documented Dockerfile coverage yet. */
function loadDockerManifest(stack) {
  const path = join(DOCKER_ROOT, stack, "manifest.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Validate a docker manifest against presets/<stack>: every `dockerfile`
 * block must appear in `dockerfile` or `skip` (the latter needs a `reason`),
 * and every entry must resolve to a block that still exists. */
function validateDockerManifest(stack, manifest) {
  const indexed = indexDockerfileBlocks(stack);
  const byKey = new Map(indexed.map((e) => [dockerfileEntryKey(e.file, e.index), e]));
  const mapped = new Set();
  const stale = [];

  for (const entry of manifest.dockerfile ?? []) {
    const key = dockerfileEntryKey(entry.file, entry.index);
    if (!byKey.has(key)) { stale.push(`dockerfile: ${key}`); continue; }
    mapped.add(key);
  }
  for (const entry of manifest.skip ?? []) {
    const key = dockerfileEntryKey(entry.file, entry.index);
    if (!entry.reason) { stale.push(`skip: ${key} (missing reason)`); continue; }
    if (!byKey.has(key)) { stale.push(`skip: ${key}`); continue; }
    mapped.add(key);
  }

  const unmapped = indexed.map((e) => dockerfileEntryKey(e.file, e.index)).filter((key) => !mapped.has(key));
  return { unmapped, stale, byKey };
}

/** Apply `{{token}}`-style substitutions before a Dockerfile block is
 * written. Mirrors extract.mjs's private `applyFill`, duplicated here
 * because extract.mjs isn't in this slice's scope and doesn't export it. */
function applyDockerFill(body, fill) {
  if (!fill) return body;
  return Object.entries(fill).reduce((out, [token, value]) => out.split(token).join(value), body);
}

/** Host port Docker published for `containerPort` of `containerName`, or
 * `null` if it isn't published. */
function findHostPort(containerName, containerPort) {
  const result = spawnSync("docker", ["port", containerName, String(containerPort)], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout) return null;
  const line = result.stdout.trim().split("\n")[0];
  const port = Number(line.split(":").pop());
  return Number.isFinite(port) ? port : null;
}

/** Poll an HTTP health path until it answers 2xx, or `timeoutMs` elapses. */
async function pollHttpHealth(url, timeoutMs) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return { ok: true };
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { ok: false, error: lastError ?? new Error("timed out") };
}

/** Liveness fallback for runtimes with no plain HTTP front end to poll
 * (FastCGI-only php-fpm images — see docker/php/manifest.json). Settles
 * briefly, then confirms the container is still running. */
async function pollProcessHealth(containerName) {
  await new Promise((r) => setTimeout(r, 3000));
  const result = spawnSync("docker", ["inspect", "-f", "{{.State.Running}}", containerName], { encoding: "utf8" });
  if (result.status === 0 && result.stdout.trim() === "true") return { ok: true };
  return { ok: false, error: new Error("container is not running") };
}

/** Build and health-check one `dockerfile` entry: copy docker/<stack>/scaffold
 * (or `entry.scaffold`) to a temp dir, write the preset's Dockerfile block
 * over `entry.to` (default `Dockerfile`), build the image, run it, and poll
 * `entry.healthPath` (default `/health`) on `entry.port` (default `8080`)
 * for up to 60s. */
async function buildDockerfileEntry(stack, entry, block) {
  const scaffoldDir = join(DOCKER_ROOT, stack, entry.scaffold ?? "scaffold");
  const outDir = mkdtempSync(join(tmpdir(), `preset-build-docker-${stack}-`));
  const tag = `preset-build-${stack}-${randomUUID().slice(0, 8)}`;
  let containerName;
  try {
    cpSync(scaffoldDir, outDir, { recursive: true });
    const target = join(outDir, entry.to ?? "Dockerfile");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, applyDockerFill(block.body, entry.fill));

    const built = run("docker", ["build", "-t", tag, outDir]);
    if (!built.ok) return { ok: false, reason: "docker build failed" };

    containerName = `preset-build-${stack}-c-${randomUUID().slice(0, 8)}`;
    const port = entry.port ?? 8080;
    const started = run("docker", ["run", "-d", "--rm", "--name", containerName, "-p", `127.0.0.1::${port}`, tag]);
    if (!started.ok) return { ok: false, reason: "docker run failed" };

    if (entry.protocol === "fastcgi") {
      const health = await pollProcessHealth(containerName);
      if (!health.ok) return { ok: false, reason: health.error.message };
      return { ok: true };
    }

    const hostPort = findHostPort(containerName, port);
    if (!hostPort) return { ok: false, reason: "container did not publish its port" };

    const healthPath = entry.healthPath ?? "/health";
    const health = await pollHttpHealth(`http://127.0.0.1:${hostPort}${healthPath}`, HEALTH_TIMEOUT_MS);
    if (!health.ok) return { ok: false, reason: `health check failed: ${health.error.message}` };
    return { ok: true };
  } finally {
    if (containerName) stopContainer(containerName);
    spawnSync("docker", ["rmi", "-f", tag], { stdio: "ignore" });
    rmSync(outDir, { recursive: true, force: true });
  }
}

/** Build and health-check every documented `dockerfile` entry of a stack's
 * docker manifest. A stack with no docker/<stack>/manifest.json (rust, swift
 * today) trivially passes with zero builds. */
async function runDockerfileBuilds(stack) {
  const manifest = loadDockerManifest(stack);
  if (!manifest) return { ok: true, builds: 0 };

  const { unmapped, stale, byKey } = validateDockerManifest(stack, manifest);
  if (unmapped.length || stale.length) {
    for (const e of stale) console.error(`docker manifest stale\t${e}`);
    for (const e of unmapped) console.error(`docker manifest unmapped\t${e}`);
    return { ok: false, builds: 0 };
  }

  let builds = 0;
  for (const entry of manifest.dockerfile ?? []) {
    const { block } = byKey.get(dockerfileEntryKey(entry.file, entry.index));
    console.log(`docker build ${stack}: ${entry.file}[${entry.index}] -> ${entry.to ?? "Dockerfile"}`);
    const result = await buildDockerfileEntry(stack, entry, block);
    if (!result.ok) {
      console.error(`FAIL ${stack} dockerfile ${entry.file}[${entry.index}]: ${result.reason}`);
      return { ok: false, builds };
    }
    builds++;
  }
  return { ok: true, builds };
}

async function main() {
  const { stack, dockerOnly } = parseArgs(process.argv.slice(2));
  if (!stack) {
    console.error("usage: run.mjs --stack <name> [--docker-only]");
    return 2;
  }
  if (!dockerAvailable()) {
    console.error(`FAIL ${stack}: docker is not available`);
    return 2;
  }

  if (dockerOnly) {
    // Independent of the compile-check path below: a stack can have
    // Dockerfile coverage (docker/<stack>/manifest.json) without a compile
    // scaffold (dotnet, go, java, python, typescript, php today don't have
    // one), so --docker-only never touches extract.mjs or the compile
    // manifest.
    const docker = await runDockerfileBuilds(stack);
    if (!docker.ok) {
      console.error(`FAIL ${stack}: dockerfile build/health-check`);
      return 1;
    }
    console.log(docker.builds > 0
      ? `PASS ${stack}: ${docker.builds} dockerfile block(s) built and health-checked`
      : `PASS ${stack}: no dockerfile blocks configured for docker build yet`);
    return 0;
  }

  const buildDir = join(REPO, "scripts", "audit", "preset-build", stack);
  const manifest = loadManifest(buildDir);
  const outDir = mkdtempSync(join(tmpdir(), `preset-build-${stack}-`));

  try {
    const extracted = run("node", [join(REPO, "scripts", "audit", "preset-build", "extract.mjs"), "--stack", stack, "--out", outDir]);
    if (!extracted.ok) {
      console.error(`FAIL ${stack}: extract.mjs failed validation`);
      return 1;
    }

    const { ok } = runCheck({ stack, buildDir, outDir, manifest });
    if (!ok) {
      console.error(`FAIL ${stack}: ${manifest.check}`);
      return 1;
    }
    console.log(`PASS ${stack}: ${manifest.check}`);

    const docker = await runDockerfileBuilds(stack);
    if (!docker.ok) {
      console.error(`FAIL ${stack}: dockerfile build/health-check`);
      return 1;
    }
    console.log(docker.builds > 0
      ? `PASS ${stack}: ${docker.builds} dockerfile block(s) built and health-checked`
      : `PASS ${stack}: no dockerfile blocks configured for docker build yet`);
    return 0;
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => { process.exitCode = code; })
    .catch((err) => {
      console.error(`run: ${err.message}`);
      process.exitCode = 2;
    });
}

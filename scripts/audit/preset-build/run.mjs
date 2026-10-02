#!/usr/bin/env node
/**
 * Preset build runner (#309 Shared Contract).
 *
 *   node scripts/audit/preset-build/run.mjs --stack <name> [--docker-only]
 *
 * Extracts a stack to a temp dir (via extract.mjs), starts any `services`
 * containers the manifest declares on a private Docker network, runs the
 * manifest's `check` command inside `image`, and prints a PASS/FAIL line.
 * Exits 1 on any FAIL, 2 on a usage or environment error.
 *
 * Scope note (#309 plan-sequencing deviation, Slice 2): the full contract
 * also builds and health-checks every `dockerfile` block (Slice 4). This
 * first cut only implements the `check` step — the part Slice 2's gate
 * needs to validate the Rust crate harness — and treats `--docker-only`
 * as a no-op until Slice 4 adds Dockerfile build support. See the Slice 2
 * trajectory note for the full rationale.
 */

import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest } from "./extract.mjs";

const REPO = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

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

  const buildDir = join(REPO, "scripts", "audit", "preset-build", stack);
  const manifest = loadManifest(buildDir);
  const outDir = mkdtempSync(join(tmpdir(), `preset-build-${stack}-`));

  try {
    const extracted = run("node", [join(REPO, "scripts", "audit", "preset-build", "extract.mjs"), "--stack", stack, "--out", outDir]);
    if (!extracted.ok) {
      console.error(`FAIL ${stack}: extract.mjs failed validation`);
      return 1;
    }

    if (dockerOnly) {
      // Dockerfile build + health-check support ships in Slice 4; nothing
      // to do here yet beyond confirming extraction succeeded.
      console.log(`PASS ${stack}: --docker-only is a no-op pending Slice 4 (Dockerfile builds)`);
      return 0;
    }

    const { ok } = runCheck({ stack, buildDir, outDir, manifest });
    if (!ok) {
      console.error(`FAIL ${stack}: ${manifest.check}`);
      return 1;
    }
    console.log(`PASS ${stack}: ${manifest.check}`);
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

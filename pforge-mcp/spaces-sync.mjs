/**
 * Plan Forge — Copilot Spaces Sync (Phase GITHUB-E).
 *
 * Builds a payload from four local sources and uploads them as versioned files
 * into a designated GitHub Copilot Space.  Unchanged files (matching SHA-256)
 * are skipped to stay within API rate limits.
 *
 * Sources:
 *   1. Active plan  — `.forge/active-plan` pointer → `plan-forge/active-plan.md`
 *   2. Instructions — `.github/instructions/*.instructions.md` → `plan-forge/instructions/<name>.md`
 *   3. Tool catalog — `pforge-mcp/tools.json` (or capabilities snapshot)  → `plan-forge/tool-catalog.md`
 *   4. Project profile — `.github/instructions/project-profile.instructions.md` → `plan-forge/project-profile.md`
 *
 * All API calls are made through the user's `gh` CLI auth.
 * Tests mock `gh` via an injectable `ghCmd` option — no real GitHub API calls in tests.
 *
 * GitHub Copilot Spaces REST API used:
 *   GET  /user/copilot/spaces                         — list user spaces
 *   GET  /orgs/{org}/copilot/spaces                   — list org spaces
 *   GET  /user/copilot/spaces/{id}/files              — list existing files (for SHA comparison)
 *   PUT  /user/copilot/spaces/{id}/files/{path}       — create / update a file
 *
 * @module spaces-sync
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash as _createHash } from "node:crypto";

// ─── Error classes ───────────────────────────────────────────────────────────

export class SpacesSyncError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "SpacesSyncError";
    this.code = code ?? "SPACES_ERROR";
  }
}

export class SpacesAuthError extends SpacesSyncError {
  constructor(message) {
    super(message, "SPACES_AUTH_ERROR");
    this.name = "SpacesAuthError";
  }
}

export class SpacesNotFoundError extends SpacesSyncError {
  constructor(message) {
    super(message, "SPACES_NOT_FOUND");
    this.name = "SpacesNotFoundError";
  }
}

export class SpacesRateLimitError extends SpacesSyncError {
  constructor(message) {
    super(message, "SPACES_RATE_LIMIT");
    this.name = "SpacesRateLimitError";
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Compute SHA-256 hex digest of a UTF-8 string. */
export function sha256(content) {
  return _createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Call `gh api <args>` synchronously.  Returns parsed JSON on success.
 * Throws the appropriate SpacesSyncError subclass on failure.
 *
 * @param {string[]} args  - Arguments after `gh api`
 * @param {string}   ghCmd - Path to the `gh` binary
 * @param {Object}   env   - Process environment override
 */
function ghSpawnConfig(args, ghCmd, env) {
  const isWin = process.platform === "win32";
  return {
    spawnBin: isWin ? "cmd" : ghCmd,
    spawnArg: isWin ? ["/d", "/s", "/c", ghCmd, "api", ...args] : ["api", ...args],
    options: {
      encoding: "utf-8",
      env: env ?? process.env,
      windowsHide: isWin,
    },
  };
}

function parseGhJson(text, fallback) {
  try {
    return JSON.parse(text || "null");
  } catch {
    return fallback;
  }
}

function throwGhApiError(result) {
  const stderr = result.stderr?.trim() ?? "";
  const stdout = result.stdout?.trim() ?? "";
  const body = parseGhJson(stdout || "{}", {});

  if (result.status === 401 || /401|Unauthorized|Bad credentials/i.test(stderr)) {
    throw new SpacesAuthError(
      "gh auth failed — run `gh auth login` or set GH_TOKEN. " +
      "Token needs `copilot_spaces:write` scope."
    );
  }
  if (result.status === 403 || /403|Forbidden/i.test(stderr)) {
    throw new SpacesAuthError(
      "Token lacks `copilot_spaces:write` scope. " +
      "Run `gh auth refresh -s copilot_spaces:write --hostname github.com`."
    );
  }
  if (result.status === 404 || body.message?.includes("Not Found")) {
    throw new SpacesNotFoundError(`Space not found: ${body.message ?? stderr}`);
  }
  if (result.status === 429 || /429|rate limit/i.test(stderr)) {
    throw new SpacesRateLimitError(
      `API rate limit hit. ${stderr.includes("retry-after") ? stderr : "Retry after 60s."}`
    );
  }
  throw new SpacesSyncError(`gh api failed (exit ${result.status}): ${stderr || stdout}`);
}

function ghApi(args, ghCmd, env) {
  const { spawnBin, spawnArg, options } = ghSpawnConfig(args, ghCmd, env);
  const result = spawnSync(spawnBin, spawnArg, options);

  if (result.error) {
    throw new SpacesSyncError(`Failed to spawn gh: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throwGhApiError(result);
  }
  return parseGhJson(result.stdout, result.stdout);
}

// ─── Space discovery ─────────────────────────────────────────────────────────

/**
 * Resolve `owner/name` slug to a Copilot Space ID.
 *
 * Searches the authenticated user's spaces first, then the org's spaces if
 * `owner` looks like an org (not the authed user's own handle).
 *
 * @param {string} spaceRef  - `owner/name` slug
 * @param {Object} opts
 * @param {string} opts.ghCmd
 * @param {Object} [opts.env]
 * @returns {string} space ID
 */
export function findSpace(spaceRef, { ghCmd = "gh", env } = {}) {
  if (!spaceRef || !spaceRef.includes("/")) {
    throw new SpacesSyncError(
      `Invalid space reference "${spaceRef}" — expected "owner/name" format.`
    );
  }

  const [owner, name] = spaceRef.split("/");

  // Try user spaces first
  let spaces;
  try {
    spaces = ghApi(["/user/copilot/spaces"], ghCmd, env);
  } catch (err) {
    if (err instanceof SpacesNotFoundError) spaces = [];
    else throw err;
  }

  if (Array.isArray(spaces)) {
    const match = spaces.find(
      (s) =>
        s.name === name &&
        (s.owner?.login === owner || s.owner?.slug === owner || !s.owner)
    );
    if (match) return match.id ?? match.node_id ?? String(match.number ?? "");
  }

  // Fall back to org spaces
  try {
    const orgSpaces = ghApi(
      [`/orgs/${encodeURIComponent(owner)}/copilot/spaces`],
      ghCmd,
      env
    );
    if (Array.isArray(orgSpaces)) {
      const match = orgSpaces.find((s) => s.name === name);
      if (match) return match.id ?? match.node_id ?? String(match.number ?? "");
    }
  } catch (err) {
    if (!(err instanceof SpacesNotFoundError)) throw err;
  }

  throw new SpacesNotFoundError(
    `Copilot Space "${spaceRef}" not found. ` +
    `Create it at https://github.com/copilot/spaces and try again.`
  );
}

/**
 * Get all org Space names tagged `plan-forge-sync` for org-wide broadcast.
 *
 * @param {string} orgSlug
 * @param {Object} opts
 * @returns {string[]} Array of `owner/name` slugs
 */
export function listOrgSpaces(orgSlug, { ghCmd = "gh", env } = {}) {
  const spaces = ghApi(
    [`/orgs/${encodeURIComponent(orgSlug)}/copilot/spaces`],
    ghCmd,
    env
  );
  if (!Array.isArray(spaces)) return [];
  return spaces
    .filter((s) => (s.topics ?? []).includes("plan-forge-sync"))
    .map((s) => `${orgSlug}/${s.name}`);
}

// ─── Payload building ────────────────────────────────────────────────────────

/**
 * Read `.forge/active-plan` to find the active plan file path.
 * Falls back to scanning `docs/plans/` for the most recently modified plan.
 *
 * @param {string} projectRoot
 * @returns {{ spacePath: string, content: string }|null}
 */
export function getActivePlan(projectRoot) {
  const pointerFile = join(projectRoot, ".forge", "active-plan");

  if (existsSync(pointerFile)) {
    const relPath = readFileSync(pointerFile, "utf-8").trim();
    const absPath = join(projectRoot, relPath);
    if (existsSync(absPath)) {
      return {
        spacePath: "plan-forge/active-plan.md",
        localPath: absPath,
        content: readFileSync(absPath, "utf-8"),
      };
    }
  }

  // Fallback: most recently modified plan file
  const plansDir = join(projectRoot, "docs", "plans");
  if (!existsSync(plansDir)) return null;

  let entries;
  try {
    entries = readdirSync(plansDir)
      .filter((f) => f.endsWith("-PLAN.md"))
      .map((f) => {
        const abs = join(plansDir, f);
        try {
          const { mtimeMs } = statSync(abs);
          return { abs, mtimeMs };
        } catch {
          return { abs, mtimeMs: 0 };
        }
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch {
    return null;
  }

  if (!entries.length) return null;
  const { abs } = entries[0];
  return {
    spacePath: "plan-forge/active-plan.md",
    localPath: abs,
    content: readFileSync(abs, "utf-8"),
  };
}

/**
 * Collect `.github/instructions/*.instructions.md` files.
 *
 * @param {string} projectRoot
 * @param {{ includeProjectProfile?: boolean }} [opts]
 * @returns {Array<{ spacePath: string, localPath: string, content: string }>}
 */
export function getInstructionFiles(projectRoot, { includeProjectProfile = true } = {}) {
  const instrDir = join(projectRoot, ".github", "instructions");
  if (!existsSync(instrDir)) return [];

  let files;
  try {
    files = readdirSync(instrDir).filter((f) => f.endsWith(".instructions.md"));
  } catch {
    return [];
  }

  return files.map((f) => {
    const abs = join(instrDir, f);
    const name = f.replace(/\.instructions\.md$/, "");
    // project-profile gets its own top-level space path
    const spacePath =
      f === "project-profile.instructions.md" && includeProjectProfile
        ? "plan-forge/project-profile.md"
        : `plan-forge/instructions/${name}.md`;
    return {
      spacePath,
      localPath: abs,
      content: readFileSync(abs, "utf-8"),
    };
  });
}

/**
 * Build a Markdown tool-catalog summary from `tools.json`.
 *
 * @param {string} projectRoot  - Repo root (parent of pforge-mcp/)
 * @returns {{ spacePath: string, content: string }|null}
 */
export function getToolCatalog(projectRoot) {
  // Try pforge-mcp/tools.json relative to projectRoot (consumer project)
  // and also relative to this module's own package (framework dir).
  const candidates = [
    join(projectRoot, "pforge-mcp", "tools.json"),
    join(projectRoot, "tools.json"),
    new URL("./tools.json", import.meta.url).pathname,
  ];

  let toolsJson = null;
  for (const c of candidates) {
    if (existsSync(c)) {
      try {
        toolsJson = JSON.parse(readFileSync(c, "utf-8"));
        break;
      } catch { /* skip */ }
    }
  }

  if (!toolsJson) return null;

  const tools = Array.isArray(toolsJson) ? toolsJson : [];
  const lines = [
    "# Plan Forge Tool Catalog",
    "",
    `> Generated by \`pforge sync-spaces\`. ${tools.length} tools available.`,
    "",
    "| Tool | Description |",
    "|------|-------------|",
  ];

  for (const t of tools) {
    const desc = (t.description ?? "").split("\n")[0].slice(0, 100);
    lines.push(`| \`${t.name}\` | ${desc} |`);
  }

  return {
    spacePath: "plan-forge/tool-catalog.md",
    content: lines.join("\n") + "\n",
  };
}

/**
 * Build the full sync payload.
 *
 * @param {string} projectRoot
 * @param {{ noInstructions?: boolean }} [opts]
 * @returns {Array<{ spacePath: string, content: string, digest: string }>}
 */
export function buildPayload(projectRoot, { noInstructions = false } = {}) {
  const items = [];

  // 1. Active plan
  const plan = getActivePlan(projectRoot);
  if (plan) {
    items.push({ spacePath: plan.spacePath, content: plan.content });
  }

  // 2. Instruction files
  if (!noInstructions) {
    const instrs = getInstructionFiles(projectRoot);
    items.push(...instrs.map((i) => ({ spacePath: i.spacePath, content: i.content })));
  }

  // 3. Tool catalog
  const catalog = getToolCatalog(projectRoot);
  if (catalog) {
    items.push({ spacePath: catalog.spacePath, content: catalog.content });
  }

  // Attach digests
  return items.map((item) => ({
    ...item,
    digest: sha256(item.content),
  }));
}

// ─── Upload ──────────────────────────────────────────────────────────────────

/**
 * Fetch existing file SHAs from a space to enable skip-unchanged optimization.
 *
 * @param {string} spaceId
 * @param {Object} opts
 * @returns {Map<string, string>}  spacePath → sha256
 */
export function getExistingFileShas(spaceId, { ghCmd = "gh", env } = {}) {
  let files;
  try {
    files = ghApi([`/user/copilot/spaces/${encodeURIComponent(spaceId)}/files`], ghCmd, env);
  } catch {
    return new Map();
  }

  const map = new Map();
  if (!Array.isArray(files)) return map;
  for (const f of files) {
    if (f.path && f.sha) map.set(f.path, f.sha);
  }
  return map;
}

/**
 * Upload a single file to a Copilot Space.
 *
 * @param {string} spaceId
 * @param {string} spacePath
 * @param {string} content    - UTF-8 file content
 * @param {Object} opts
 */
export function uploadFile(spaceId, spacePath, content, { ghCmd = "gh", env } = {}) {
  const encoded = Buffer.from(content, "utf-8").toString("base64");
  ghApi(
    [
      "-X", "PUT",
      `/user/copilot/spaces/${encodeURIComponent(spaceId)}/files/${encodeURIComponent(spacePath)}`,
      "--raw-field", `content=${encoded}`,
      "--field", "encoding=base64",
    ],
    ghCmd,
    env
  );
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * @typedef {Object} SyncResult
 * @property {string[]} uploaded - Space paths that were uploaded
 * @property {string[]} skipped  - Space paths that were unchanged
 * @property {string[]} dryRun   - Space paths that WOULD be uploaded (dry-run only)
 * @property {boolean}  dryRunMode
 * @property {string}   spaceRef - Resolved `owner/name` target
 */

/**
 * Sync Plan Forge artifacts to a GitHub Copilot Space.
 *
 * @param {Object} opts
 * @param {string}   opts.projectRoot    - Repo root to scan for artifacts
 * @param {string}   [opts.spaceRef]     - `owner/name` override; else reads .forge.json
 * @param {string}   [opts.org]          - Org slug for broadcast mode (--org)
 * @param {boolean}  [opts.dryRun]       - Print without uploading
 * @param {boolean}  [opts.force]        - Re-upload even if SHA matches
 * @param {boolean}  [opts.noInstructions] - Skip instruction files
 * @param {string}   [opts.ghCmd]        - Path to `gh` binary (default: "gh")
 * @param {Object}   [opts.env]          - Process environment override
 * @returns {SyncResult|SyncResult[]}    Array if org broadcast; single result otherwise
 */
export function syncSpaces({
  projectRoot,
  spaceRef,
  org,
  dryRun = false,
  force = false,
  noInstructions = false,
  ghCmd = "gh",
  env,
} = {}) {
  if (!projectRoot) throw new SpacesSyncError("projectRoot is required");

  // Resolve target(s)
  const targets = resolveTargets({ projectRoot, spaceRef, org, ghCmd, env });

  if (org) {
    // Broadcast mode: return an array of per-space results
    return targets.map((ref) =>
      _syncOne({ projectRoot, spaceRef: ref, dryRun, force, noInstructions, ghCmd, env })
    );
  }

  return _syncOne({ projectRoot, spaceRef: targets[0], dryRun, force, noInstructions, ghCmd, env });
}

function resolveTargets({ projectRoot, spaceRef, org, ghCmd, env }) {
  if (org) {
    const refs = listOrgSpaces(org, { ghCmd, env });
    if (!refs.length) {
      throw new SpacesNotFoundError(
        `No Copilot Spaces in org "${org}" are tagged "plan-forge-sync". ` +
        "Add the topic to each Space you want to broadcast to."
      );
    }
    return refs;
  }

  // Single target: explicit flag > .forge.json > default "plan-forge"
  const ref = spaceRef ?? readForgeJsonSpacesTarget(projectRoot);
  if (!ref) {
    throw new SpacesSyncError(
      'No Space target specified. Use --space <owner/name>, set github.spacesTarget in .forge.json, ' +
      'or create a Space named "plan-forge" in your org.'
    );
  }
  return [ref];
}

function readForgeJsonSpacesTarget(projectRoot) {
  const configPath = join(projectRoot, ".forge.json");
  if (!existsSync(configPath)) return null;
  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    return config?.github?.spacesTarget ?? null;
  } catch {
    return null;
  }
}

function _syncOne({ projectRoot, spaceRef, dryRun, force, noInstructions, ghCmd, env }) {
  const payload = buildPayload(projectRoot, { noInstructions });

  if (dryRun) {
    return {
      spaceRef,
      uploaded: [],
      skipped: [],
      dryRun: payload.map((p) => p.spacePath),
      dryRunMode: true,
    };
  }

  const spaceId = findSpace(spaceRef, { ghCmd, env });
  const existingShas = force ? new Map() : getExistingFileShas(spaceId, { ghCmd, env });

  const uploaded = [];
  const skipped = [];

  for (const item of payload) {
    const existingSha = existingShas.get(item.spacePath);
    if (!force && existingSha === item.digest) {
      skipped.push(item.spacePath);
      continue;
    }
    uploadFile(spaceId, item.spacePath, item.content, { ghCmd, env });
    uploaded.push(item.spacePath);
  }

  return { spaceRef, uploaded, skipped, dryRun: [], dryRunMode: false };
}

// ─── CLI entry point (when run directly via node spaces-sync.mjs) ────────────
// Consumed by pforge.ps1 / pforge.sh via: node spaces-sync.mjs <json-opts>

if (process.argv[1] && process.argv[1].endsWith("spaces-sync.mjs")) {
  const raw = process.argv[2];
  if (!raw) {
    console.error("Usage: node spaces-sync.mjs <json-opts>");
    process.exit(1);
  }

  let opts;
  try {
    opts = JSON.parse(raw);
  } catch (e) {
    console.error(`Invalid JSON opts: ${e.message}`);
    process.exit(1);
  }

  try {
    const result = syncSpaces(opts);
    if (opts.dryRun) {
      const r = Array.isArray(result) ? result : [result];
      r.forEach((res) => {
        console.log(`[dry-run] Would upload ${res.dryRun.length} file(s) to ${res.spaceRef}:`);
        res.dryRun.forEach((p) => console.log(`  - ${p}`));
      });
    } else {
      const results = Array.isArray(result) ? result : [result];
      results.forEach((res) => {
        console.log(`✓ ${res.spaceRef}: ${res.uploaded.length} uploaded, ${res.skipped.length} unchanged`);
        res.uploaded.forEach((p) => console.log(`  ↑ ${p}`));
        if (res.skipped.length) console.log(`  (skipped: ${res.skipped.join(", ")})`);
      });
    }
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(
      err instanceof SpacesAuthError ? 1 :
      err instanceof SpacesNotFoundError ? 1 : 2
    );
  }
}

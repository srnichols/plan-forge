import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  JOB_TYPES,
  JOB_STATES,
  LANE_KINDS,
  VISIBILITY,
  ROLES,
  LANE_EVENT_TYPES,
  SUBCOMMANDS,
} from "../src/enums.mjs";
import { ClawError } from "../src/errors.mjs";
import { bus, EVENT_NAMES } from "../src/events.mjs";
import { FEATURES } from "../src/features/index.mjs";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(PACKAGE_ROOT, "..");
const THIS_TEST = path.resolve(fileURLToPath(import.meta.url));
const APPROVE_ALL = "approve" + "All";
const EXEC = "ex" + "ec";
const EXEC_SYNC = EXEC + "Sync";
const CHILD_PROCESS = "child_" + "process";
const CLAW_PACKAGE_DIR = "pforge-" + "claw";
const FORBIDDEN_PACKAGE_NAMES = ["pforge-" + "mcp", "pforge-" + "master", "pforge-" + "sdk"];
const READABLE_EXTENSIONS = new Set([".mjs", ".js", ".json", ".md", ".yml", ".yaml", ".sh", ".ps1"]);
const ALLOWED_HOSTS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "localhost",
  "127.0.0.1",
  "api.telegram.org",
  "registry.npmjs.org",
  "github.com",
  "api.github.com",
  "api.githubcopilot.com",
  "copilot-proxy.githubusercontent.com",
  "copilot-telemetry.githubusercontent.com",
  "objects.githubusercontent.com",
]);
const K8S_API_GROUPS = new Set([
  "rbac.authorization.k8s.io",
  "networking.k8s.io",
  "kustomize.config.k8s.io",
]);
const COPILOT_HOST_SUFFIX = "githubcopilot.com";
const IMPORT_SPECIFIER = /\b(?:from\s*|import\s*|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;
const GITHUB_OWNER_PATTERN = new RegExp(
  "github\\.com\\/(?!<[^>]+>)([A-Za-z0-9-]+)",
  "i",
);
const LONG_CHAT_ID_PATTERN = /-100\d{6,}/;
const KEYED_LONG_ID_PATTERN = /\b(?:chat|id|user)[\w-]*\b["']?\s*[:=]\s*["']?\d{9,}\b|\b\d{9,}\b["']?\s*[:=]\s*["']?\b(?:chat|id|user)[\w-]*\b/i;
const DRIVE_USER_PATH_PATTERN = /[A-Za-z]:\\(?:Users|home)\\/i;
const UNIX_HOME_PATTERN = /\/(?:Users|home)\/[^/\s]+/;
const PRIVATE_IP_PATTERN = /\b(?:10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.(?:\d{1,3}\.)\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.(?:\d{1,3}\.)\d{1,3})\b/;
const FQDN_PATTERN = /\b(?:(?:https?:\/\/)?)([a-z\d-]+(?:\.[a-z\d-]+)+)\b/gi;
const TLD_PATTERN = /\.(?:com|org|net|io|dev|app|co|ai|invalid)$/i;
const EXEC_IMPORT_PATTERN = new RegExp(
  `\\bimport\\b[^;]*\\b${EXEC}(?:Sync)?\\b[^;]*\\bfrom\\s*["'](?:node:)?${CHILD_PROCESS}["']|\\brequire\\s*\\(\\s*["'](?:node:)?${CHILD_PROCESS}["']\\s*\\)`,
);
const EXEC_STRING_PATTERN = new RegExp(
  `\\b${EXEC}(?:Sync)?\\s*\\(\\s*(?:\`|["'][^"']*["']\\s*\\+)`,
);
const PACKAGE = "pforge-" + "claw";

function walkPackage(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "fixtures" && path.basename(directory) === "tests") continue;
      walkPackage(fullPath, files);
    } else if (
      entry.isFile()
      && (READABLE_EXTENSIONS.has(path.extname(entry.name)) || entry.name.startsWith("Dockerfile"))
      && path.resolve(fullPath) !== THIS_TEST
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

const packageFiles = walkPackage(PACKAGE_ROOT);
const sources = packageFiles.map((file) => ({
  file,
  relative: path.relative(PACKAGE_ROOT, file),
  text: readFileSync(file, "utf8"),
}));

function hasForbiddenImport({ file, text }) {
  IMPORT_SPECIFIER.lastIndex = 0;
  let match;
  while ((match = IMPORT_SPECIFIER.exec(text)) !== null) {
    const specifier = match[1];
    if (FORBIDDEN_PACKAGE_NAMES.some((name) => specifier.startsWith(`${name}/`))
      || FORBIDDEN_PACKAGE_NAMES.some((name) => specifier === `@pforge/${name}`)) {
      return true;
    }
    if (!specifier.startsWith(".")) continue;
    const target = path.resolve(path.dirname(file), specifier);
    const relative = path.relative(PACKAGE_ROOT, target);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return true;
  }
  return false;
}

function hasUnapprovedHost(text) {
  FQDN_PATTERN.lastIndex = 0;
  let match;
  while ((match = FQDN_PATTERN.exec(text)) !== null) {
    const host = match[1].toLowerCase();
    if (!TLD_PATTERN.test(host)) continue;
    if (ALLOWED_HOSTS.has(host)) continue;
    if (K8S_API_GROUPS.has(host)) continue;
    if (host.endsWith(`.${COPILOT_HOST_SUFFIX}`) || host.endsWith(".example")) continue;
    return true;
  }
  return false;
}

const detectorSamples = [
  {
    name: "chat identifiers",
    detect: (text) => LONG_CHAT_ID_PATTERN.test(text) || KEYED_LONG_ID_PATTERN.test(text),
    bad: `chat_id: -1001234567`,
    safe: `chat_id: 42`,
  },
  {
    name: "user paths",
    detect: (text) => DRIVE_USER_PATH_PATTERN.test(text) || UNIX_HOME_PATTERN.test(text),
    bad: String.raw`C:\Users\operator\project`,
    safe: "C:\\workspace\\project",
  },
  {
    name: "private IP addresses",
    detect: (text) => PRIVATE_IP_PATTERN.test(text),
    bad: "10.24.3.8",
    safe: "203.0.113.8",
  },
  {
    name: "GitHub owner URLs",
    detect: (text) => GITHUB_OWNER_PATTERN.test(text),
    bad: "https://github.com/operator/project",
    safe: "https://github.com/<owner>/project",
  },
  {
    name: "unapproved FQDNs",
    detect: hasUnapprovedHost,
    bad: "https://operator-host.invalid",
    safe: "https://example.com",
  },
];

const expectedEnums = {
  JOB_TYPES: ["ask", "capture", "skill", "plan", "task", "fanout"],
  JOB_STATES: [
    "queued",
    "awaiting-approval",
    "approved",
    "rejected",
    "expired",
    "held-budget",
    "leased",
    "running",
    "needs-input",
    "succeeded",
    "failed",
    "cancelled",
  ],
  LANE_KINDS: ["local", "remote", "k8s"],
  VISIBILITY: ["normal", "restricted"],
  ROLES: ["owner", "approver", "viewer"],
  LANE_EVENT_TYPES: ["started", "progress", "log", "slice", "cost", "artifact", "needs-input", "finished"],
  SUBCOMMANDS: ["init", "doctor", "status", "start", "worker", "service", "dev", "commands"],
};

describe("Guard: pforge-claw imports no Plan Forge package source", () => {
  it("contains no relative escape or forbidden package import", () => {
    for (const source of sources) {
      expect(hasForbiddenImport(source), source.relative).toBe(false);
    }
  });

  it("is clean in the repository dependency-boundary audit", () => {
    const auditScript = path.join(REPO_ROOT, "scripts", "audit", "dep-boundaries.mjs");
    const result = spawnSync(process.execPath, [auditScript, "--json"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.findings.filter((finding) => finding.sourcePackage === PACKAGE)).toEqual([]);
  });
});

describe("Guard: no approveAll", () => {
  it("does not contain the forbidden approval shortcut", () => {
    for (const source of sources) {
      expect(source.text, source.relative).not.toMatch(new RegExp(`\\b${APPROVE_ALL}\\b`));
    }
  });
});

describe("Guard: no exec( / execSync( with template strings", () => {
  it("does not interpolate shell commands or import exec APIs", () => {
    for (const source of sources) {
      expect(source.text, source.relative).not.toMatch(EXEC_STRING_PATTERN);
      expect(source.text, source.relative).not.toMatch(EXEC_IMPORT_PATTERN);
    }
  });
});

describe("Guard: no operator-specific values", () => {
  it("passes the detector self-tests", () => {
    for (const sample of detectorSamples) {
      expect(sample.detect(sample.bad), `${sample.name} should catch its bad sample`).toBe(true);
      expect(sample.detect(sample.safe), `${sample.name} should accept its safe sample`).toBe(false);
    }
  });

  it("allows only the exact Kubernetes API group hostnames", () => {
    for (const host of K8S_API_GROUPS) {
      expect(hasUnapprovedHost(host), host).toBe(false);
    }
    expect(hasUnapprovedHost("extension.rbac.authorization.k8s.io")).toBe(true);
  });

  it("contains no operator-specific values", () => {
    for (const detector of detectorSamples) {
      for (const source of sources) {
        expect(detector.detect(source.text), `${source.relative}: ${detector.name}`).toBe(false);
      }
    }
  });
});

describe("scaffold contract", () => {
  it.each(Object.entries(expectedEnums))("%s is frozen and exact", async (name, expected) => {
    const enums = await import("../src/enums.mjs");
    expect(Object.isFrozen(enums[name])).toBe(true);
    expect(enums[name]).toEqual(expected);
  });

  it("matches SUBCOMMANDS one-to-one with CLI modules", () => {
    const cliDirectory = path.join(PACKAGE_ROOT, "src", "cli");
    const moduleNames = readdirSync(cliDirectory)
      .filter((name) => name.endsWith(".mjs") && name !== "_stub.mjs")
      .map((name) => name.slice(0, -4))
      .sort();
    expect([...SUBCOMMANDS].sort()).toEqual(moduleNames);
  });

  it("registers the 11 unique unavailable feature stubs", () => {
    expect(FEATURES).toHaveLength(11);
    expect(new Set(FEATURES.map((feature) => feature.name)).size).toBe(FEATURES.length);
    for (const feature of FEATURES) {
      expect(feature.available).toBe(false);
      expect(feature.snapshot()).toBeNull();
    }
  });

  it("preserves the ClawError contract", () => {
    const error = new ClawError("EXAMPLE", { secret: "not printed" });
    expect(error).toMatchObject({
      name: "ClawError",
      message: "EXAMPLE",
      code: "EXAMPLE",
      details: { secret: "not printed" },
    });
  });

  it("delivers bus events and exposes the event names", () => {
    expect(Object.isFrozen(EVENT_NAMES)).toBe(true);
    expect(EVENT_NAMES).toEqual(["job.transition", "job.finished", "lane.event"]);
    const payload = { jobId: "test" };
    const listener = vi.fn();
    bus.once(EVENT_NAMES[0], listener);
    bus.emit(EVENT_NAMES[0], payload);
    expect(listener).toHaveBeenCalledWith(payload);
  });
});

describe("CLI dispatch", () => {
  function runCli(...args) {
    return spawnSync(process.execPath, [path.join(PACKAGE_ROOT, "cli.mjs"), ...args], {
      cwd: PACKAGE_ROOT,
      encoding: "utf8",
    });
  }

  it.each(SUBCOMMANDS)("%s help succeeds and dispatches its current command contract", (subcommand) => {
    const help = runCli(subcommand, "--help");
    expect(help.status, help.stderr).toBe(0);
    expect(help.stdout).toMatch(new RegExp(`Usage: pforge claw ${subcommand}`));

    const result = runCli(subcommand);
    if (subcommand === "init") {
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(new RegExp(`Usage: pforge claw ${subcommand}`));
    } else if (subcommand === "doctor") {
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("Setup status: incomplete");
    } else if (subcommand === "commands") {
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("sinceSlice");
    } else {
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/not yet implemented \(Slice \d+\)/);
    }
  });

  it("returns 1 for unknown commands", () => {
    const unknown = runCli("unknown-command");
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain("Usage: pforge claw");
  });
});

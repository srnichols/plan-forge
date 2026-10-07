/**
 * `dotnet test` commands filtered to named test classes, in the syntax the
 * project's runner accepts (meta-bug #318).
 *
 *   VSTest (default)        dotnet test "<proj>" --filter "FullyQualifiedName~A|FullyQualifiedName~B"
 *   MTP + xUnit v3          dotnet test --project "<proj>" --filter-class "*A*" --filter-class "*B*"
 *   MTP + other frameworks  dotnet test --project "<proj>" --filter "FullyQualifiedName~A|FullyQualifiedName~B"
 *
 * MTP mode is the .NET 10 SDK opt-in — global.json `"test": { "runner": "Microsoft.Testing.Platform" }`,
 * read from the nearest global.json at or above the working directory, as the SDK does.
 * In that mode `dotnet test` takes the project through --project, and xUnit v3's MTP
 * runner only accepts --filter-class / --filter-method / --filter-trait / --filter-query,
 * not VSTest --filter expressions. MSTest and NUnit on MTP still accept --filter.
 *
 * A leaf module (fs/path only) shared by the impact gate and forge_fix_proposal.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";

const MTP_RUNNER_PATTERN = /"test"\s*:\s*\{[^}]*"runner"\s*:\s*"Microsoft\.Testing\.Platform"/i;
// xunit.v3 / xunit.v3.core, plain or with an explicit .mtp-v1 / .mtp-v2 flavour; the
// .mtp-off flavours run on VSTest and keep accepting --filter.
const XUNIT_V3_MTP_PATTERN = /<PackageReference\b[^>]*\bInclude\s*=\s*["']xunit\.v3(?:\.core)?(?:\.mtp-v[12])?["']/i;
const TEST_PROJECT_PATTERN = /<PackageReference\b[^>]*\bInclude\s*=\s*["'](?:xunit|mstest|nunit|tunit|microsoft\.net\.test\.sdk)|\bSdk\s*=\s*["']MSTest\.Sdk|<IsTestProject>\s*true\s*</i;
const PROJECT_SCAN_SKIP_DIRS = Object.freeze(["bin", "obj", "node_modules", "packages", "artifacts", "TestResults"]);
const PROJECT_SCAN_MAX_DEPTH = 6;

const quote = (value) => `"${value}"`;

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** True when the nearest global.json at or above `cwd` opts `dotnet test` into Microsoft.Testing.Platform. */
export function usesMtpRunner(cwd) {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    const text = readText(join(dir, "global.json"));
    if (text !== null) return MTP_RUNNER_PATTERN.test(text);
    if (dirname(dir) === dir) return false;
  }
}

/** The project file plus every Directory.Build.props between it and `cwd`, where package references can also live. */
function projectDefinition(cwd, projectRel) {
  const root = resolve(cwd);
  const parts = [readText(join(root, projectRel)) ?? ""];
  for (let dir = dirname(join(root, projectRel)); ; dir = dirname(dir)) {
    parts.push(readText(join(dir, "Directory.Build.props")) ?? "");
    if (dir === root || !dir.startsWith(root) || dirname(dir) === dir) break;
  }
  return parts.join("\n");
}

/** True when `projectRel` (relative to `cwd`) references xUnit v3 with Microsoft.Testing.Platform support. */
export function isXunitV3MtpProject(cwd, projectRel) {
  return XUNIT_V3_MTP_PATTERN.test(projectDefinition(cwd, projectRel));
}

/** Test projects under `cwd` (posix paths relative to it), skipping build output and dependency trees. */
export function findDotnetTestProjects(cwd) {
  const root = resolve(cwd);
  const found = [];
  const pending = [{ dir: root, depth: 0 }];
  while (pending.length > 0) {
    const { dir, depth } = pending.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skip = entry.name.startsWith(".") || PROJECT_SCAN_SKIP_DIRS.includes(entry.name);
        if (!skip && depth < PROJECT_SCAN_MAX_DEPTH) pending.push({ dir: join(dir, entry.name), depth: depth + 1 });
      } else if (entry.isFile() && entry.name.endsWith(".csproj")) {
        const rel = relative(root, join(dir, entry.name)).split("\\").join(posix.sep);
        if (TEST_PROJECT_PATTERN.test(projectDefinition(root, rel))) found.push(rel);
      }
    }
  }
  return found.sort();
}

function usesXunitV3Filters(cwd, project) {
  if (project) return isXunitV3MtpProject(cwd, project);
  const projects = findDotnetTestProjects(cwd);
  return projects.length > 0 && projects.every((p) => isXunitV3MtpProject(cwd, p));
}

/**
 * @param {{ cwd: string, project?: string|null, classes: string[] }} options
 *   project: test project relative to cwd; null runs whatever `dotnet test` finds in cwd.
 *   classes: test class names (or name fragments) to run; empty runs everything.
 * @returns {string}
 */
export function buildDotnetTestCommand({ cwd, project = null, classes }) {
  const mtp = usesMtpRunner(cwd);
  const parts = ["dotnet test"];
  if (project) parts.push(mtp ? `--project ${quote(project)}` : quote(project));
  if (classes.length > 0) {
    if (mtp && usesXunitV3Filters(cwd, project)) {
      parts.push(...classes.map((c) => `--filter-class ${quote(`*${c}*`)}`));
    } else {
      parts.push(`--filter ${quote(classes.map((c) => `FullyQualifiedName~${c}`).join("|"))}`);
    }
  }
  return parts.join(" ");
}

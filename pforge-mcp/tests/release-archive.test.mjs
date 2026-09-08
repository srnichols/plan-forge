import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

describe("release archive - consumer templates survive dev exclusions", () => {
  let fixtureDir;

  beforeEach(() => { fixtureDir = mkdtempSync(join(tmpdir(), "pforge-archive-")); });
  afterEach(() => { rmSync(fixtureDir, { recursive: true, force: true }); });

  it("excludes only the maintainer AGENTS.md while retaining preset instructions", () => {
    const git = (...args) => execFileSync("git", args, { cwd: fixtureDir, encoding: "utf8", windowsHide: true });
    git("init", "--quiet");
    const files = [
      "AGENTS.md", "presets/typescript/AGENTS.md", "presets/dotnet/AGENTS.md",
      "templates/AGENTS.md.template", "docs/plans/Phase-99-PLAN.md",
      "docs/plans/examples/Phase-TYPESCRIPT-EXAMPLE.md",
    ];
    for (const file of files) {
      const path = join(fixtureDir, file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "fixture\n");
    }
    writeFileSync(join(fixtureDir, ".gitattributes"), readFileSync(new URL("../../.gitattributes", import.meta.url)));
    git("add", ".");
    git("-c", "user.name=Archive Test", "-c", "user.email=archive@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=disabled-hooks", "commit", "--quiet", "-m", "fixture");
    const archive = join(fixtureDir, "release.tar");
    git("archive", "--format=tar", `--output=${archive}`, "HEAD");
    const paths = execFileSync("tar", ["-tf", archive], { encoding: "utf8", windowsHide: true }).trim().split(/\r?\n/);
    expect(paths).not.toContain("AGENTS.md");
    expect(paths).not.toContain("docs/plans/Phase-99-PLAN.md");
    for (const consumerFile of files.filter((file) => file.startsWith("presets/") || file.startsWith("templates/") || file.includes("/examples/"))) {
      expect(paths, `archive omitted ${consumerFile}`).toContain(consumerFile);
    }
  });
});
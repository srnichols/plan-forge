import { describe, it, expect } from "vitest";
import {
  releaseSegment, nextDevVersion, promoteChangelog, releaseNotes, buildReleaseSteps,
  checkPreconditions, RELEASE_FILES, unexpectedReleaseChanges, previousTagFor,
} from "../../scripts/release/ship.mjs";

const CHANGELOG = [
  "# Changelog",
  "",
  "## [Unreleased]",
  "",
  "### Changed",
  "",
  "- **A thing changed.** Details.",
  "",
  "### Fixed",
  "",
  "- **A thing was fixed.**",
  "",
  "## [3.30.0] — 2026-10-03 — One update plan for both shells",
  "",
  "### Changed",
  "",
  "- older",
  "",
].join("\n");

describe("releaseSegment / nextDevVersion", () => {
  it("classifies the shipped segment", () => {
    expect(releaseSegment("3.31.0")).toBe("minor");
    expect(releaseSegment("3.30.2")).toBe("patch");
    expect(releaseSegment("4.0.0")).toBe("major");
  });

  it("bumps back to the next release of the same kind", () => {
    expect(nextDevVersion("3.30.2")).toBe("3.30.3-dev");
    expect(nextDevVersion("3.31.0")).toBe("3.32.0-dev");
    expect(nextDevVersion("4.0.0")).toBe("5.0.0-dev");
  });

  it("rejects a version that is not X.Y.Z", () => {
    expect(() => nextDevVersion("3.31.0-dev")).toThrow(/X\.Y\.Z/);
  });
});

describe("promoteChangelog", () => {
  it("moves Unreleased under the release heading and keeps an empty Unreleased", () => {
    const out = promoteChangelog(CHANGELOG, { version: "3.31.0", date: "2026-10-04", title: "Safer runs" });
    expect(out).toContain("## [Unreleased]\n\n## [3.31.0] — 2026-10-04 — Safer runs\n\n### Changed\n\n- **A thing changed.**");
    expect(out.indexOf("## [3.31.0]")).toBeLessThan(out.indexOf("## [3.30.0]"));
    expect(out.match(/## \[Unreleased\]/g)).toHaveLength(1);
  });

  it("keeps CRLF line endings", () => {
    const out = promoteChangelog(CHANGELOG.replace(/\n/g, "\r\n"), { version: "3.31.0", date: "2026-10-04", title: "T" });
    expect(out).toContain("## [Unreleased]\r\n\r\n## [3.31.0] — 2026-10-04 — T\r\n");
    expect(out.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("refuses an empty Unreleased section", () => {
    const empty = "## [Unreleased]\n\n## [3.30.0] — 2026-10-03 — x\n\n- old\n";
    expect(() => promoteChangelog(empty, { version: "3.31.0", date: "2026-10-04", title: "T" })).toThrow(/empty/);
  });

  it("refuses a version that is already in the changelog", () => {
    expect(() => promoteChangelog(CHANGELOG, { version: "3.30.0", date: "2026-10-04", title: "T" })).toThrow(/already/);
  });
});

describe("releaseNotes", () => {
  it("returns the body of a release section", () => {
    const promoted = promoteChangelog(CHANGELOG, { version: "3.31.0", date: "2026-10-04", title: "Safer runs" });
    const notes = releaseNotes(promoted, "3.31.0");
    expect(notes.startsWith("### Changed")).toBe(true);
    expect(notes).toContain("A thing was fixed");
    expect(notes).not.toContain("older");
  });
});

describe("unexpectedReleaseChanges", () => {
  it("allows only the version files and the changelog", () => {
    expect(unexpectedReleaseChanges(RELEASE_FILES)).toEqual([]);
    expect(unexpectedReleaseChanges(["VERSION", "pforge-mcp/server.mjs"])).toEqual(["pforge-mcp/server.mjs"]);
  });

  it("allows the synchronized Claw manifest but never arbitrary Claw source or the independent SDK manifest", () => {
    expect(RELEASE_FILES).toContain("pforge-claw/package.json");
    expect(unexpectedReleaseChanges([
      "pforge-claw/package.json", "pforge-claw/src/config.mjs", "pforge-sdk/package.json",
    ])).toEqual(["pforge-claw/src/config.mjs", "pforge-sdk/package.json"]);
  });
});

describe("buildReleaseSteps", () => {
  const steps = buildReleaseSteps({
    version: "3.31.0", title: "Safer runs", date: "2026-10-04", previousTag: "v3.30.0",
    worktree: "/w/release", planningRepo: "/w/main", platform: "linux",
  });
  const ids = steps.map((s) => s.id);

  it("follows the documented release sequence", () => {
    expect(ids).toEqual([
      "sync-to-master", "promote-changelog", "set-version", "release-commit", "rehearse", "push-master",
      "tag", "push-tag", "github-release", "verify-public", "bump-dev", "sync-to-planning", "push-planning",
    ]);
  });

  it("runs the branch steps in the right checkout", () => {
    expect(steps.find((s) => s.id === "sync-to-master").cwd).toBe("/w/release");
    expect(steps.find((s) => s.id === "sync-to-planning").cwd).toBe("/w/main");
  });

  it("uses the platform's sync-master script", () => {
    expect(steps.find((s) => s.id === "sync-to-master").describe).toMatch(/sync-master\.sh to-master/);
    const win = buildReleaseSteps({ version: "3.31.0", title: "T", date: "d", previousTag: "v3.30.0", worktree: "w", planningRepo: "p", platform: "win32" });
    expect(win.find((s) => s.id === "sync-to-master").describe).toMatch(/sync-master\.ps1 -Direction to-master/);
  });

  it("cuts the GitHub release from the worktree, without --repo", () => {
    const release = steps.find((s) => s.id === "github-release");
    expect(release.describe).toMatch(/gh release create v3\.31\.0 --notes-from-tag --verify-tag --title "v3\.31\.0 - Safer runs"/);
    expect(release.describe).not.toMatch(/--repo/);
    expect(release.cwd).toBe("/w/release");
  });

  it("bumps back to the matching dev version", () => {
    expect(steps.find((s) => s.id === "bump-dev").describe).toMatch(/3\.32\.0-dev/);
  });
});

describe("checkPreconditions", () => {
  const baseState = {
    "planning:branch": "planning/main",
    "planning:status": "",
    "planning:ahead-behind": "0\t0",
    "worktree:branch": "master",
    "worktree:status": "",
    tags: "v3.30.0\nv3.29.3",
    "remote-tag": "",
    gh: "ok",
  };
  const fakeExec = (state) => ({ key }) => {
    if (state[key] instanceof Error) throw state[key];
    return state[key];
  };
  const run = (overrides = {}) => checkPreconditions({
    version: "3.31.0", worktree: "/w/release", planningRepo: "/w/main",
    changelog: CHANGELOG, exec: fakeExec({ ...baseState, ...overrides }),
  });

  it("passes on a clean, in-sync setup and reports the previous tag", () => {
    expect(run()).toEqual({ ok: true, problems: [], previousTag: "v3.30.0" });
  });

  it("reports every problem at once", () => {
    const r = run({ "planning:status": " M x", "worktree:branch": "feature", "planning:ahead-behind": "1\t0", gh: new Error("not logged in") });
    expect(r.ok).toBe(false);
    expect(r.problems).toHaveLength(4);
  });

  it("refuses a version that is not newer than the latest tag", () => {
    expect(run({ tags: "v3.31.0\nv3.30.0" }).problems.join(" ")).toMatch(/not newer/);
  });

  it("refuses a tag that already exists on origin", () => {
    expect(run({ "remote-tag": "abc\trefs/tags/v3.31.0" }).problems.join(" ")).toMatch(/already exists on origin/);
  });

  it("refuses an empty Unreleased section", () => {
    const r = checkPreconditions({
      version: "3.31.0", worktree: "w", planningRepo: "p", exec: fakeExec(baseState),
      changelog: "## [Unreleased]\n\n## [3.30.0] — d — t\n",
    });
    expect(r.problems.join(" ")).toMatch(/Unreleased/);
  });
});

describe("previousTagFor", () => {
  it("picks the highest tag below the version, even once the new tag exists", () => {
    expect(previousTagFor("3.31.0", "v3.31.0\nv3.30.0\nv3.29.3")).toBe("v3.30.0");
    expect(previousTagFor("3.30.1", "v3.30.0\nv3.29.3\nnot-a-tag")).toBe("v3.30.0");
    expect(previousTagFor("1.0.0", "")).toBeNull();
  });
});

/**
 * A release check on a file the project gets as written in the checkout must hold for the checkout.
 *
 * scripts/release/release-checks.json is evaluated by the release rehearsal, on a freshly installed project and on an
 * update from the previous release, and by verify-public, on a project that self-updated to the published release.
 * For a file setup and update copy as written, a check is true of the project exactly when it is true of the file
 * here, so it can run on every CI run and not only in the rehearsal, after the release commit is made. Covered:
 * pforge-mcp/, pforge-master/ and pforge-sdk/, pforge.ps1, pforge.sh, validate-setup.*, and agents (the pipeline
 * agents come from templates/.github/agents, a stack's own from its preset, the shared reviewers from
 * presets/shared). Not covered, and still checked only by the rehearsal: files that come from .github/ or a preset
 * (instructions, prompts, skills), hooks, automations and .forge.json.
 *
 * Setup renders seven placeholders (<YOUR PROJECT NAME>, <DATE> and five more) in every Markdown file, agents
 * included, and most agent files carry one; update renders the project name, tech stack and date that .forge.json
 * records in the files it writes. A check on a Markdown file that requires one to be present fails for the project,
 * and an agent check that requires one to be absent fails for the template here, so the tests below fail both. They
 * look for a whole placeholder: a check that pins part of one is still found only by the rehearsal.
 *
 * Nothing did this, and an edit to pforge-mcp/vitest.config.mjs (a second suite on the line the 3.33.0 check pins)
 * failed that check in every rehearsal leg while CI stayed green: release-harness.test.mjs checks only the shape of
 * each entry.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { evaluateFileCheck } from "../../scripts/release/harness.mjs";
import { PLACEHOLDERS } from "../update-guard.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const { checks } = JSON.parse(readFileSync(join(REPO_ROOT, "scripts", "release", "release-checks.json"), "utf8"));

const COPIED_AS_THEY_ARE = /^(pforge-(mcp|master|sdk)\/|pforge\.(ps1|sh)$|validate-setup\.(ps1|sh)$)/;

// What setup.ps1 and setup.sh replace in every Markdown file. A test below holds this list to what they replace.
const RENDERED_AWAY = ["<YOUR PROJECT NAME>", "<YOUR TECH STACK>", "<YOUR BUILD COMMAND>", "<YOUR TEST COMMAND>", "<YOUR LINT COMMAND>", "<YOUR DEV COMMAND>", "<DATE>"];

/** True when the text holds a placeholder setup replaces, which a project's copy of a Markdown file no longer has. */
const holdsPlaceholder = (text) => typeof text === "string" && RENDERED_AWAY.some((token) => text.includes(token));

/** Where this checkout holds the file a project gets for `check`, or null for a file this test does not cover. */
function sourceOf(check) {
  if (COPIED_AS_THEY_ARE.test(check.path)) return check.path;
  if (!check.path.startsWith(".github/agents/")) return null;
  const candidates = [`templates/${check.path}`, ...(check.preset ? [`presets/${check.preset}/${check.path}`] : []), `presets/shared/${check.path}`];
  // With none present the first is returned, so the check fails and names a path that is not there.
  return candidates.find((candidate) => existsSync(join(REPO_ROOT, candidate))) ?? candidates[0];
}

const covered = checks.map((check) => ({ check, source: sourceOf(check) })).filter(({ source }) => source !== null);

/**
 * The checks on a Markdown file that pin a placeholder. A `contains` fails in the rehearsal, because the project's
 * copy has none. A `notContains` holds for the project, and only fails here where the template is what is evaluated.
 */
function placeholderPins(allChecks) {
  return allChecks
    .filter((check) => check.path.endsWith(".md"))
    .filter((check) => holdsPlaceholder(check.contains) || (sourceOf(check) !== null && holdsPlaceholder(check.notContains)))
    .map((check) => `${check.label} (${check.path})`);
}

describe("release checks on files the project gets as written", () => {
  it("are found, so the check below is not vacuous", () => {
    expect(covered.length).toBeGreaterThan(200);
    for (const prefix of ["pforge-mcp/", "pforge-master/", "templates/.github/agents/", "presets/swift/.github/agents/", "pforge.sh", "pforge.ps1"]) {
      expect(covered.some(({ source }) => source.startsWith(prefix)), `no covered check names ${prefix}`).toBe(true);
    }
  });

  it("all hold for this checkout", () => {
    const failing = covered
      .filter(({ check, source }) => !evaluateFileCheck(REPO_ROOT, { ...check, path: source }).ok)
      .map(({ check, source }) => `${check.label} (${check.path}, from ${source})`);
    expect(
      failing,
      "A release check names text this checkout no longer has, so the rehearsal would fail every leg. Keep the text the check pins, or update the check with the change that moves it.",
    ).toEqual([]);
  });
});

describe("a release check on a Markdown file", () => {
  it("pins no placeholder, which setup renders away", () => {
    const markdown = checks.filter((check) => check.path.endsWith(".md"));
    expect(markdown.some((check) => sourceOf(check) !== null), "no agent check, so the covered ones are not looked at").toBe(true);
    expect(markdown.some((check) => sourceOf(check) === null), "no instruction, prompt or skill check, so the rest are not looked at").toBe(true);
    expect(
      placeholderPins(checks),
      "Setup replaces <YOUR PROJECT NAME>, <DATE> and five other placeholders in every Markdown file, so a project's copy has none: a check that requires one fails in the rehearsal, and an agent check that requires one to be absent fails against the template here. Pin text with no placeholder.",
    ).toEqual([]);
  });

  describe("is found out when it pins one", () => {
    const pins = (check) => placeholderPins([{ label: "a check", ...check }]).length === 1;
    const PROMPT = ".github/prompts/step3-execute-slice.prompt.md"; // from .github/, so only the rehearsal evaluates it
    const AGENT = ".github/agents/executor.agent.md"; // evaluated here, against templates/

    it.each(RENDERED_AWAY)("by requiring %s, whichever Markdown file it is on", (token) => {
      expect(pins({ path: PROMPT, contains: `project: "${token}"` })).toBe(true);
      expect(pins({ path: AGENT, contains: `project: "${token}"` })).toBe(true);
    });

    it("by requiring one to be absent from an agent, which the template here still has", () => {
      expect(pins({ path: AGENT, notContains: "<YOUR PROJECT NAME>" })).toBe(true);
    });

    it("but not by requiring one to be absent from a file only the rehearsal evaluates, which holds for the project", () => {
      expect(pins({ path: PROMPT, notContains: "<YOUR PROJECT NAME>" })).toBe(false);
    });

    it("and not for text with no placeholder, a <YOUR ...> that setup does not replace, or a file that is not Markdown", () => {
      expect(pins({ path: PROMPT, contains: "Contract Refs" })).toBe(false);
      expect(pins({ path: AGENT, contains: "tools: [read, search, edit, runCommands, agents]" })).toBe(false);
      expect(pins({ path: PROMPT, contains: "<YOUR CHECK>" })).toBe(false);
      expect(pins({ path: AGENT, contains: "<YOUR CHECK>" })).toBe(false);
      expect(pins({ path: "pforge-mcp/server.mjs", contains: "<DATE>" })).toBe(false);
    });
  });
});

describe("the placeholders setup renders", () => {
  const FUNCTION_BODY = {
    "setup.ps1": /function Update-Placeholders[\s\S]*?\n\}/,
    "setup.sh": /replace_placeholders\(\) \{[\s\S]*?\n\}/,
  };
  const ANY_PLACEHOLDER = /<[A-Z][A-Z0-9 _-]*>/g;

  it.each(["setup.ps1", "setup.sh"])("are the ones the placeholder function in %s names, however it replaces them", (script) => {
    const body = readFileSync(join(REPO_ROOT, script), "utf8").match(FUNCTION_BODY[script])?.[0];
    expect(body, `${script} has no placeholder function this test can read`).toBeDefined();
    const named = new Set(body.match(ANY_PLACEHOLDER));
    expect([...named].sort(), `The placeholder function in ${script} names a different set of placeholders than RENDERED_AWAY lists, so a check on Markdown could pin one this test does not know. Make the two the same.`).toEqual([...RENDERED_AWAY].sort());
  });

  it("include the ones update renders", () => {
    expect(RENDERED_AWAY).toEqual(expect.arrayContaining(PLACEHOLDERS.map(({ token }) => token)));
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * #455 — five pipeline agents list `agents` in `tools:`, and four of them describe a chain in which each starts the
 * next as a nested subagent. `agents` is not a tool name. Measured with the Copilot CLI: an agent that lists it gets
 * no tool that starts another agent. Read from VS Code's source, not run: it is a separate frontmatter attribute, and
 * an unknown tool name is ignored. So the chain has never been run from the files Plan Forge ships, and the guide, the
 * settings template and the manual said it runs.
 *
 * The issue's option A keeps the `tools:` lists and makes the text say so. These tests hold that text: the four agents
 * that describe the chain, the VS Code guide, the settings template and the manual. They do not hold the lists
 * (agent-tools.test.mjs does), so a later decision to give the agents a tool that starts agents changes this text and
 * these tests together.
 */

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const read = (relative) => readFileSync(join(REPO_ROOT, relative), "utf8").replace(/\r\n/g, "\n");

const CHAIN_AGENTS = ["specifier", "plan-hardener", "executor", "reviewer-gate"];

/** The "## Nested Subagent Invocation" section of a pipeline agent, up to the next "## " heading. */
function nestedSection(agent) {
  const text = read(`templates/.github/agents/${agent}.agent.md`);
  const start = text.indexOf("\n## Nested Subagent Invocation");
  expect(start, `${agent} has no Nested Subagent Invocation section`).toBeGreaterThanOrEqual(0);
  const body = text.slice(start + 1);
  const next = body.indexOf("\n## ");
  return next < 0 ? body : body.slice(0, next);
}

describe("the pipeline agents do not describe a chain they cannot run (#455)", () => {
  it.each(CHAIN_AGENTS)("%s says its nested-subagent steps have not been run, and why", (agent) => {
    const section = nestedSection(agent);
    expect(section).toContain("**Not run from this file.**");
    expect(section).toContain("`agents`, which is not a tool name");
    expect(section).toContain("it has no tool that starts another agent");
  });

  it.each(CHAIN_AGENTS)("%s says that what it knows of VS Code comes from its source, not from a run", (agent) => {
    const section = nestedSection(agent);
    expect(section).toContain("VS Code, going by its source (not run), reads `agents` as a separate attribute, not as a tool");
    expect(section).not.toContain("and VS Code reads `agents`");
  });

  it.each(CHAIN_AGENTS)("%s still asks for the VS Code setting, for a project that gives it such a tool", (agent) => {
    expect(nestedSection(agent)).toMatch(/\*\*Requires\*\*, if you add a tool that starts agents to `tools:`: VS Code setting `chat\.subagents\.allowInvocationsFromSubagents: true`/);
  });

  it.each(CHAIN_AGENTS)("%s falls back to its handoff, and does not announce an invocation it cannot make", (agent) => {
    const section = nestedSection(agent);
    expect(section).toContain("If you cannot start an agent (you have no tool that does, or `chat.subagents.allowInvocationsFromSubagents` is not set), do not say that you are invoking one");
    expect(section).toMatch(/handoff buttons?/);
  });

  it("keeps the steps and the termination guards, for the project that gives an agent the tool", () => {
    expect(nestedSection("specifier")).toContain("Invoke `plan-hardener` as a subagent");
    expect(nestedSection("reviewer-gate")).toContain("Stop after 2 LOCKOUT cycles");
  });
});

describe("the VS Code guide does not promise the single-session pipeline (#455)", () => {
  const guide = read("docs/COPILOT-VSCODE-GUIDE.md");
  const start = guide.indexOf("\n## Single-Session Pipeline with Nested Subagents");
  const section = guide.slice(start, guide.indexOf("\n## Forge-Master", start));

  it("finds the section, so the checks below are not vacuous", () => {
    expect(start).toBeGreaterThan(0);
    expect(section.length).toBeGreaterThan(1500);
  });

  it("opens the section with its status, before the design it describes", () => {
    const status = section.indexOf("> **Status: designed, not run.**");
    expect(status).toBeGreaterThan(0);
    expect(status).toBeLessThan(section.indexOf("could run end-to-end in a **single session**"));
  });

  it("says why: `agents` is not a tool name, as measured in the Copilot CLI and read from VS Code", () => {
    expect(section).toContain("lists `agents` in its `tools:`, and `agents` is not a tool name");
    expect(section).toContain("gets no tool that starts another agent");
    expect(section).toContain("read from its source and not run");
  });

  it("no longer says the agents start each other on their own, or that no handoff click is needed", () => {
    expect(section).not.toContain("no manual handoff clicks required");
    expect(section).not.toContain("Each agent invokes the next automatically");
    expect(section).not.toContain("invokes Plan Hardener automatically");
    expect(section).not.toContain("without requiring input");
    expect(section).not.toContain("rather than the agent invoking automatically");
    expect(section).not.toContain("so context flows without any copy-pasting");
  });

  it("describes the chain's context transfer as the design's, and the handoff button's as what carries context", () => {
    expect(section).toContain("The plan file path would be passed from agent to agent, so context would flow without any copy-pasting.");
    expect(section).toContain("Manual handoff carries the same context — you click the button, where the designed chain would have the agent invoke the next one.");
  });

  it("names the handoff buttons as what moves the pipeline as shipped", () => {
    expect(section).toContain("As shipped, the pipeline moves from agent to agent with manual handoff buttons");
  });

  it("does not make the setting a requirement of a single-session pipeline in the prerequisites", () => {
    expect(guide).not.toContain("required for single-session pipeline");
    expect(guide).toContain("only matters once an agent can start another");
  });
});

describe("the settings template does not say the setting makes the agents start each other (#455)", () => {
  const template = read("templates/vscode-settings.json.template");

  it("keeps the setting on", () => {
    expect(template).toContain('"chat.subagents.allowInvocationsFromSubagents": true,');
  });

  it("says the chain has not been run from the shipped agent files", () => {
    expect(template).toContain("so that chain has not been run from them");
    expect(template).not.toContain("does not run from them");
    expect(template).not.toContain("Remove or set to false to require manual handoff button clicks");
    expect(template).not.toContain("Allow pipeline agents to invoke each other as nested subagents (single-session pipeline).");
  });
});

describe("the manual does not say the agents start sub-agents on their own (#455)", () => {
  const callout = (page) => {
    const match = read(`docs/manual/${page}`).match(/<strong>Nested subagents<\/strong>:([\s\S]*?)<\/div>/);
    expect(match, `${page} has no Nested subagents callout`).not.toBeNull();
    return match[1].replace(/\s+/g, " ").trim();
  };

  it.each(["how-it-works.html", "plan-forge-manual.html"])("%s says it has not been run from the shipped agent files", (page) => {
    const text = callout(page);
    expect(text).toContain("That has not been run from the agent files Plan Forge ships");
    expect(text).not.toContain("This happens automatically");
    expect(text).not.toContain("the architecture reviewer can call the security reviewer");
  });

  it("is the same in the chapter and in the combined book", () => {
    expect(callout("plan-forge-manual.html")).toBe(callout("how-it-works.html"));
  });
});

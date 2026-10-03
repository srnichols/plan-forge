/**
 * VS Code automation templates shipped to projects (templates/.github/automations).
 *
 * VS Code ignores a template that breaks its format rather than guessing, so
 * a malformed file would silently disappear. These tests hold each template to
 * the documented format (docs/agent-customization/agent-plugins.md, "Automation
 * template format") and check that every Plan Forge tool a prompt names exists
 * and is reachable under the default tool profile.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { TOOL_NAMES } from "../enums.mjs";
import { TOOL_PROFILES } from "../server/tool-profiles.mjs";

const DIR = resolve(import.meta.dirname, "..", "..", "templates", ".github", "automations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".automation.md"));

/** Parse the restricted frontmatter: top-level `key: value` and one nested `schedule:` block. */
function parseTemplate(text) {
  const match = text.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error("missing frontmatter");
  const front = {};
  let nested = null;
  for (const line of match[1].split("\n")) {
    const indented = line.match(/^ {2}(\w+):\s*(.*)$/);
    if (indented && nested) {
      front[nested][indented[1]] = unquote(indented[2]);
      continue;
    }
    const top = line.match(/^(\w+):\s*(.*)$/);
    if (!top) throw new Error(`unexpected frontmatter line: ${line}`);
    if (top[2] === "") {
      nested = top[1];
      front[nested] = {};
    } else {
      nested = null;
      front[top[1]] = unquote(top[2]);
    }
  }
  return { front, body: match[2].trim() };
}

const unquote = (v) => v.replace(/^"(.*)"$/, "$1");
const DAILY_OR_WEEKLY_CRON = /^\d{1,2} \d{1,2} \* \* (\*|[0-6])$/;

describe("VS Code automation templates", () => {
  it("ships at least one template", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s follows the automation template format", (file) => {
    const { front, body } = parseTemplate(readFileSync(join(DIR, file), "utf8"));
    expect(Object.keys(front).sort()).toEqual(["description", "id", "name", "schedule", "version"]);
    expect(front.version).toBe("1");
    expect(front.id).toMatch(/^[a-z0-9.-]{1,64}$/);
    expect(file).toBe(`${front.id}.automation.md`);
    expect(front.name.length).toBeGreaterThan(0);
    expect(body.length).toBeGreaterThan(0);
    const { schedule } = front;
    if (schedule.kind === "cron") {
      expect(Object.keys(schedule).sort()).toEqual(["expression", "kind", "timeZone"]);
      expect(schedule.expression).toMatch(DAILY_OR_WEEKLY_CRON);
      expect(schedule.timeZone).toBe("local");
    } else {
      expect(["manual", "hourly"]).toContain(schedule.kind);
      expect(Object.keys(schedule)).toEqual(["kind"]);
    }
  });

  it("uses unique ids", () => {
    const ids = files.map((f) => parseTemplate(readFileSync(join(DIR, f), "utf8")).front.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(files)("%s names only real tools, loading non-core profiles first", (file) => {
    const { body } = parseTemplate(readFileSync(join(DIR, file), "utf8"));
    const named = [...new Set(body.match(/\bforge_[a-z_]+\b/g) ?? [])];
    expect(named.filter((tool) => !TOOL_NAMES.includes(tool))).toEqual([]);
    const loaded = [...body.matchAll(/"load":\s*\[([^\]]*)\]/g)].flatMap((m) => m[1].match(/[\w-]+/g) ?? []);
    const reachable = new Set([...TOOL_PROFILES.core, ...loaded.flatMap((profile) => TOOL_PROFILES[profile] ?? [])]);
    expect(named.filter((tool) => !reachable.has(tool))).toEqual([]);
  });

  it.each(files)("%s is read-only", (file) => {
    const { body } = parseTemplate(readFileSync(join(DIR, file), "utf8"));
    expect(body).toMatch(/Report only\.$/);
  });
});

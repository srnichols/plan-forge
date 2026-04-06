#!/usr/bin/env node
/**
 * Plan Forge Skill Runner — Parse & Execute SKILL.md Files
 *
 * Parses enhanced SKILL.md files into step DAGs and executes them
 * with validation gates between steps. Emits events to the orchestrator
 * event bus for dashboard and hub integration.
 *
 * Usage:
 *   import { parseSkill, executeSkill } from "./skill-runner.mjs";
 *   const skill = parseSkill("path/to/SKILL.md");
 *   const result = await executeSkill(skill, { cwd, eventHandler });
 *
 *   node pforge-mcp/skill-runner.mjs --test   # run self-tests
 *
 * @module skill-runner
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, basename, dirname } from "node:path";
import { execSync } from "node:child_process";

// ─── Skill Parser ─────────────────────────────────────────────────────

/**
 * Parse a SKILL.md file into a structured skill definition.
 *
 * @param {string} skillPath - Path to the SKILL.md file
 * @returns {{ meta, steps, safetyRules, memoryBlock }}
 */
export function parseSkill(skillPath) {
  const fullPath = resolve(skillPath);
  if (!existsSync(fullPath)) {
    throw new Error(`Skill file not found: ${skillPath}`);
  }

  const content = readFileSync(fullPath, "utf-8");
  const meta = parseFrontmatter(content);
  const steps = parseSteps(content);
  const safetyRules = parseSafetyRules(content);
  const memoryBlock = parseMemoryBlock(content);

  return {
    meta,
    steps,
    safetyRules,
    memoryBlock,
    path: fullPath,
    stepCount: steps.length,
  };
}

/**
 * Parse YAML frontmatter from SKILL.md.
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { name: "unknown", description: "", tools: [] };

  const yaml = match[1];
  const meta = { name: "", description: "", argumentHint: "", tools: [] };
  let inToolsList = false;

  for (const line of yaml.split("\n")) {
    const nameMatch = line.match(/^name:\s*(.+)/);
    if (nameMatch) { meta.name = nameMatch[1].trim(); inToolsList = false; continue; }

    const descMatch = line.match(/^description:\s*(.+)/);
    if (descMatch) { meta.description = descMatch[1].trim(); inToolsList = false; continue; }

    const hintMatch = line.match(/^argument-hint:\s*(.+)/);
    if (hintMatch) { meta.argumentHint = hintMatch[1].trim().replace(/^["']|["']$/g, ""); inToolsList = false; continue; }

    // tools: [a, b, c] — inline format
    const toolsInline = line.match(/^tools:\s*\[(.+)\]/);
    if (toolsInline) {
      meta.tools = toolsInline[1].split(",").map((t) => t.trim());
      inToolsList = false;
      continue;
    }

    // tools: — start of list format
    const toolsListStart = line.match(/^tools:\s*$/);
    if (toolsListStart) {
      inToolsList = true;
      continue;
    }

    // List item under tools:
    if (inToolsList) {
      const toolItem = line.match(/^\s+-\s+(.+)/);
      if (toolItem) {
        meta.tools.push(toolItem[1].trim());
      } else if (line.trim() && !line.startsWith(" ") && !line.startsWith("\t")) {
        // Non-indented non-empty line → end of tools list
        inToolsList = false;
      }
    }
  }

  return meta;
}

/**
 * Parse numbered steps from SKILL.md.
 * Steps are markdown headers: ### N. Title or ### Step N: Title
 */
function parseSteps(content) {
  const steps = [];
  // Remove frontmatter
  const body = content.replace(/^---[\s\S]*?---\r?\n/, "");
  const lines = body.split("\n");

  let current = null;
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      if (current) current.rawLines.push(line);
      continue;
    }
    if (inCodeBlock) {
      if (current) current.rawLines.push(line);
      continue;
    }

    // Match step headers: ### 1. Title  or  ### N. Title
    const stepMatch = line.match(/^###\s+(\d+)\.\s+(.+)/);
    if (stepMatch) {
      if (current) steps.push(current);
      current = {
        number: parseInt(stepMatch[1], 10),
        name: stepMatch[2].trim(),
        rawLines: [],
        hasGate: false,
        gateCommand: null,
        conditional: null,
      };
      continue;
    }

    if (!current) continue;
    current.rawLines.push(line);

    // Detect conditional logic
    const condMatch = line.match(/>\s*\*\*If\s+(.+?)(?:\*\*)?:\s*(.+)/i);
    if (condMatch) {
      current.conditional = {
        condition: condMatch[1].replace(/\*\*/g, "").trim(),
        action: condMatch[2].replace(/\*\*/g, "").trim(),
      };
    }
  }

  if (current) steps.push(current);
  return steps;
}

/**
 * Parse safety rules section.
 */
function parseSafetyRules(content) {
  const rules = [];
  const match = content.match(/## Safety Rules\r?\n([\s\S]*?)(?=\r?\n## |\r?\n---|\s*$)/);
  if (!match) return rules;

  for (const line of match[1].split("\n")) {
    const ruleMatch = line.match(/^-\s+(.+)/);
    if (ruleMatch) rules.push(ruleMatch[1].trim());
  }
  return rules;
}

/**
 * Parse memory integration block.
 */
function parseMemoryBlock(content) {
  const match = content.match(/## Persistent Memory[\s\S]*$/);
  return match ? match[0].trim() : null;
}

// ─── Skill Executor ───────────────────────────────────────────────────

/**
 * Execute a parsed skill with event emission.
 *
 * @param {object} skill - Parsed skill from parseSkill()
 * @param {object} options
 * @param {string} options.cwd - Working directory
 * @param {object} options.eventHandler - { handle(event) } for broadcasting
 * @param {AbortSignal} options.signal - Abort signal
 * @returns {Promise<{ status, steps, duration }>}
 */
export async function executeSkill(skill, options = {}) {
  const {
    cwd = process.cwd(),
    eventHandler = null,
    signal = null,
  } = options;

  const startTime = Date.now();
  const stepResults = [];

  // Emit skill-started
  emit(eventHandler, {
    type: "skill-started",
    skillName: skill.meta.name,
    stepCount: skill.stepCount,
  });

  for (const step of skill.steps) {
    // Check abort
    if (signal?.aborted) {
      stepResults.push({ number: step.number, name: step.name, status: "skipped" });
      continue;
    }

    const stepStart = Date.now();

    emit(eventHandler, {
      type: "skill-step-started",
      skillName: skill.meta.name,
      stepNumber: step.number,
      stepName: step.name,
    });

    // Extract bash commands from the step's raw lines
    const commands = extractCommands(step.rawLines);
    let stepStatus = "passed";
    let stepError = null;

    for (const cmd of commands) {
      try {
        execSync(cmd, {
          cwd,
          encoding: "utf-8",
          timeout: 120_000,
          stdio: "pipe",
          env: { ...process.env, NO_COLOR: "1" },
        });
      } catch (err) {
        stepStatus = "failed";
        stepError = (err.stderr || err.message || "").trim().substring(0, 500);

        // Check conditional — if step says "skip to Report", break out
        if (step.conditional?.action?.toLowerCase().includes("skip")) {
          break;
        }
      }
    }

    // If no commands, step is informational — auto-pass
    if (commands.length === 0) {
      stepStatus = "passed";
    }

    const stepDuration = Date.now() - stepStart;

    emit(eventHandler, {
      type: "skill-step-completed",
      skillName: skill.meta.name,
      stepNumber: step.number,
      stepName: step.name,
      status: stepStatus,
      duration: stepDuration,
    });

    stepResults.push({
      number: step.number,
      name: step.name,
      status: stepStatus,
      error: stepError,
      duration: stepDuration,
    });
  }

  const totalDuration = Date.now() - startTime;
  const passed = stepResults.filter((s) => s.status === "passed").length;
  const failed = stepResults.filter((s) => s.status === "failed").length;
  const status = failed === 0 ? "completed" : "failed";

  emit(eventHandler, {
    type: "skill-completed",
    skillName: skill.meta.name,
    status,
    stepsPassed: passed,
    stepsFailed: failed,
    totalDuration,
  });

  return {
    skillName: skill.meta.name,
    status,
    steps: stepResults,
    stepsPassed: passed,
    stepsFailed: failed,
    totalDuration,
  };
}

/**
 * Extract bash/powershell commands from step's raw markdown lines.
 */
function extractCommands(rawLines) {
  const commands = [];
  let inCodeBlock = false;
  let currentLang = null;
  let currentBlock = [];

  for (const line of rawLines) {
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        // Closing — collect commands
        if (currentLang === "bash" || currentLang === "powershell" || currentLang === "sh" || currentLang === null) {
          for (const cmdLine of currentBlock) {
            const trimmed = cmdLine.trim();
            if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("//")) {
              commands.push(trimmed);
            }
          }
        }
        currentBlock = [];
        inCodeBlock = false;
        currentLang = null;
      } else {
        inCodeBlock = true;
        currentLang = line.replace("```", "").trim().toLowerCase() || null;
        currentBlock = [];
      }
      continue;
    }
    if (inCodeBlock) {
      currentBlock.push(line);
    }
  }
  return commands;
}

/**
 * Emit an event via the event handler.
 */
function emit(handler, event) {
  if (handler?.handle) {
    handler.handle({ ...event, timestamp: new Date().toISOString() });
  }
}

// ─── Self-Tests ───────────────────────────────────────────────────────

async function selfTest() {
  const IS_WINDOWS = process.platform === "win32";
  const box = IS_WINDOWS ? ["=", "|"] : ["═", "║"];

  console.log(`╔${"═".repeat(42)}╗`);
  console.log(`║  Plan Forge Skill Runner — Self Test    ║`);
  console.log(`╚${"═".repeat(42)}╝`);
  console.log();

  let passed = 0;
  let failed = 0;

  function assert(condition, label) {
    if (condition) {
      console.log(`  ✓ ${label}`);
      passed++;
    } else {
      console.log(`  ✗ ${label}`);
      failed++;
    }
  }

  // ─── Frontmatter Parser ───
  console.log("─── Frontmatter Parser ───");
  {
    const content = `---
name: test-skill
description: A test skill
argument-hint: "[test]"
tools:
  - run_in_terminal
  - read_file
  - forge_sweep
---
# Test`;
    const meta = parseFrontmatter(content);
    assert(meta.name === "test-skill", "Parses name");
    assert(meta.description === "A test skill", "Parses description");
    assert(meta.tools.length === 3, "Parses 3 tools");
    assert(meta.tools[0] === "run_in_terminal", "First tool correct");
    assert(meta.tools[2] === "forge_sweep", "Third tool correct");
  }

  // ─── Inline tools format ───
  console.log("\n─── Inline Tools Format ───");
  {
    const content = `---
name: inline-test
description: Test
tools: [read_file, forge_analyze, forge_diff]
---`;
    const meta = parseFrontmatter(content);
    assert(meta.tools.length === 3, "Parses inline tools array");
    assert(meta.tools[1] === "forge_analyze", "Inline tool correct");
  }

  // ─── Step Parser ───
  console.log("\n─── Step Parser ───");
  {
    const content = `---
name: test
description: test
---
# Test Skill

## Steps

### 1. First Step
\`\`\`bash
echo hello
\`\`\`

### 2. Second Step
Do something manually.

> **If this step fails**: Stop and report.

### 3. Third Step
\`\`\`bash
echo done
\`\`\`
`;
    const steps = parseSteps(content);
    assert(steps.length === 3, "Parses 3 steps");
    assert(steps[0].number === 1, "First step number correct");
    assert(steps[0].name === "First Step", "First step name correct");
    assert(steps[1].conditional !== null, "Second step has conditional");
    assert(steps[1].conditional?.action.includes("Stop"), "Conditional action parsed");
  }

  // ─── Command Extraction ───
  console.log("\n─── Command Extraction ───");
  {
    const rawLines = [
      "Some text",
      "```bash",
      "echo hello",
      "# this is a comment",
      "echo world",
      "```",
      "More text",
    ];
    const cmds = extractCommands(rawLines);
    assert(cmds.length === 2, "Extracts 2 commands (skips comment)");
    assert(cmds[0] === "echo hello", "First command correct");
    assert(cmds[1] === "echo world", "Second command correct");
  }

  // ─── Safety Rules Parser ───
  console.log("\n─── Safety Rules ───");
  {
    const content = `## Safety Rules
- NEVER do bad things
- ALWAYS do good things
- Check your work

## Other`;
    const rules = parseSafetyRules(content);
    assert(rules.length === 3, "Parses 3 safety rules");
    assert(rules[0].includes("NEVER"), "First rule parsed");
  }

  // ─── Full Parse (real file if available) ───
  console.log("\n─── Full Skill Parse ───");
  {
    const testSkillPath = resolve(process.cwd(), "presets/shared/skills/health-check/SKILL.md");
    if (existsSync(testSkillPath)) {
      const skill = parseSkill(testSkillPath);
      assert(skill.meta.name === "health-check", "Health-check skill name");
      assert(skill.meta.tools.length >= 3, "Health-check has 3+ tools");
      assert(skill.steps.length >= 3, "Health-check has 3+ steps");
      assert(skill.safetyRules.length >= 1, "Has safety rules");
      assert(skill.stepCount === skill.steps.length, "stepCount matches");
    } else {
      assert(true, "Health-check skill not found — skipping (OK in non-root dir)");
    }
  }

  // ─── Missing file error ───
  console.log("\n─── Error Paths ───");
  {
    let threw = false;
    try { parseSkill("/nonexistent/SKILL.md"); } catch { threw = true; }
    assert(threw, "Missing file throws error");
  }

  // ─── Execute with mock ───
  console.log("\n─── Skill Execution (mock) ───");
  {
    const mockSkill = {
      meta: { name: "mock-skill" },
      steps: [
        { number: 1, name: "Echo Test", rawLines: ["```bash", "echo ok", "```"], conditional: null },
        { number: 2, name: "Info Step", rawLines: ["Just informational text"], conditional: null },
      ],
      safetyRules: [],
      memoryBlock: null,
      stepCount: 2,
    };

    const events = [];
    const handler = { handle: (e) => events.push(e) };
    const result = await executeSkill(mockSkill, { eventHandler: handler });

    assert(result.status === "completed", "Mock skill completes");
    assert(result.stepsPassed === 2, "Both steps passed");
    assert(result.stepsFailed === 0, "No failures");
    assert(events.length >= 4, "Events emitted (start + 2 step-starts + 2 step-completes + done)");
    assert(events[0].type === "skill-started", "First event is skill-started");
    assert(events[events.length - 1].type === "skill-completed", "Last event is skill-completed");
  }

  console.log();
  console.log(`${"═".repeat(43)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`${"═".repeat(43)}`);

  process.exit(failed > 0 ? 1 : 0);
}

// ─── CLI Entry ────────────────────────────────────────────────────────
if (process.argv.includes("--test")) {
  selfTest();
}

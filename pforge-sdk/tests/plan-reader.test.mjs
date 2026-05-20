/**
 * plan-reader.test.mjs — Unit tests for pforge-sdk/src/plan-reader.mjs
 *
 * Uses temporary directories for I/O tests so no real docs/plans/ state is required.
 * Run with: npx vitest run pforge-sdk/tests/plan-reader.test.mjs
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  PLANS_DIR_RELATIVE,
  plansDir,
  listPlans,
  readPlan,
  getPlanStatus,
  getPlanSlices,
} from '../src/plan-reader.mjs';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const HARDENED_PLAN = `---
phase: 55
name: CLEAN-CODE-SWEEP
status: HARDENED
lockHash: abc123def456
model: gpt-4.1
---

# Phase 55 — CLEAN-CODE-SWEEP — Eliminate residual blocking findings

> **Status**: **HARDENED — cleared for execution 2026-05-19**

---

## Execution Hold

Hardened plan MUST NOT execute until:

- [x] Phase 53 has shipped
- [x] master is clean

---

## Scope Contract

### In Scope

- S0 baseline audit fixture
- S1 split run-plan.mjs

---

## Slice Plan

### Slice 1: Baseline audit fixture

Description of slice 1.

### Slice 2 — Split orchestrator/run-plan.mjs

Description of slice 2.

### Slice 3: Split rest-api.mjs [depends: Slice 2]

Description of slice 3.

### Slice 4: Decompose searchLocalThoughts [depends: Slice 1, Slice 2]

Description of slice 4.
`;

const COMPLETE_PLAN = `---
phase: 53
name: ORCHESTRATOR-SPLIT
status: COMPLETE
---

# Phase 53 — ORCHESTRATOR-SPLIT — Decompose orchestrator.mjs

> **Status**: ✅ Complete. All 10 slices shipped.

---

## Slice Plan

### Slice 1: Extract plan-parser

Description.

### Slice 2 — Extract worker-spawn

Description.
`;

const DRAFT_PLAN = `---
phase: 99
name: FUTURE-PHASE
---

# Phase 99 — FUTURE-PHASE — Example draft

> **Status**: 📋 Planned (DRAFT — Step-2 harden required before execution)

---

## Execution Hold

- [ ] Prerequisite A must ship first
- [ ] Prerequisite B must be confirmed

---

## Slice Plan

### Slice 1: Define scope

Description.
`;

const NO_STATUS_PLAN = `# Phase X — NO-STATUS — Missing status

## Slice Plan

### Slice 1: Only slice
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Create a temp workspace with docs/plans/ populated with plan files.
 * Returns the cwd string to pass to plan-reader functions.
 */
function makeTmpWorkspace(files = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'pforge-plan-reader-'));
  const plansPath = join(cwd, 'docs', 'plans');
  mkdirSync(plansPath, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(plansPath, name), content, 'utf-8');
  }
  return cwd;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('plan-reader constants', () => {
  it('exports PLANS_DIR_RELATIVE as a non-empty string', () => {
    expect(typeof PLANS_DIR_RELATIVE).toBe('string');
    expect(PLANS_DIR_RELATIVE.length).toBeGreaterThan(0);
  });
});

describe('plansDir()', () => {
  it('returns an absolute path under cwd', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'pforge-plansdir-'));
    const dir = plansDir({ cwd });
    expect(dir).toBe(resolve(cwd, PLANS_DIR_RELATIVE));
    rmSync(cwd, { recursive: true, force: true });
  });
});

describe('listPlans()', () => {
  let cwd;
  afterEach(() => { if (cwd) rmSync(cwd, { recursive: true, force: true }); });

  it('returns [] when docs/plans/ does not exist', () => {
    cwd = mkdtempSync(join(tmpdir(), 'pforge-listplans-'));
    expect(listPlans({ cwd })).toEqual([]);
  });

  it('returns only *-PLAN.md files sorted alphabetically', () => {
    cwd = makeTmpWorkspace({
      'Phase-55-CLEAN-CODE-PLAN.md': HARDENED_PLAN,
      'Phase-53-ORCHESTRATOR-PLAN.md': COMPLETE_PLAN,
      'README.md': '# Not a plan',
      'Phase-99-FUTURE-PLAN.md': DRAFT_PLAN,
    });
    const plans = listPlans({ cwd });
    expect(plans).toHaveLength(3);
    expect(plans[0]).toContain('Phase-53');
    expect(plans[1]).toContain('Phase-55');
    expect(plans[2]).toContain('Phase-99');
  });

  it('does not include non-PLAN.md files', () => {
    cwd = makeTmpWorkspace({
      'DEPLOYMENT-ROADMAP.md': '# Roadmap',
      'AI-Plan-Hardening-Runbook.md': '# Runbook',
      'Phase-1-FOO-PLAN.md': HARDENED_PLAN,
    });
    const plans = listPlans({ cwd });
    expect(plans).toHaveLength(1);
    expect(plans[0]).toContain('FOO-PLAN');
  });
});

describe('readPlan()', () => {
  let cwd;
  afterEach(() => { if (cwd) rmSync(cwd, { recursive: true, force: true }); });

  it('returns null for a missing file', () => {
    cwd = mkdtempSync(join(tmpdir(), 'pforge-readplan-'));
    expect(readPlan({ planPath: 'docs/plans/Missing-PLAN.md', cwd })).toBeNull();
  });

  it('parses a hardened plan correctly', () => {
    cwd = makeTmpWorkspace({ 'Phase-55-PLAN.md': HARDENED_PLAN });
    const plan = readPlan({ planPath: 'docs/plans/Phase-55-PLAN.md', cwd });
    expect(plan).not.toBeNull();
    expect(plan.title).toBe('Phase 55 — CLEAN-CODE-SWEEP — Eliminate residual blocking findings');
    expect(plan.status).toBe('hardened');
    expect(plan.executionHold).toBe(false);
    expect(plan.frontmatter.phase).toBe('55');
    expect(plan.frontmatter.name).toBe('CLEAN-CODE-SWEEP');
    expect(plan.frontmatter.lockHash).toBe('abc123def456');
    expect(plan.frontmatter.model).toBe('gpt-4.1');
  });

  it('parses a complete plan correctly', () => {
    cwd = makeTmpWorkspace({ 'Phase-53-PLAN.md': COMPLETE_PLAN });
    const plan = readPlan({ planPath: 'docs/plans/Phase-53-PLAN.md', cwd });
    expect(plan.status).toBe('complete');
    expect(plan.executionHold).toBe(false);
  });

  it('parses a draft plan with open execution hold', () => {
    cwd = makeTmpWorkspace({ 'Phase-99-PLAN.md': DRAFT_PLAN });
    const plan = readPlan({ planPath: 'docs/plans/Phase-99-PLAN.md', cwd });
    expect(plan.status).toBe('draft');
    expect(plan.executionHold).toBe(true);
  });

  it('returns status "unknown" when no status line present', () => {
    cwd = makeTmpWorkspace({ 'Phase-X-PLAN.md': NO_STATUS_PLAN });
    const plan = readPlan({ planPath: 'docs/plans/Phase-X-PLAN.md', cwd });
    expect(plan.status).toBe('unknown');
    expect(plan.statusLine).toBeNull();
  });

  it('includes the resolved absolute planPath', () => {
    cwd = makeTmpWorkspace({ 'Phase-55-PLAN.md': HARDENED_PLAN });
    const plan = readPlan({ planPath: 'docs/plans/Phase-55-PLAN.md', cwd });
    expect(plan.planPath).toBe(resolve(cwd, 'docs', 'plans', 'Phase-55-PLAN.md'));
  });
});

describe('readPlan() — slice parsing', () => {
  let cwd;
  afterEach(() => { if (cwd) rmSync(cwd, { recursive: true, force: true }); });

  it('parses four slices from the hardened plan', () => {
    cwd = makeTmpWorkspace({ 'Phase-55-PLAN.md': HARDENED_PLAN });
    const plan = readPlan({ planPath: 'docs/plans/Phase-55-PLAN.md', cwd });
    expect(plan.slices).toHaveLength(4);
  });

  it('parses slice numbers correctly', () => {
    cwd = makeTmpWorkspace({ 'Phase-55-PLAN.md': HARDENED_PLAN });
    const { slices } = readPlan({ planPath: 'docs/plans/Phase-55-PLAN.md', cwd });
    expect(slices[0].number).toBe(1);
    expect(slices[1].number).toBe(2);
    expect(slices[2].number).toBe(3);
    expect(slices[3].number).toBe(4);
  });

  it('parses slice titles without dependency annotations', () => {
    cwd = makeTmpWorkspace({ 'Phase-55-PLAN.md': HARDENED_PLAN });
    const { slices } = readPlan({ planPath: 'docs/plans/Phase-55-PLAN.md', cwd });
    expect(slices[0].title).toBe('Baseline audit fixture');
    expect(slices[2].title).toBe('Split rest-api.mjs');
    expect(slices[3].title).toBe('Decompose searchLocalThoughts');
  });

  it('parses single dependency', () => {
    cwd = makeTmpWorkspace({ 'Phase-55-PLAN.md': HARDENED_PLAN });
    const { slices } = readPlan({ planPath: 'docs/plans/Phase-55-PLAN.md', cwd });
    expect(slices[2].dependencies).toEqual(['Slice 2']);
  });

  it('parses multiple dependencies', () => {
    cwd = makeTmpWorkspace({ 'Phase-55-PLAN.md': HARDENED_PLAN });
    const { slices } = readPlan({ planPath: 'docs/plans/Phase-55-PLAN.md', cwd });
    expect(slices[3].dependencies).toEqual(['Slice 1', 'Slice 2']);
  });

  it('returns empty dependencies array when none declared', () => {
    cwd = makeTmpWorkspace({ 'Phase-55-PLAN.md': HARDENED_PLAN });
    const { slices } = readPlan({ planPath: 'docs/plans/Phase-55-PLAN.md', cwd });
    expect(slices[0].dependencies).toEqual([]);
    expect(slices[1].dependencies).toEqual([]);
  });

  it('handles em-dash slice header syntax (Slice N — Title)', () => {
    cwd = makeTmpWorkspace({ 'Phase-55-PLAN.md': HARDENED_PLAN });
    const { slices } = readPlan({ planPath: 'docs/plans/Phase-55-PLAN.md', cwd });
    expect(slices[1].title).toBe('Split orchestrator/run-plan.mjs');
  });

  it('returns empty slice list for a plan with no slice headers', () => {
    const noSlices = '# Phase X\n> **Status**: ✅ Complete.\n';
    cwd = makeTmpWorkspace({ 'Phase-X-PLAN.md': noSlices });
    const plan = readPlan({ planPath: 'docs/plans/Phase-X-PLAN.md', cwd });
    expect(plan.slices).toEqual([]);
  });
});

describe('getPlanStatus()', () => {
  let cwd;
  afterEach(() => { if (cwd) rmSync(cwd, { recursive: true, force: true }); });

  it('returns null for a missing file', () => {
    cwd = mkdtempSync(join(tmpdir(), 'pforge-getstatus-'));
    expect(getPlanStatus({ planPath: 'docs/plans/Missing-PLAN.md', cwd })).toBeNull();
  });

  it('returns "hardened" for a hardened plan', () => {
    cwd = makeTmpWorkspace({ 'Phase-55-PLAN.md': HARDENED_PLAN });
    expect(getPlanStatus({ planPath: 'docs/plans/Phase-55-PLAN.md', cwd })).toBe('hardened');
  });

  it('returns "complete" for a complete plan', () => {
    cwd = makeTmpWorkspace({ 'Phase-53-PLAN.md': COMPLETE_PLAN });
    expect(getPlanStatus({ planPath: 'docs/plans/Phase-53-PLAN.md', cwd })).toBe('complete');
  });

  it('returns "draft" for a planned/draft plan', () => {
    cwd = makeTmpWorkspace({ 'Phase-99-PLAN.md': DRAFT_PLAN });
    expect(getPlanStatus({ planPath: 'docs/plans/Phase-99-PLAN.md', cwd })).toBe('draft');
  });
});

describe('getPlanSlices()', () => {
  let cwd;
  afterEach(() => { if (cwd) rmSync(cwd, { recursive: true, force: true }); });

  it('returns null for a missing file', () => {
    cwd = mkdtempSync(join(tmpdir(), 'pforge-getslices-'));
    expect(getPlanSlices({ planPath: 'docs/plans/Missing-PLAN.md', cwd })).toBeNull();
  });

  it('returns the slice array for a valid plan', () => {
    cwd = makeTmpWorkspace({ 'Phase-55-PLAN.md': HARDENED_PLAN });
    const slices = getPlanSlices({ planPath: 'docs/plans/Phase-55-PLAN.md', cwd });
    expect(Array.isArray(slices)).toBe(true);
    expect(slices).toHaveLength(4);
  });
});

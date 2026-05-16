/**
 * Plan Forge — Dashboard "Anvil & Lattice" tab smoke tests (Phase-LATTICE Slice 9).
 *
 * Covers:
 *   - renderAnvilCard renders entries, bytes, DLQ count, top-tool rows
 *   - renderAnvilCard empty-state when stat is null or entries === 0
 *   - renderLatticeCard renders chunks, edges, languages, chunker, hit rate
 *   - renderLatticeCard empty-state (null or chunks === 0) with forge_lattice_index hint
 *   - XSS escaping in both render functions
 *   - index.html contains the Anvil & Lattice tab button and section
 *   - index.html loads anvil-lattice.mjs
 *   - anvil-lattice.html exists with anvil and lattice card containers
 *   - anvil-lattice.mjs source uses the dashboard bridge (forge_anvil_stat, forge_lattice_stat, /api/tool/)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderAnvilCard, renderLatticeCard } from '../dashboard/anvil-lattice.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dashboardDir = resolve(__dirname, '..', 'dashboard');
const indexHtml = readFileSync(resolve(dashboardDir, 'index.html'), 'utf-8');
const anvilLatticeHtml = readFileSync(resolve(dashboardDir, 'anvil-lattice.html'), 'utf-8');
const anvilLatticeMjsSrc = readFileSync(resolve(dashboardDir, 'anvil-lattice.mjs'), 'utf-8');

// ─── renderAnvilCard — populated ─────────────────────────────────────────────

const ANVIL_STAT = {
  entries: 42,
  totalBytes: 102400,
  oldestMtime: Date.now() - 3_600_000,
  perTool: {
    forge_lattice_stat: { hits: 9, misses: 1, count: 5 },
    forge_search: { hits: 7, misses: 3, count: 10 },
  },
  dlqCount: 3,
};

describe('renderAnvilCard — populated', () => {
  it('wraps output in data-card="anvil" container', () => {
    const html = renderAnvilCard(ANVIL_STAT);
    expect(html).toContain('data-card="anvil"');
  });

  it('renders entry count', () => {
    const html = renderAnvilCard(ANVIL_STAT);
    expect(html).toContain('42');
  });

  it('renders total bytes as formatted size', () => {
    const html = renderAnvilCard(ANVIL_STAT);
    // 102400 bytes = 100.0 KB
    expect(html).toContain('100.0 KB');
  });

  it('renders DLQ count', () => {
    const html = renderAnvilCard(ANVIL_STAT);
    expect(html).toContain('data-stat="dlq"');
    expect(html).toContain('>3<');
  });

  it('renders DLQ with warn class when dlqCount > 0', () => {
    const html = renderAnvilCard(ANVIL_STAT);
    expect(html).toContain('al-stat__value--warn');
  });

  it('renders tool names in the top-tools table', () => {
    const html = renderAnvilCard(ANVIL_STAT);
    expect(html).toContain('forge_lattice_stat');
    expect(html).toContain('forge_search');
  });

  it('renders hit-rate percentages', () => {
    const html = renderAnvilCard(ANVIL_STAT);
    // forge_lattice_stat: 9/(9+1) = 90%
    expect(html).toContain('90%');
  });

  it('includes an al-table with aria-label', () => {
    const html = renderAnvilCard(ANVIL_STAT);
    expect(html).toContain('al-table');
    expect(html).toContain('aria-label="Anvil tool stats"');
  });
});

// ─── renderAnvilCard — empty states ──────────────────────────────────────────

describe('renderAnvilCard — empty state', () => {
  it('renders al-card__empty when stat is null', () => {
    expect(renderAnvilCard(null)).toContain('al-card__empty');
  });

  it('renders al-card__empty when entries is 0', () => {
    const html = renderAnvilCard({ entries: 0, totalBytes: 0, perTool: {}, dlqCount: 0 });
    expect(html).toContain('al-card__empty');
  });

  it('wraps empty state in data-card="anvil" container', () => {
    expect(renderAnvilCard(null)).toContain('data-card="anvil"');
  });

  it('does not render al-table in empty state', () => {
    expect(renderAnvilCard(null)).not.toContain('al-table');
  });
});

// ─── renderAnvilCard — no warn class when DLQ is 0 ───────────────────────────

describe('renderAnvilCard — DLQ = 0 has no warn class', () => {
  it('omits al-stat__value--warn when dlqCount is 0', () => {
    const stat = { ...ANVIL_STAT, dlqCount: 0 };
    const html = renderAnvilCard(stat);
    expect(html).not.toContain('al-stat__value--warn');
  });
});

// ─── renderLatticeCard — populated ───────────────────────────────────────────

const LATTICE_STAT = {
  chunks: 150,
  edges: 320,
  languages: { js: 80, ts: 40, py: 30 },
  lastIndexedAt: new Date(Date.now() - 7_200_000).toISOString(), // 2h ago
  chunkerImpl: 'pureJs',
  chunkerVersion: '1.0.0',
  anvilHitRate: 0.97,
  indexBytes: 51200,
};

describe('renderLatticeCard — populated', () => {
  it('wraps output in data-card="lattice" container', () => {
    const html = renderLatticeCard(LATTICE_STAT);
    expect(html).toContain('data-card="lattice"');
  });

  it('renders chunk count', () => {
    const html = renderLatticeCard(LATTICE_STAT);
    expect(html).toContain('>150<');
  });

  it('renders edge count', () => {
    const html = renderLatticeCard(LATTICE_STAT);
    expect(html).toContain('>320<');
  });

  it('renders Anvil hit rate as percentage', () => {
    const html = renderLatticeCard(LATTICE_STAT);
    // 0.97 = 97%
    expect(html).toContain('97%');
  });

  it('renders chunker impl', () => {
    const html = renderLatticeCard(LATTICE_STAT);
    expect(html).toContain('pureJs');
  });

  it('renders chunker version', () => {
    const html = renderLatticeCard(LATTICE_STAT);
    expect(html).toContain('v1.0.0');
  });

  it('renders index size as formatted bytes', () => {
    const html = renderLatticeCard(LATTICE_STAT);
    // 51200 = 50.0 KB
    expect(html).toContain('50.0 KB');
  });

  it('renders language names in lang-bar elements', () => {
    const html = renderLatticeCard(LATTICE_STAT);
    expect(html).toContain('data-lang="js"');
    expect(html).toContain('data-lang="ts"');
    expect(html).toContain('data-lang="py"');
  });

  it('renders last-indexed age string', () => {
    const html = renderLatticeCard(LATTICE_STAT);
    // 2h ago — formatAge rounds to hours
    expect(html).toMatch(/\d+[hm] ago|just now/);
  });

  it('includes an al-card__meta section', () => {
    const html = renderLatticeCard(LATTICE_STAT);
    expect(html).toContain('al-card__meta');
  });
});

// ─── renderLatticeCard — empty states ────────────────────────────────────────

describe('renderLatticeCard — empty state', () => {
  it('renders al-card__empty when stat is null', () => {
    expect(renderLatticeCard(null)).toContain('al-card__empty');
  });

  it('renders al-card__empty when chunks is 0', () => {
    const stat = { chunks: 0, edges: 0, languages: {}, lastIndexedAt: null, chunkerImpl: null, chunkerVersion: null, anvilHitRate: 0, indexBytes: 0 };
    expect(renderLatticeCard(stat)).toContain('al-card__empty');
  });

  it('wraps empty state in data-card="lattice" container', () => {
    expect(renderLatticeCard(null)).toContain('data-card="lattice"');
  });

  it('includes forge_lattice_index command hint in empty state', () => {
    const html = renderLatticeCard(null);
    expect(html).toContain('forge_lattice_index');
  });
});

// ─── XSS escaping ─────────────────────────────────────────────────────────────

describe('renderAnvilCard — XSS escaping', () => {
  it('escapes malicious tool names', () => {
    const stat = {
      entries: 1,
      totalBytes: 100,
      perTool: { '<script>alert(1)</script>': { hits: 1, misses: 0, count: 1 } },
      dlqCount: 0,
    };
    const html = renderAnvilCard(stat);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('renderLatticeCard — XSS escaping', () => {
  it('escapes malicious language names', () => {
    const stat = {
      ...LATTICE_STAT,
      languages: { '<img onerror="alert(1)" src=x>': 5 },
    };
    const html = renderLatticeCard(stat);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('escapes malicious chunkerImpl', () => {
    const stat = { ...LATTICE_STAT, chunkerImpl: '<b>evil</b>' };
    const html = renderLatticeCard(stat);
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;');
  });
});

// ─── index.html — tab registration ───────────────────────────────────────────

describe('index.html — Anvil & Lattice tab entry', () => {
  it('contains the Anvil & Lattice tab button', () => {
    expect(indexHtml).toContain('data-tab="anvil-lattice"');
    expect(indexHtml).toContain('data-testid="anvil-lattice-tab-btn"');
  });

  it('tab button label contains "Anvil" and "Lattice"', () => {
    expect(indexHtml).toContain('Anvil');
    expect(indexHtml).toContain('Lattice');
  });

  it('contains the Anvil & Lattice tab section', () => {
    expect(indexHtml).toContain('id="tab-anvil-lattice"');
  });

  it('tab section contains al-anvil-card placeholder', () => {
    expect(indexHtml).toContain('id="al-anvil-card"');
  });

  it('tab section contains al-lattice-card placeholder', () => {
    expect(indexHtml).toContain('id="al-lattice-card"');
  });

  it('loads anvil-lattice.mjs as a module script', () => {
    expect(indexHtml).toContain('anvil-lattice.mjs');
    expect(indexHtml).toContain('type="module"');
  });

  it('links anvil-lattice.css stylesheet', () => {
    expect(indexHtml).toContain('anvil-lattice.css');
  });
});

// ─── anvil-lattice.html — standalone page ────────────────────────────────────

describe('anvil-lattice.html — standalone page', () => {
  it('contains al-anvil-card container', () => {
    expect(anvilLatticeHtml).toContain('data-card="anvil"');
  });

  it('contains al-lattice-card container', () => {
    expect(anvilLatticeHtml).toContain('data-card="lattice"');
  });

  it('loads anvil-lattice.mjs', () => {
    expect(anvilLatticeHtml).toContain('anvil-lattice.mjs');
  });

  it('links anvil-lattice.css', () => {
    expect(anvilLatticeHtml).toContain('anvil-lattice.css');
  });

  it('has a Refresh button', () => {
    expect(anvilLatticeHtml).toContain('loadAnvilLattice');
  });
});

// ─── anvil-lattice.mjs — dashboard bridge usage ───────────────────────────────

describe('anvil-lattice.mjs — uses dashboard bridge, not direct file reads', () => {
  it('calls forge_anvil_stat through /api/tool/', () => {
    expect(anvilLatticeMjsSrc).toContain('forge_anvil_stat');
    expect(anvilLatticeMjsSrc).toContain('/api/tool/');
  });

  it('calls forge_anvil_dlq_list through /api/tool/', () => {
    expect(anvilLatticeMjsSrc).toContain('forge_anvil_dlq_list');
  });

  it('calls forge_lattice_stat through /api/tool/', () => {
    expect(anvilLatticeMjsSrc).toContain('forge_lattice_stat');
  });

  it('does not import node:fs (no direct file reads)', () => {
    expect(anvilLatticeMjsSrc).not.toContain("from 'node:fs'");
    expect(anvilLatticeMjsSrc).not.toContain('from "node:fs"');
    expect(anvilLatticeMjsSrc).not.toContain("require('fs')");
  });

  it('exposes window.loadAnvilLattice', () => {
    expect(anvilLatticeMjsSrc).toContain('window.loadAnvilLattice');
  });
});

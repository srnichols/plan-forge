/**
 * Plan Forge — Anvil & Lattice Dashboard Tab (Phase-LATTICE Slice 9).
 *
 * Exports render helpers for the "Anvil & Lattice" tab:
 *   - `renderAnvilCard(stat)` — Anvil cache summary: entries, bytes, top-5 tools by hit count, DLQ count.
 *   - `renderLatticeCard(stat)` — Lattice index summary: chunks, edges, languages, last index age, chunker impl.
 *
 * `stat` for `renderAnvilCard` is the merged result of `forge_anvil_stat` + `dlqCount` from `forge_anvil_dlq_list`.
 * `stat` for `renderLatticeCard` is the result of `forge_lattice_stat`.
 *
 * The browser interop section at the bottom wires `loadAnvilLattice()` and exposes it as `window.loadAnvilLattice`.
 */

// ─── Anvil Card ───────────────────────────────────────────────────────────────

/**
 * Render the Anvil cache summary card.
 *
 * @param {{ entries: number, totalBytes: number, oldestMtime: number|null,
 *           perTool: Record<string, { hits: number, misses: number, count: number }>,
 *           dlqCount?: number } | null} stat
 * @returns {string} HTML fragment
 */
export function renderAnvilCard(stat) {
  if (!stat || stat.entries === 0) {
    return `<div class="al-card al-card--anvil" data-card="anvil">
  <h3 class="al-card__title">🔨 Anvil Cache</h3>
  <p class="al-card__empty">No cached entries yet. Run a plan to warm the cache.</p>
</div>`;
  }

  const { entries, totalBytes = 0, perTool = {}, dlqCount = 0 } = stat;

  const toolRows = Object.entries(perTool)
    .map(([tool, s]) => {
      const total = (s.hits ?? 0) + (s.misses ?? 0);
      const rate = total > 0 ? s.hits / total : 0;
      return { tool, hits: s.hits ?? 0, count: s.count ?? 0, rate };
    })
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 5);

  const rowsHtml =
    toolRows.length > 0
      ? toolRows
          .map(
            (r) => `    <tr class="al-table__row">
      <td class="al-table__cell">${escapeHtml(r.tool)}</td>
      <td class="al-table__cell al-table__cell--num">${r.count}</td>
      <td class="al-table__cell al-table__cell--num">${formatPercent(r.rate)}</td>
    </tr>`
          )
          .join('\n')
      : `    <tr><td colspan="3" class="al-table__cell al-card__empty--inline">No tool stats yet.</td></tr>`;

  return `<div class="al-card al-card--anvil" data-card="anvil">
  <h3 class="al-card__title">🔨 Anvil Cache</h3>
  <div class="al-card__stats">
    <div class="al-stat" data-stat="entries">
      <span class="al-stat__label">Entries</span>
      <span class="al-stat__value">${entries}</span>
    </div>
    <div class="al-stat" data-stat="bytes">
      <span class="al-stat__label">Cache size</span>
      <span class="al-stat__value">${formatBytes(totalBytes)}</span>
    </div>
    <div class="al-stat" data-stat="dlq">
      <span class="al-stat__label">DLQ</span>
      <span class="al-stat__value${dlqCount > 0 ? ' al-stat__value--warn' : ''}">${dlqCount}</span>
    </div>
  </div>
  <h4 class="al-card__subtitle">Top tools by hit count</h4>
  <table class="al-table" aria-label="Anvil tool stats">
    <thead>
      <tr>
        <th class="al-table__th">Tool</th>
        <th class="al-table__th al-table__th--num">Entries</th>
        <th class="al-table__th al-table__th--num">Hit rate</th>
      </tr>
    </thead>
    <tbody>
${rowsHtml}
    </tbody>
  </table>
</div>`;
}

// ─── Lattice Card ─────────────────────────────────────────────────────────────

/**
 * Render the Lattice index summary card.
 *
 * @param {{ chunks: number, edges: number, languages: Record<string, number>,
 *           lastIndexedAt: string|null, chunkerImpl: string|null,
 *           chunkerVersion: string|null, anvilHitRate: number,
 *           indexBytes: number } | null} stat
 * @returns {string} HTML fragment
 */
export function renderLatticeCard(stat) {
  if (!stat || stat.chunks === 0) {
    return `<div class="al-card al-card--lattice" data-card="lattice">
  <h3 class="al-card__title">🕸 Lattice Index</h3>
  <p class="al-card__empty">No index found. Run <code>forge_lattice_index</code> to populate.</p>
</div>`;
  }

  const {
    chunks,
    edges,
    languages = {},
    lastIndexedAt,
    chunkerImpl,
    chunkerVersion,
    anvilHitRate,
    indexBytes = 0,
  } = stat;

  const ageStr = lastIndexedAt ? formatAge(lastIndexedAt) : 'never';
  const hitRateStr =
    typeof anvilHitRate === 'number' ? formatPercent(anvilHitRate) : 'n/a';

  const totalLangChunks =
    Object.values(languages).reduce((s, n) => s + n, 0) || 1;

  const langBarsHtml = Object.entries(languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([lang, count]) => {
      const pct = Math.round((count / totalLangChunks) * 100);
      return `    <div class="al-lang-bar" data-lang="${escapeHtml(lang)}">
      <span class="al-lang-bar__label">${escapeHtml(lang)}</span>
      <div class="al-lang-bar__track"><div class="al-lang-bar__fill" style="width:${pct}%"></div></div>
      <span class="al-lang-bar__count">${count}</span>
    </div>`;
    })
    .join('\n');

  const implLabel = escapeHtml(chunkerImpl ?? 'unknown');
  const implVersion = chunkerVersion ? ` v${escapeHtml(chunkerVersion)}` : '';

  return `<div class="al-card al-card--lattice" data-card="lattice">
  <h3 class="al-card__title">🕸 Lattice Index</h3>
  <div class="al-card__stats">
    <div class="al-stat" data-stat="chunks">
      <span class="al-stat__label">Chunks</span>
      <span class="al-stat__value">${chunks}</span>
    </div>
    <div class="al-stat" data-stat="edges">
      <span class="al-stat__label">Edges</span>
      <span class="al-stat__value">${edges}</span>
    </div>
    <div class="al-stat" data-stat="index-bytes">
      <span class="al-stat__label">Index size</span>
      <span class="al-stat__value">${formatBytes(indexBytes)}</span>
    </div>
    <div class="al-stat" data-stat="anvil-hit-rate">
      <span class="al-stat__label">Anvil hit rate</span>
      <span class="al-stat__value">${hitRateStr}</span>
    </div>
  </div>
  <div class="al-card__meta">
    <span class="al-meta__item">Indexed <strong>${ageStr}</strong></span>
    <span class="al-meta__sep">·</span>
    <span class="al-meta__item">Chunker: <code>${implLabel}${implVersion}</code></span>
  </div>
${langBarsHtml
    ? `  <h4 class="al-card__subtitle">Language distribution</h4>
  <div class="al-lang-bars">
${langBarsHtml}
  </div>`
    : ''}
</div>`;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatPercent(val) {
  if (typeof val !== 'number') return '0%';
  return `${Math.round(val * 100)}%`;
}

function formatBytes(bytes) {
  const n = typeof bytes === 'number' ? bytes : 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatAge(iso) {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return 'just now';
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
    return `${Math.floor(ms / 86_400_000)}d ago`;
  } catch {
    return 'unknown';
  }
}

// ─── Browser interop ──────────────────────────────────────────────────────────
// Exposes loadAnvilLattice() and render helpers to non-module scripts via window.
if (typeof window !== 'undefined') {
  const API_BASE = `${window.location.protocol}//${window.location.host}`;

  async function loadAnvilLattice() {
    const errEl = document.getElementById('al-error');
    if (errEl) errEl.classList.add('hidden');

    try {
      const [anvilRes, dlqRes, latticeRes] = await Promise.allSettled([
        fetch(`${API_BASE}/api/tool/forge_anvil_stat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        }).then((r) => r.json()),
        fetch(`${API_BASE}/api/tool/forge_anvil_dlq_list`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        }).then((r) => r.json()),
        fetch(`${API_BASE}/api/tool/forge_lattice_stat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        }).then((r) => r.json()),
      ]);

      const anvilStat =
        anvilRes.status === 'fulfilled' ? anvilRes.value : null;
      const dlqData =
        dlqRes.status === 'fulfilled' ? dlqRes.value : null;
      const latticeStat =
        latticeRes.status === 'fulfilled' ? latticeRes.value : null;

      const mergedAnvil = anvilStat
        ? { ...anvilStat, dlqCount: dlqData?.total ?? 0 }
        : null;

      const anvilEl = document.getElementById('al-anvil-card');
      if (anvilEl) anvilEl.innerHTML = renderAnvilCard(mergedAnvil);

      const latticeEl = document.getElementById('al-lattice-card');
      if (latticeEl) latticeEl.innerHTML = renderLatticeCard(latticeStat);
    } catch (err) {
      if (errEl) {
        errEl.textContent = `Failed to load Anvil & Lattice stats: ${err.message}`;
        errEl.classList.remove('hidden');
      }
    }
  }

  window.loadAnvilLattice = loadAnvilLattice;
  window.anvilLatticeRenderAnvilCard = renderAnvilCard;
  window.anvilLatticeRenderLatticeCard = renderLatticeCard;
}

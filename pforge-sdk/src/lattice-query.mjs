/**
 * lattice-query.mjs — Lattice query builder for pforge-sdk.
 *
 * Provides:
 *   - `tokenizeForSearch(text)`   — camelCase-aware token extractor (pure)
 *   - `scoreChunk(queryText, chunk)` — relevance scorer [0, 1] (pure)
 *   - `LatticeQueryBuilder`       — fluent builder for latticeQuery parameters
 *
 * All exports are pure and dependency-free. They mirror the scoring logic in
 * `pforge-mcp/lattice.mjs` so that external tools can rank chunks without
 * running the full MCP server.
 */

// ─── Scoring helpers ──────────────────────────────────────────────────────────

/**
 * Tokenize text for relevance scoring.
 *
 * Splits on whitespace/punctuation AND camelCase/PascalCase boundaries so that
 * a query for "user" matches chunks named "getUserById" or "UserService".
 *
 * @param {string} text
 * @returns {Map<string, number>} token → count (all tokens lowercased)
 *
 * @example
 * tokenizeForSearch('getUserById');
 * // Map { 'get' => 1, 'user' => 1, 'by' => 1, 'id' => 1 }
 */
export function tokenizeForSearch(text) {
  if (!text || typeof text !== 'string') return new Map();
  const split = text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  const tokens = split.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const out = new Map();
  for (const t of tokens) out.set(t, (out.get(t) || 0) + 1);
  return out;
}

/**
 * Compute a relevance score for a chunk against a query string.
 *
 * Score = (nameOverlap × 2 + pathOverlap) / 3, where overlap is
 * |query_tokens ∩ field_tokens| / |query_tokens|.
 *
 * Returns a value in [0, 1]. Returns 0 when query is empty.
 *
 * @param {string} queryText
 * @param {{ name?: string, filePath?: string }} chunk
 * @returns {number}
 *
 * @example
 * scoreChunk('user', { name: 'getUserById', filePath: 'src/user.mjs' });
 * // → 1  (name tokens: get/user/by/id → 1 hit; path tokens: src/user/mjs → 1 hit)
 */
export function scoreChunk(queryText, chunk) {
  if (!queryText || typeof queryText !== 'string') return 0;
  const qTokens = tokenizeForSearch(queryText);
  if (qTokens.size === 0) return 0;

  const nameTokens = tokenizeForSearch(chunk.name ?? '');
  const pathTokens = tokenizeForSearch(chunk.filePath ?? '');

  let nameHits = 0;
  let pathHits = 0;
  for (const q of qTokens.keys()) {
    if (nameTokens.has(q)) nameHits++;
    if (pathTokens.has(q)) pathHits++;
  }

  const qSize = qTokens.size;
  return (nameHits / qSize * 2 + pathHits / qSize) / 3;
}

// ─── LatticeQueryBuilder ──────────────────────────────────────────────────────

/**
 * Fluent builder for Lattice query parameters.
 *
 * Use `.build()` to produce the params object accepted by `latticeQuery` (from
 * `pforge-mcp/lattice.mjs`) or by `client.tool('forge_lattice_query', ...)`.
 *
 * All filter methods are chainable.  Calling the same method twice overwrites
 * the previous value — there is no accumulation.
 *
 * @example
 * const params = new LatticeQueryBuilder()
 *   .query('getUserById')
 *   .language('javascript')
 *   .kind('function')
 *   .limit(10)
 *   .build();
 *
 * // params → { query: 'getUserById', language: 'javascript', kind: 'function', limit: 10 }
 */
export class LatticeQueryBuilder {
  constructor() {
    this._query = '';
    this._language = undefined;
    this._kind = undefined;
    this._filePath = undefined;
    this._limit = 25;
  }

  /**
   * Token + substring match against chunk name and filePath.
   * @param {string} text
   * @returns {this}
   */
  query(text) {
    this._query = String(text ?? '');
    return this;
  }

  /**
   * Exact match against `chunk.language`.
   * @param {string} lang  e.g. `'javascript'`, `'python'`, `'typescript'`
   * @returns {this}
   */
  language(lang) {
    this._language = String(lang);
    return this;
  }

  /**
   * Exact match against `chunk.kind`.
   * @param {string} k  one of: `'file' | 'module' | 'class' | 'function' | 'method' | 'block'`
   * @returns {this}
   */
  kind(k) {
    this._kind = String(k);
    return this;
  }

  /**
   * Substring match against `chunk.filePath` (case-insensitive).
   * @param {string} path  e.g. `'src/auth'`
   * @returns {this}
   */
  filePath(path) {
    this._filePath = String(path);
    return this;
  }

  /**
   * Maximum number of results to return (default 25).
   * @param {number} n  positive integer
   * @returns {this}
   */
  limit(n) {
    if (!Number.isInteger(n) || n < 1) throw new RangeError(`limit must be a positive integer, got ${n}`);
    this._limit = n;
    return this;
  }

  /**
   * Produce the params object for `latticeQuery` / `client.tool('forge_lattice_query', ...)`.
   *
   * Only non-default / non-undefined values are included in the output so that
   * callers can spread it onto their own options safely.
   *
   * @returns {{
   *   query?:    string,
   *   language?: string,
   *   kind?:     string,
   *   filePath?: string,
   *   limit:     number,
   * }}
   */
  build() {
    const params = { limit: this._limit };
    if (this._query) params.query = this._query;
    if (this._language !== undefined) params.language = this._language;
    if (this._kind !== undefined) params.kind = this._kind;
    if (this._filePath !== undefined) params.filePath = this._filePath;
    return params;
  }

  /**
   * Return a human-readable description of the current filters.
   * Useful for logging / debugging.
   * @returns {string}
   */
  describe() {
    const parts = [];
    if (this._query) parts.push(`query="${this._query}"`);
    if (this._language !== undefined) parts.push(`language="${this._language}"`);
    if (this._kind !== undefined) parts.push(`kind="${this._kind}"`);
    if (this._filePath !== undefined) parts.push(`filePath="${this._filePath}"`);
    parts.push(`limit=${this._limit}`);
    return `LatticeQuery(${parts.join(', ')})`;
  }
}

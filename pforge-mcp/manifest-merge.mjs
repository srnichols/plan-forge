/**
 * Plan Forge — what `pforge update` does with the package.json of a framework package (#435).
 *
 * pforge-mcp, pforge-master and pforge-sdk are copied into a project, so their package.json files sit in the
 * project's own repository, where Dependabot or a maintainer raises a dependency range. Update compared the file
 * byte for byte and replaced it with the release's copy, which rolled the bump back and brought back the advisory
 * it had closed. A manifest is structured, so it is merged instead:
 *
 *   - for each dependency the release declares, in dependencies, devDependencies and optionalDependencies, the
 *     higher range wins: the project's when its lowest version is higher than the release's, the release's when
 *     it is equal, lower or not one of the plain forms below (a pin, a tag, a URL, a union of ranges)
 *   - everything else is the release's: its version, scripts, engines, and the dependencies it adds or lowers
 *   - a dependency only the project has is dropped, as before: the release defines which packages there are, and
 *     a package the release removed would otherwise stay in every project for good
 *
 * The lock file is not merged. The release's lock replaces the project's, and the `npm install` that follows an
 * update resolves the ranges the project kept. `pforge update --overwrite-customized` takes the release's manifest
 * as it is and backs the project's up first (update-guard.mjs).
 *
 * @module manifest-merge
 */

/** The package.json of each framework package, as project-relative paths. */
export const PACKAGE_MANIFESTS = Object.freeze(["pforge-mcp/package.json", "pforge-master/package.json", "pforge-sdk/package.json"]);

/** The package.json sections whose entries are dependency ranges. */
const RANGE_SECTIONS = Object.freeze(["dependencies", "devDependencies", "optionalDependencies"]);

/** The most kept ranges the line an update prints names; the rest are counted. */
const MAX_NAMED_RANGES = 5;

export function isPackageManifest(projectPath) {
  return PACKAGE_MANIFESTS.includes(projectPath);
}

/** The plain forms: an optional ^, ~, >= or =, then one to three version parts, a pre-release and build metadata. */
const PLAIN_RANGE = /^\s*(?:\^|~|>=|=)?\s*v?(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?\s*$/;

/**
 * The lowest version a range admits, or null when the range is not one of the plain forms: a tag such as `latest`,
 * a URL or `file:` path, an alias, a union (`||`), a pair of bounds, or a hyphen range.
 * @returns {{ major: number, minor: number, patch: number, pre: string[] } | null}
 */
export function lowestVersion(range) {
  if (typeof range !== "string") return null;
  const match = PLAIN_RANGE.exec(range);
  if (!match) return null;
  const part = (text) => (text !== undefined && /^\d+$/.test(text) ? Number(text) : 0);
  return { major: Number(match[1]), minor: part(match[2]), patch: part(match[3]), pre: match[4] ? match[4].split(".") : [] };
}

function compareIdentifiers(x, y) {
  const xNumeric = /^\d+$/.test(x);
  const yNumeric = /^\d+$/.test(y);
  if (xNumeric && yNumeric) return Math.sign(Number(x) - Number(y));
  if (xNumeric) return -1;
  if (yNumeric) return 1;
  if (x === y) return 0;
  return x < y ? -1 : 1;
}

/** Semantic-version precedence of two versions from lowestVersion: -1, 0 or 1. */
export function compareVersions(a, b) {
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  if (a.pre.length === 0 && b.pre.length === 0) return 0;
  if (a.pre.length === 0) return 1;
  if (b.pre.length === 0) return -1;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    if (a.pre[i] === undefined) return -1;
    if (b.pre[i] === undefined) return 1;
    const order = compareIdentifiers(a.pre[i], b.pre[i]);
    if (order !== 0) return order;
  }
  return 0;
}

function isHigher(projectRange, releaseRange) {
  const project = lowestVersion(projectRange);
  const release = lowestVersion(releaseRange);
  return project !== null && release !== null && compareVersions(project, release) > 0;
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function parseManifest(text) {
  try {
    const value = JSON.parse(text.replace(/^\uFEFF/, ""));
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

/** The merged manifest written the way the release's file is: its indent, its line endings, and a final newline if it has one. */
function serialize(manifest, layoutText) {
  const indent = /^([ \t]+)"/m.exec(layoutText)?.[1] ?? 2;
  const eol = layoutText.includes("\r\n") ? "\r\n" : "\n";
  const body = JSON.stringify(manifest, null, indent).replace(/\n/g, eol);
  return /\n$/.test(layoutText) ? `${body}${eol}` : body;
}

/** The value with every object's keys in order, so two manifests that differ only in layout compare equal. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

/**
 * Merge the project's manifest into the release's.
 * @returns {{ text: string, kept: { section: string, name: string, project: string, release: string }[], manifest: object, project: object } | null}
 *          text is the release's file as it is when no range is kept; null when either side is not a JSON object.
 */
export function mergePackageManifest(releaseText, projectText) {
  const manifest = parseManifest(releaseText);
  const project = parseManifest(projectText);
  if (!manifest || !project) return null;
  const kept = [];
  for (const section of RANGE_SECTIONS) {
    if (!isObject(manifest[section]) || !isObject(project[section])) continue;
    for (const [name, releaseRange] of Object.entries(manifest[section])) {
      const projectRange = project[section][name];
      if (typeof projectRange !== "string" || !isHigher(projectRange, releaseRange)) continue;
      manifest[section][name] = projectRange;
      kept.push({ section, name, project: projectRange, release: releaseRange });
    }
  }
  return { text: kept.length === 0 ? releaseText : serialize(manifest, releaseText), kept, manifest, project };
}

/**
 * Decide what update should do with a framework package's manifest.
 *   new     the project has none                                   → add the release's
 *   same    the project's already is the merge (layout aside)       → nothing to do
 *   update  the merge differs from the project's                    → write the merge
 * A project manifest that is not JSON is replaced, as it was before the merge.
 * @returns {{ action: "new"|"same"|"update", content: string, kept: object[], releaseText: string }}
 */
export function classifyManifest({ sourceText, projectText }) {
  if (projectText === null) return { action: "new", content: sourceText, kept: [], releaseText: sourceText };
  const merged = mergePackageManifest(sourceText, projectText);
  if (!merged) {
    const identical = projectText.replace(/^\uFEFF/, "").replace(/\r/g, "") === sourceText.replace(/^\uFEFF/, "").replace(/\r/g, "");
    return { action: identical ? "same" : "update", content: sourceText, kept: [], releaseText: sourceText };
  }
  const same = JSON.stringify(canonical(merged.manifest)) === JSON.stringify(canonical(merged.project));
  return { action: same ? "same" : "update", content: merged.text, kept: merged.kept, releaseText: sourceText };
}

/** The note an update prints beside a manifest it merged: which of the project's newer ranges it kept. */
export function describeKept(kept) {
  if (kept.length === 0) return "";
  const named = kept.slice(0, MAX_NAMED_RANGES).map(({ name, project }) => `${name} ${project}`).join(", ");
  const more = kept.length > MAX_NAMED_RANGES ? ` and ${kept.length - MAX_NAMED_RANGES} more` : "";
  return `kept your newer ranges: ${named}${more}`;
}

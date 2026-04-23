/**
 * Plan Forge Knowledge Graph — Builder (Phase-38.3).
 * @module graph/builder
 */
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { NODE_TYPES, EDGE_TYPES } from "./schema.mjs";

function parsePlanFiles(plansDir) {
  const nodes = [];
  const edges = [];
  if (!existsSync(plansDir)) return { nodes, edges };
  let files;
  try {
    files = readdirSync(plansDir).filter(f => f.endsWith(".md"));
  } catch {
    return { nodes, edges };
  }
  for (const file of files) {
    try {
      const content = readFileSync(join(plansDir, file), "utf8");
      const lines = content.split("\n");
      let phaseId = null;
      let phaseName = null;
      // Try frontmatter crucibleId
      if (lines[0]?.trim() === "---") {
        const fmEnd = lines.indexOf("---", 1);
        if (fmEnd > 0) {
          for (let i = 1; i < fmEnd; i++) {
            const m = lines[i].match(/^crucibleId:\s*(.+)/);
            if (m) { phaseId = m[1].trim(); phaseName = phaseId; }
          }
        }
      }
      // Try # Phase-XX.X heading
      for (const line of lines) {
        const m = line.match(/^#\s+(Phase-[\d.]+.*)/);
        if (m) {
          if (!phaseId) phaseId = m[1].trim().replace(/\s+/g, "-");
          phaseName = m[1].trim();
          break;
        }
      }
      if (!phaseId) {
        phaseId = file.replace(/\.md$/, "");
        phaseName = phaseId;
      }
      const phaseNode = { id: `phase-${phaseId}`, type: NODE_TYPES.PHASE, name: phaseName, metadata: { file } };
      nodes.push(phaseNode);
      // Extract Slice nodes from ### Slice N — headings
      for (const line of lines) {
        const sm = line.match(/^###\s+(Slice\s+\d+\s*[—-].+)/i);
        if (sm) {
          const sliceName = sm[1].trim();
          const sliceId = `slice-${phaseId}-${sliceName.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9\-]/g, "").toLowerCase()}`;
          nodes.push({ id: sliceId, type: NODE_TYPES.SLICE, name: sliceName, metadata: { phase: phaseId } });
          edges.push({ from: phaseNode.id, to: sliceId, type: EDGE_TYPES.PHASE_TO_SLICE });
        }
      }
    } catch {
      // skip malformed files
    }
  }
  return { nodes, edges };
}

function parseCommits(projectDir, since, execSyncFn) {
  const nodes = [];
  const sincePart = since || "90 days ago";
  try {
    const fn = execSyncFn || execSync;
    const output = fn(`git log --format="%H %s" --since="${sincePart}"`, { cwd: projectDir, encoding: "utf8" });
    const lines = (output || "").split("\n").filter(Boolean);
    for (const line of lines) {
      const spaceIdx = line.indexOf(" ");
      if (spaceIdx < 0) continue;
      const hash = line.slice(0, spaceIdx);
      const subject = line.slice(spaceIdx + 1);
      nodes.push({
        id: `commit-${hash}`,
        type: NODE_TYPES.COMMIT,
        name: subject,
        metadata: { hash, subject },
      });
    }
  } catch {
    // no git or no commits — return empty
  }
  return nodes;
}

function inferSliceCommitEdges(sliceNodes, commitNodes) {
  const edges = [];
  for (const commit of commitNodes) {
    const subject = (commit.metadata?.subject || commit.name || "").toLowerCase();
    for (const slice of sliceNodes) {
      // Extract keywords from slice name
      const sliceWords = slice.name.toLowerCase().split(/[\s\-—]+/).filter(w => w.length > 3);
      for (const word of sliceWords) {
        if (subject.includes(word)) {
          edges.push({ from: slice.id, to: commit.id, type: EDGE_TYPES.SLICE_TO_COMMIT });
          break;
        }
      }
    }
  }
  return edges;
}

function parseRuns(forgeDir) {
  const nodes = [];
  const runsDir = join(forgeDir, "runs");
  if (!existsSync(runsDir)) return nodes;
  // Glob runs/**/*.json — walk dirs
  const phaseCounters = {};
  function walkDir(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(full);
      } else if (entry.name.endsWith(".json")) {
        try {
          const data = JSON.parse(readFileSync(full, "utf8"));
          const phaseKey = data.phase || "unknown";
          phaseCounters[phaseKey] = (phaseCounters[phaseKey] || 0) + 1;
          if (phaseCounters[phaseKey] > 10) continue; // last 10 runs per phase
          nodes.push({
            id: `run-${data.id || entry.name.replace(".json", "")}`,
            type: NODE_TYPES.RUN,
            name: data.id || entry.name.replace(".json", ""),
            metadata: { phase: data.phase, startedAt: data.startedAt },
          });
        } catch { /* skip malformed */ }
      }
    }
  }
  walkDir(runsDir);
  return nodes;
}

function parseBugs(forgeDir) {
  const nodes = [];
  const bugsDir = join(forgeDir, "bugs");
  if (!existsSync(bugsDir)) return nodes;
  function walkDir(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(full);
      } else if (entry.name.endsWith(".json")) {
        if (nodes.length >= 200) return; // bound at 200 bugs
        try {
          const data = JSON.parse(readFileSync(full, "utf8"));
          nodes.push({
            id: `bug-${data.id || entry.name.replace(".json", "")}`,
            type: NODE_TYPES.BUG,
            name: data.title || data.id || entry.name.replace(".json", ""),
            metadata: { severity: data.severity, id: data.id },
          });
        } catch { /* skip malformed */ }
      }
    }
  }
  walkDir(bugsDir);
  return nodes;
}

function writeSnapshot(forgeDir, graph) {
  try {
    const graphDir = join(forgeDir, "graph");
    mkdirSync(graphDir, { recursive: true });
    const snapshotPath = join(graphDir, "snapshot.json");
    const tmpPath = snapshotPath + ".tmp";
    writeFileSync(tmpPath, JSON.stringify(graph, null, 2), "utf8");
    renameSync(tmpPath, snapshotPath);
  } catch { /* non-fatal */ }
}

/**
 * Build the knowledge graph from project artifacts.
 * @param {string} projectDir
 * @param {{ since?: string, execSyncFn?: Function }} [opts]
 * @returns {{ nodes: Array, edges: Array }}
 */
export function buildGraph(projectDir, opts = {}) {
  const { since, execSyncFn } = opts;
  try {
    const plansDir = join(projectDir, "docs", "plans");
    const forgeDir = join(projectDir, ".forge");
    const { nodes: planNodes, edges: planEdges } = parsePlanFiles(plansDir);
    const sliceNodes = planNodes.filter(n => n.type === NODE_TYPES.SLICE);
    const commitNodes = parseCommits(projectDir, since, execSyncFn);
    const sliceCommitEdges = inferSliceCommitEdges(sliceNodes, commitNodes);
    const runNodes = parseRuns(forgeDir);
    const bugNodes = parseBugs(forgeDir);
    const nodes = [...planNodes, ...commitNodes, ...runNodes, ...bugNodes];
    const edges = [...planEdges, ...sliceCommitEdges];
    const graph = { nodes, edges };
    writeSnapshot(forgeDir, graph);
    return graph;
  } catch {
    return { nodes: [], edges: [] };
  }
}

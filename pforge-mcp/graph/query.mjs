/**
 * Plan Forge Knowledge Graph — Query API (Phase-38.3).
 * @module graph/query
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildGraph } from "./builder.mjs";

let _cachedGraph = null;
let _cachedProjectDir = null;

function loadGraph(projectDir) {
  if (_cachedGraph && _cachedProjectDir === projectDir) return _cachedGraph;
  const snapshotPath = join(projectDir, ".forge", "graph", "snapshot.json");
  if (existsSync(snapshotPath)) {
    try {
      _cachedGraph = JSON.parse(readFileSync(snapshotPath, "utf8"));
      _cachedProjectDir = projectDir;
      return _cachedGraph;
    } catch { /* fall through to rebuild */ }
  }
  _cachedGraph = buildGraph(projectDir);
  _cachedProjectDir = projectDir;
  return _cachedGraph;
}

export function _resetGraphCache() {
  _cachedGraph = null;
  _cachedProjectDir = null;
}

function formatResult(nodes, edges) {
  return { nodes, edges, nodeCount: nodes.length, edgeCount: edges.length };
}

/**
 * Filter graph to Phase node with matching name + connected subgraph.
 */
export function queryByPhase(name, opts = {}) {
  const projectDir = opts.projectDir || process.cwd();
  const { nodes, edges } = loadGraph(projectDir);
  const phaseNode = nodes.find(n => n.type === "Phase" && (n.name?.toLowerCase().includes(name.toLowerCase()) || n.id?.toLowerCase().includes(name.toLowerCase())));
  if (!phaseNode) return formatResult([], []);
  const visited = new Set([phaseNode.id]);
  const resultEdges = [];
  const queue = [phaseNode.id];
  while (queue.length) {
    const nodeId = queue.shift();
    for (const edge of edges) {
      if (edge.from === nodeId || edge.to === nodeId) {
        const otherId = edge.from === nodeId ? edge.to : edge.from;
        resultEdges.push(edge);
        if (!visited.has(otherId)) {
          visited.add(otherId);
          queue.push(otherId);
        }
      }
    }
  }
  const resultNodes = nodes.filter(n => visited.has(n.id));
  return formatResult(resultNodes, resultEdges);
}

/**
 * Find File nodes matching path + connected commits and tests.
 */
export function queryByFile(path, opts = {}) {
  const projectDir = opts.projectDir || process.cwd();
  const { nodes, edges } = loadGraph(projectDir);
  const fileNodes = nodes.filter(n => n.type === "File" && (n.name?.includes(path) || n.id?.includes(path)));
  if (!fileNodes.length) return formatResult([], []);
  const visited = new Set(fileNodes.map(n => n.id));
  const resultEdges = [];
  for (const fileNode of fileNodes) {
    for (const edge of edges) {
      if (edge.from === fileNode.id || edge.to === fileNode.id) {
        const otherId = edge.from === fileNode.id ? edge.to : edge.from;
        resultEdges.push(edge);
        visited.add(otherId);
      }
    }
  }
  const resultNodes = nodes.filter(n => visited.has(n.id));
  return formatResult(resultNodes, resultEdges);
}

function parseSinceDate(since) {
  if (!since) return null;
  const relMatch = since.match(/^(\d+)d$/);
  if (relMatch) {
    const days = parseInt(relMatch[1], 10);
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }
  const d = new Date(since);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Filter Commit/Slice/Run nodes by since date and optional type.
 */
export function queryRecentChanges({ since, type } = {}, opts = {}) {
  const projectDir = opts.projectDir || process.cwd();
  const { nodes, edges } = loadGraph(projectDir);
  const sinceDate = parseSinceDate(since);
  const RECENT_TYPES = ["Commit", "Slice", "Run"];
  let filtered = nodes.filter(n => RECENT_TYPES.includes(n.type));
  if (type) {
    filtered = filtered.filter(n => n.type?.toLowerCase() === type.toLowerCase());
  }
  if (sinceDate) {
    filtered = filtered.filter(n => {
      const ts = n.metadata?.startedAt || n.metadata?.committedAt;
      if (!ts) return true; // include if no date
      return new Date(ts) >= sinceDate;
    });
  }
  const filteredIds = new Set(filtered.map(n => n.id));
  const filteredEdges = edges.filter(e => filteredIds.has(e.from) && filteredIds.has(e.to));
  return formatResult(filtered, filteredEdges);
}

/**
 * 1-hop BFS from nodeId; optional edgeType filter.
 */
export function neighbors(nodeId, opts = {}) {
  const projectDir = opts.projectDir || process.cwd();
  const { nodes, edges } = loadGraph(projectDir);
  const startNode = nodes.find(n => n.id === nodeId);
  if (!startNode) return formatResult([], []);
  const visited = new Set([nodeId]);
  const resultEdges = [];
  for (const edge of edges) {
    if (opts.edgeType && edge.type !== opts.edgeType) continue;
    if (edge.from === nodeId || edge.to === nodeId) {
      const otherId = edge.from === nodeId ? edge.to : edge.from;
      resultEdges.push(edge);
      visited.add(otherId);
    }
  }
  const resultNodes = nodes.filter(n => visited.has(n.id));
  return formatResult(resultNodes, resultEdges);
}

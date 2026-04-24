#!/usr/bin/env node
/**
 * pforge graph — Knowledge graph CLI helper.
 * Usage: node scripts/graph.mjs rebuild|stats|query [type]
 */
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const mcpDir = join(repoRoot, "pforge-mcp");

const [,, subcommand, ...rest] = process.argv;

async function main() {
  if (!subcommand || subcommand === "help") {
    console.log("Usage: node scripts/graph.mjs rebuild|stats|query [type]");
    console.log("  rebuild   Rebuild the knowledge graph snapshot");
    console.log("  stats     Print node count by type");
    console.log("  query     Query the graph by type (phase, file, recent-changes, neighbors)");
    process.exit(0);
  }
  if (subcommand === "rebuild") {
    const { buildGraph } = await import(pathToFileURL(join(mcpDir, "graph", "builder.mjs")).href);
    const graph = buildGraph(repoRoot);
    const typeCounts = {};
    for (const node of graph.nodes) {
      typeCounts[node.type] = (typeCounts[node.type] || 0) + 1;
    }
    console.log(`Graph rebuilt: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
    for (const [type, count] of Object.entries(typeCounts)) {
      console.log(`  ${type}: ${count}`);
    }
  } else if (subcommand === "stats") {
    const snapshotPath = join(repoRoot, ".forge", "graph", "snapshot.json");
    if (!existsSync(snapshotPath)) {
      console.log("No snapshot found. Run: node scripts/graph.mjs rebuild");
      process.exit(0);
    }
    const graph = JSON.parse(readFileSync(snapshotPath, "utf8"));
    const typeCounts = {};
    for (const node of graph.nodes) {
      typeCounts[node.type] = (typeCounts[node.type] || 0) + 1;
    }
    console.log(`Snapshot stats: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
    for (const [type, count] of Object.entries(typeCounts)) {
      console.log(`  ${type}: ${count}`);
    }
  } else if (subcommand === "query") {
    const queryType = rest[0] || "recent-changes";
    const { queryRecentChanges, queryByPhase, queryByFile, neighbors } = await import(pathToFileURL(join(mcpDir, "graph", "query.mjs")).href);
    let result;
    if (queryType === "phase") {
      result = queryByPhase(rest[1] || "", { projectDir: repoRoot });
    } else if (queryType === "file") {
      result = queryByFile(rest[1] || "", { projectDir: repoRoot });
    } else if (queryType === "neighbors") {
      result = neighbors(rest[1] || "", { projectDir: repoRoot });
    } else {
      result = queryRecentChanges({ type: rest[1] }, { projectDir: repoRoot });
    }
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.error(`Unknown subcommand: ${subcommand}`);
    process.exit(1);
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });

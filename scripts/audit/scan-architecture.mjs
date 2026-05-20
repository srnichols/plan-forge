import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const outFile = path.join(root, 'docs', 'plans', 'cleanup-findings', 'raw', 'architecture-report.json');
const policyPath = path.join(root, 'scripts', 'audit', 'layer-policy.json');
const ninetyDayThreshold = '90 days ago';

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function globToRegExp(pattern) {
  const escaped = pattern
    .replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLE_STAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DOUBLE_STAR::/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function loadPolicy() {
  const raw = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  return {
    ...raw,
    layers: raw.layers.map((layer) => ({
      ...layer,
      matchers: layer.paths.map((pattern) => globToRegExp(pattern))
    }))
  };
}

function runMadge(scanRoot) {
  const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(npxBin, ['madge', '--json', scanRoot], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true
  });

  if (result.error) {
    return { error: result.error.message };
  }

  try {
    return { graph: JSON.parse(result.stdout) };
  } catch {
    return {
      error: `Unable to parse madge output for ${scanRoot}`,
      stdout: result.stdout?.trim(),
      stderr: result.stderr?.trim(),
      exitCode: result.status
    };
  }
}

function normalizeGraph(scanRoot, graph) {
  const normalized = new Map();
  for (const [file, deps] of Object.entries(graph)) {
    const repoFile = toPosix(path.posix.normalize(path.posix.join(scanRoot, toPosix(file))));
    const fromDir = path.posix.dirname(repoFile);
    const normalizedDeps = (deps ?? []).map((dep) => {
      const depValue = toPosix(dep);
      if (depValue.startsWith('.')) {
        return path.posix.normalize(path.posix.join(fromDir, depValue));
      }
      if (depValue.startsWith('..')) {
        return path.posix.normalize(path.posix.join(fromDir, depValue));
      }
      return path.posix.normalize(path.posix.join(scanRoot, depValue));
    });
    normalized.set(repoFile, normalizedDeps);
  }
  return normalized;
}

function tarjan(graph) {
  let index = 0;
  const indices = new Map();
  const lowLinks = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];

  function strongConnect(node) {
    indices.set(node, index);
    lowLinks.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);

    for (const next of graph.get(node) ?? []) {
      if (!graph.has(next)) {
        continue;
      }
      if (!indices.has(next)) {
        strongConnect(next);
        lowLinks.set(node, Math.min(lowLinks.get(node), lowLinks.get(next)));
      } else if (onStack.has(next)) {
        lowLinks.set(node, Math.min(lowLinks.get(node), indices.get(next)));
      }
    }

    if (lowLinks.get(node) === indices.get(node)) {
      const component = [];
      let popped;
      do {
        popped = stack.pop();
        onStack.delete(popped);
        component.push(popped);
      } while (popped !== node);
      if (component.length >= 2) {
        components.push(component.sort());
      }
    }
  }

  for (const node of graph.keys()) {
    if (!indices.has(node)) {
      strongConnect(node);
    }
  }

  return components.sort((left, right) => right.length - left.length);
}

function detectLayer(pathValue, policy) {
  return policy.layers.find((layer) => layer.matchers.some((matcher) => matcher.test(pathValue))) ?? null;
}

function buildReverseGraph(graph) {
  const reverse = new Map();
  for (const node of graph.keys()) {
    reverse.set(node, new Set());
  }
  for (const [source, deps] of graph.entries()) {
    for (const dep of deps) {
      if (!reverse.has(dep)) {
        reverse.set(dep, new Set());
      }
      reverse.get(dep).add(source);
    }
  }
  return reverse;
}

const commitCountCache = new Map();
function getCommitCount(file) {
  if (commitCountCache.has(file)) {
    return commitCountCache.get(file);
  }
  const result = spawnSync('git', ['log', `--since=${ninetyDayThreshold}`, '--format=%H', '--', file], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true
  });
  const count = result.stdout
    ?.split(/\r?\n/)
    .filter((line) => line.trim().length > 0).length ?? 0;
  commitCountCache.set(file, count);
  return count;
}

function packageName(file) {
  if (file.startsWith('pforge-mcp/')) {
    return 'pforge-mcp';
  }
  if (file.startsWith('pforge-master/')) {
    return 'pforge-master';
  }
  return 'other';
}

function writeJson(payload) {
  ensureDir(path.dirname(outFile));
  fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

try {
  const policy = loadPolicy();
  const combined = new Map();
  const errors = [];

  for (const scanRoot of ['pforge-mcp', 'pforge-master']) {
    const result = runMadge(scanRoot);
    if (result.error) {
      errors.push({ scanRoot, message: result.error, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode });
      continue;
    }
    const normalizedGraph = normalizeGraph(scanRoot, result.graph);
    for (const [file, deps] of normalizedGraph.entries()) {
      combined.set(file, deps);
    }
  }

  const cycles = tarjan(combined).map((component) => ({ files: component, size: component.length }));
  const crossLayerImports = [];
  const seenEdges = new Set();

  for (const [source, deps] of combined.entries()) {
    const sourceLayer = detectLayer(source, policy);
    for (const target of deps) {
      const edgeKey = `${source} -> ${target}`;
      if (seenEdges.has(edgeKey)) {
        continue;
      }
      seenEdges.add(edgeKey);

      const targetLayer = detectLayer(target, policy);
      if (sourceLayer && targetLayer && sourceLayer.level < targetLayer.level) {
        crossLayerImports.push({
          source,
          target,
          sourceLayer: sourceLayer.name,
          targetLayer: targetLayer.name,
          reason: 'inner-depends-on-outer'
        });
        continue;
      }

      if (policy.flagCrossPackage && packageName(source) !== packageName(target) && packageName(target) !== 'other') {
        if (!policy.crossPackageWhitelist.includes(edgeKey)) {
          crossLayerImports.push({
            source,
            target,
            sourceLayer: sourceLayer?.name ?? null,
            targetLayer: targetLayer?.name ?? null,
            reason: 'cross-package'
          });
        }
      }
    }
  }

  const reverseGraph = buildReverseGraph(combined);
  const highFanInVolatile = [];
  const highFanOutUnstable = [];

  for (const [file, deps] of combined.entries()) {
    const fanIn = reverseGraph.get(file)?.size ?? 0;
    if (fanIn >= 5) {
      const commitCount = getCommitCount(file);
      if (commitCount >= 10) {
        highFanInVolatile.push({ file, fanIn, commitCount90Days: commitCount });
      }
    }

    const uniqueDeps = [...new Set(deps.filter((dep) => combined.has(dep)))];
    const fanOut = uniqueDeps.length;
    if (fanOut >= 8) {
      const volatileDeps = uniqueDeps.filter((dep) => getCommitCount(dep) >= 5);
      const volatileRatio = fanOut === 0 ? 0 : volatileDeps.length / fanOut;
      if (volatileRatio > 0.5) {
        highFanOutUnstable.push({
          file,
          fanOut,
          volatileDeps: volatileDeps.length,
          volatileRatio: Number(volatileRatio.toFixed(2))
        });
      }
    }
  }

  writeJson({
    cycles,
    crossLayerImports,
    highFanInVolatile: highFanInVolatile.sort((left, right) => right.fanIn - left.fanIn),
    highFanOutUnstable: highFanOutUnstable.sort((left, right) => right.fanOut - left.fanOut),
    errors
  });
} catch (error) {
  writeJson({
    cycles: [],
    crossLayerImports: [],
    highFanInVolatile: [],
    highFanOutUnstable: [],
    errors: [{ message: error instanceof Error ? error.message : String(error) }]
  });
}

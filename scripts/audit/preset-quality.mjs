#!/usr/bin/env node
/**
 * Preset quality gate (#301).
 *
 *   node scripts/audit/preset-quality.mjs [--presets php,rust] [--php] [--json]
 *
 * Mechanical checks that caught the #292 regressions (filler, copied blocks,
 * another stack's content) plus code-sample checks, over presets/<stack>/:
 *   filler            "[N]" counter bullets, "## Done Criteria", "// Example:" lines
 *   duplicate-block   the same 3+ line code block in two files of one preset
 *   wrong-stack       Go idioms outside the go preset
 *   skill-no-steps    a SKILL.md forge_run_skill would find no steps in
 *   shell-syntax      a ```bash / ```sh block that fails `bash -n` (<placeholders> allowed)
 *   php-lint          (--php) a ```php block that fails `php -l`; uses php on PATH,
 *                     or Docker php:8.4-cli when php is missing
 * Exits 1 when anything is found.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const MIN_BLOCK_LINES = 3;
const PHP_IMAGE = "php:8.4-cli";
const GO_IDIOMS = [/func \(/, /net\/http/, /\bslog\b/, /goroutine/i, /GOOS=/, /\bChi\b/, /\bGin\b/, /pprof/, /errgroup/];
// Lists starter principles for every stack, Go included.
const MULTI_STACK_FILES = new Set([".github/prompts/project-principles.prompt.md"]);
const FENCE = /^```([\w-]*)[^\n]*\n([\s\S]*?)^```/gm;

// ─── Reading a preset ───────────────────────────────────────────────────────

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

/** Markdown files of a preset as { rel, text } with LF line endings. */
export function readPreset(presetDir) {
  return walk(presetDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => ({ path: f, rel: relative(presetDir, f).replace(/\\/g, "/"), text: readFileSync(f, "utf8").replace(/\r/g, "") }));
}

/** Fenced code blocks of a file as { lang, body, line }. */
export function codeBlocks(text) {
  return [...text.matchAll(FENCE)].map((m) => ({
    lang: m[1].toLowerCase(),
    body: m[2],
    line: text.slice(0, m.index).split("\n").length,
  }));
}

// ─── Text checks ────────────────────────────────────────────────────────────

function fillerFindings(file) {
  const out = [];
  file.text.split("\n").forEach((raw, i) => {
    const t = raw.trim();
    const hit = /\[\d+\]$/.test(t) ? "counter bullet" : /^## Done Criteria/.test(t) ? "Done Criteria section" : /^\/\/ Example: /.test(t) ? "// Example: line" : null;
    if (hit) out.push({ rule: "filler", file: file.rel, line: i + 1, detail: `${hit}: ${t.slice(0, 70)}` });
  });
  return out;
}

function wrongStackFindings(file, preset) {
  if (preset === "go" || MULTI_STACK_FILES.has(file.rel)) return [];
  const out = [];
  file.text.split("\n").forEach((raw, i) => {
    if (GO_IDIOMS.some((re) => re.test(raw))) out.push({ rule: "wrong-stack", file: file.rel, line: i + 1, detail: `Go idiom: ${raw.trim().slice(0, 70)}` });
  });
  return out;
}

function duplicateBlockFindings(files) {
  const seen = new Map();
  const out = [];
  for (const file of files) {
    for (const block of codeBlocks(file.text)) {
      const body = block.body.trim();
      if (body.split("\n").length < MIN_BLOCK_LINES) continue;
      const first = seen.get(body);
      if (first && first.rel !== file.rel) {
        out.push({ rule: "duplicate-block", file: file.rel, line: block.line, detail: `same block as ${first.rel}:${first.line}` });
      } else if (!first) {
        seen.set(body, { rel: file.rel, line: block.line });
      }
    }
  }
  return out;
}

async function skillFindings(files) {
  const { parseSkill } = await import(pathToFileURL(join(REPO, "pforge-mcp", "skill-runner.mjs")).href);
  return files
    .filter((f) => f.rel.endsWith("SKILL.md") && parseSkill(f.path).steps.length === 0)
    .map((f) => ({ rule: "skill-no-steps", file: f.rel, line: 1, detail: "no ### N. / ### Step N / ## Phase N headings" }));
}

// ─── Code checks that run a tool ────────────────────────────────────────────

function findBash() {
  if (process.platform !== "win32") return "bash";
  return ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].find((p) => existsSync(p)) ?? null;
}

/**
 * Write each sample to a temp file and run `checker` once over the directory.
 * The checker prints "<n>\t<message>" for every failing sample n.
 */
function runSamples(samples, { ext, run }) {
  if (samples.length === 0) return [];
  const dir = mkdtempSync(join(tmpdir(), "pf-preset-samples-"));
  try {
    samples.forEach((s, i) => writeFileSync(join(dir, `${i}${ext}`), s.code));
    const r = run(dir);
    if (r.status !== 0 && !r.stdout) throw new Error(`sample checker failed: ${r.stderr || r.error?.message}`);
    return r.stdout.split("\n").filter(Boolean).map((line) => {
      const [n, ...msg] = line.split("\t");
      const s = samples[Number(n)];
      return { rule: s.rule, file: s.file, line: s.line, detail: msg.join(" ").trim().slice(0, 100), preset: s.preset };
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function shellSamples(preset, files) {
  return files.flatMap((f) => codeBlocks(f.text)
    .filter((b) => b.lang === "bash" || b.lang === "sh")
    // Documented <placeholder> arguments are not shell redirections.
    .map((b) => ({ preset, rule: "shell-syntax", file: f.rel, line: b.line, code: b.body.replace(/<[A-Za-z][\w.:/-]*>/g, "PLACEHOLDER") })));
}

function phpSamples(preset, files) {
  return files.flatMap((f) => codeBlocks(f.text)
    .filter((b) => b.lang === "php")
    .map((b) => ({ preset, rule: "php-lint", file: f.rel, line: b.line, code: /^\s*<\?php/.test(b.body) ? b.body : `<?php\n${b.body}` })));
}

const SHELL_LOOP = 'cd "$1" && for f in *.sh; do e=$(bash -n "$f" 2>&1) || printf "%s\\t%s\\n" "${f%.sh}" "$(printf %s "$e" | head -1 | sed "s/^[^:]*: //")"; done; true';
const PHP_LOOP = 'cd "$1" && for f in *.php; do e=$(php -l "$f" 2>&1) || printf "%s\\t%s\\n" "${f%.php}" "$(printf %s "$e" | grep -m1 -i error)"; done; true';

function checkShell(samples) {
  const bash = findBash();
  if (!bash) throw new Error("bash not found; install Git Bash to check shell samples");
  return runSamples(samples, { ext: ".sh", run: (dir) => spawnSync(bash, ["-c", SHELL_LOOP, "_", toBashPath(bash, dir)], { encoding: "utf8" }) });
}

function checkPhp(samples) {
  const local = spawnSync("php", ["-v"], { stdio: "ignore" }).status === 0;
  const bash = findBash();
  return runSamples(samples, {
    ext: ".php",
    run: (dir) => (local
      ? spawnSync(bash, ["-c", PHP_LOOP, "_", toBashPath(bash, dir)], { encoding: "utf8" })
      : spawnSync("docker", ["run", "--rm", "-v", `${dir}:/samples`, PHP_IMAGE, "sh", "-c", PHP_LOOP, "_", "/samples"], { encoding: "utf8" })),
  });
}

function toBashPath(bash, p) {
  if (process.platform !== "win32") return p;
  const r = spawnSync(bash, ["-c", 'cygpath -u "$1"', "_", p], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : p.replace(/\\/g, "/");
}

// ─── Scan ───────────────────────────────────────────────────────────────────

/** Text-only findings for one preset (no external tools). */
export async function scanPresetText(presetDir, preset) {
  const files = readPreset(presetDir);
  const perFile = files.flatMap((f) => [...fillerFindings(f), ...wrongStackFindings(f, preset)]);
  const found = [...perFile, ...duplicateBlockFindings(files), ...(await skillFindings(files))];
  return { files, findings: found.map((x) => ({ preset, ...x })) };
}

export async function scanPresets({ root = REPO, presets = null, php = false } = {}) {
  const presetsDir = join(root, "presets");
  const names = presets ?? readdirSync(presetsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  const findings = [];
  const shell = [];
  const phpCode = [];
  for (const name of names) {
    const scanned = await scanPresetText(join(presetsDir, name), name);
    findings.push(...scanned.findings);
    shell.push(...shellSamples(name, scanned.files));
    if (php) phpCode.push(...phpSamples(name, scanned.files));
  }
  findings.push(...checkShell(shell), ...(php ? checkPhp(phpCode) : []));
  return { presets: names, findings, samples: { shell: shell.length, php: phpCode.length } };
}

async function main() {
  const argv = process.argv.slice(2);
  const at = argv.indexOf("--presets");
  const presets = at >= 0 ? argv[at + 1].split(",").map((s) => s.trim()) : null;
  const result = await scanPresets({ presets, php: argv.includes("--php") });
  if (argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const f of result.findings) console.log(`${f.rule.padEnd(16)} presets/${f.preset}/${f.file}:${f.line}  ${f.detail}`);
    const php = argv.includes("--php") ? `, ${result.samples.php} PHP samples` : "";
    console.log(`${result.presets.length} presets, ${result.samples.shell} shell samples${php}: ${result.findings.length} finding(s)`);
  }
  return result.findings.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (err) => {
    console.error(`preset-quality: ${err.message}`);
    process.exitCode = 2;
  });
}

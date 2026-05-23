---
name: clean-code-review
description: Stack-agnostic Clean Code audit — module size, function-length/complexity (via your project's existing linter), long parameter lists, TODO/FIXME/HACK markers, commented-out code, debug-print leakage, and optional duplication detection. Produces a structured findings report with optional fix suggestions. Use before merges, at end of a feature, or as a regular hygiene pass.
argument-hint: "[--scope <glob>] [--fix-suggestions] [--severity error|warn|info] [--out <path>]"
tools:
  - read_file
  - run_in_terminal
  - file_search
  - grep_search
---

# `/clean-code-review` Skill

## Trigger
"Run a clean code review" / "Audit the codebase for Clean Code violations" / "Check code quality" / `/clean-code-review`

## Purpose

A stack-agnostic mechanical pass that complements the qualitative `/code-review` skill. It enforces the thresholds defined in [.github/instructions/clean-code.instructions.md](../../instructions/clean-code.instructions.md) — module size, function length, complexity, parameter count, naming, debug leakage, and duplication — using whatever linters the project already has installed plus a small set of language-agnostic checks.

Run this skill **before** `/code-review`. The mechanical findings clear the noise so the qualitative review focuses on what actually requires judgment.

## Inputs

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--scope <glob>` | No | source dirs auto-detected | Comma-separated globs limiting the audit scope (e.g. `src/**,lib/**`). When omitted, the skill scans common source roots (`src`, `lib`, `app`, `internal`, the project's primary package dir) and skips `node_modules`, `bin`, `obj`, `dist`, `build`, `.venv`, `vendor`, `target`. |
| `--fix-suggestions` | No | off | When present, each finding includes a concrete remediation suggestion. |
| `--severity <level>` | No | `warn` | Minimum severity to report: `error`, `warn`, or `info`. |
| `--out <path>` | No | stdout (formatted) | Write the full JSON report to this path instead of printing a summary. |

## Steps

### 1. Detect the project's lint command

Inspect the project for an existing lint setup; do NOT install new tooling. Report **all** that are present and use the first that works:

| Marker file | Command to run |
|-------------|----------------|
| `package.json` with a `lint` script | `npm run lint -- --format json` (or `--format=json`) |
| `package.json` with `eslint` devDep but no `lint` script | `npx eslint . --format json` |
| `pyproject.toml` with `ruff` configured | `ruff check . --output-format=json` |
| `pyproject.toml` / `setup.cfg` with `flake8` | `flake8 --format=json .` |
| `*.csproj` or `*.sln` | `dotnet format --verify-no-changes --report .clean-code-review.json` (analyzer findings) plus `dotnet build -warnaserror:false -clp:NoSummary` (warnings) |
| `go.mod` | `go vet ./...` and `golangci-lint run --out-format json` (if installed) |
| `Cargo.toml` | `cargo clippy --message-format=json -- -W clippy::cognitive_complexity -W clippy::too_many_arguments -W clippy::too_many_lines` |
| `pom.xml` / `build.gradle*` | `mvn -q spotbugs:check` or `gradle spotbugsMain` (if configured) |
| `composer.json` | `vendor/bin/phpstan analyse --error-format=json` or `vendor/bin/phpcs --report=json` |

Parse the linter's JSON output for **rule families that map to Clean Code thresholds**:

- Cyclomatic complexity (`complexity`, `cognitive-complexity`, `too_many_lines`, `cognitive_complexity`)
- Function length (`max-lines-per-function`, `too_many_lines`, method-length analyzers)
- Parameter count (`max-params`, `too_many_arguments`, parameter-count analyzers)
- Nesting depth (`max-depth`, `max-nested-callbacks`)
- Magic numbers (`no-magic-numbers`, `magic_number_in_arrays` and similar)

> **Conditional**: If no linter is present or no rule families match, skip this step and note **"Linter scan skipped — no compatible linter configured. Configure a linter for your stack to enable AST-precise complexity, function-length, and param-count checks."** in the report. The remaining steps still produce useful findings.

### 2. Module-size scan (language-agnostic)

For every source file under `--scope`, count non-blank, non-comment-only lines. Use one of:

```bash
# Cross-platform via Node (no install required if Node is present)
node -e "const fs=require('fs'),path=require('path');function walk(d){return fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>{const p=path.join(d,e.name);if(['node_modules','bin','obj','dist','build','.venv','vendor','target','.git'].includes(e.name))return [];return e.isDirectory()?walk(p):[p];});}const exts=/\.(mjs|js|ts|tsx|jsx|cs|py|go|rs|java|kt|php|rb|swift)$/i;walk('.').filter(f=>exts.test(f)).map(f=>{const n=fs.readFileSync(f,'utf8').split('\n').filter(l=>l.trim()&&!/^\s*(\/\/|#|--|\*)/.test(l)).length;return {f,n};}).sort((a,b)=>b.n-a.n).slice(0,30).forEach(r=>console.log(r.n.toString().padStart(6),r.f));"
```

```pwsh
# PowerShell equivalent
Get-ChildItem -Recurse -Include *.mjs,*.js,*.ts,*.tsx,*.jsx,*.cs,*.py,*.go,*.rs,*.java,*.kt,*.php,*.rb,*.swift -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch '\\(node_modules|bin|obj|dist|build|\.venv|vendor|target|\.git)\\' } |
  ForEach-Object { [PSCustomObject]@{ LOC = (Get-Content $_.FullName | Where-Object { $_.Trim() -and $_ -notmatch '^\s*(\/\/|#|--|\*)' }).Count; Path = $_.FullName } } |
  Sort-Object LOC -Descending | Select-Object -First 30
```

Apply thresholds from `clean-code.instructions.md`:

| LOC | Severity | Action |
|-----|----------|--------|
| >3,000 | **error** | Blocking — extract sub-modules by Single Responsibility |
| 1,000–3,000 | **warn** | Monitor — extract on next feature touch to this file |
| <1,000 | info | No action |

### 3. Grep-matrix scan (TODO/FIXME/HACK + commented-out code + debug prints)

```bash
# Markers — every hit is a finding
grep -RInE "\b(TODO|FIXME|HACK|XXX)\b" --include="*.{mjs,js,ts,tsx,jsx,cs,py,go,rs,java,kt,php,rb,swift}" \
  --exclude-dir={node_modules,bin,obj,dist,build,.venv,vendor,target,.git} . | head -50
```

```bash
# Debug leakage — language-aware
grep -RInE "console\.(log|debug|info)" --include="*.{mjs,js,ts,tsx,jsx}" --exclude-dir={node_modules,dist,build} . | wc -l
grep -RInE "^\s*print\(" --include="*.py" --exclude-dir={.venv,build} . | wc -l
grep -RInE "fmt\.Println|log\.Println" --include="*.go" . | wc -l
grep -RInE "(Console\.WriteLine|Debug\.WriteLine)" --include="*.cs" --exclude-dir={bin,obj} . | wc -l
grep -RInE "println!|dbg!" --include="*.rs" --exclude-dir=target . | wc -l
```

Commented-out code heuristic: 4+ consecutive comment lines containing code-like syntax (semicolons, braces, assignment, function/method calls). Surface as a single advisory per file.

| Pattern | Severity | Reporting |
|---------|----------|-----------|
| `TODO` / `FIXME` / `HACK` / `XXX` | warn | One finding per occurrence with file:line |
| Commented-out code block (4+ lines) | warn | One finding per block with file:start-end |
| Debug print/log statements | info | **Bulk advisory** (count + sample). Do not report each occurrence — it floods the report |

### 4. Long-parameter-list scan (language-agnostic regex pass)

For each language, regex-match function/method signatures and count positional parameters. Flag any signature with **>4 positional parameters** (warn) or **>6** (error). The Step 1 linter handles this more precisely when configured — Step 4 is a fallback for projects without a linter rule for it.

```bash
# Node/TypeScript: function/arrow signatures with 5+ commas inside parens
grep -RInE "(function|=>)\s*\([^)]*,[^)]*,[^)]*,[^)]*,[^)]*\)" \
  --include="*.{mjs,js,ts,tsx,jsx}" --exclude-dir={node_modules,dist,build} . | head -30
```

Apply judgment — variadic `...rest`, generics, destructured arg objects, and inline type annotations skew the count.

### 5. Duplication detection (DRY)

Three sub-scans, each independently optional. Run all three when possible — they catch **different** classes of duplication.

#### 5.1 Block-level duplication (jscpd)

```bash
# If Node is available and the project hasn't already configured jscpd:
npx --yes jscpd --silent --reporters json --output ./.clean-code-review-jscpd \
  --pattern "**/*.{mjs,js,ts,tsx,jsx,cs,py,go,rs,java,kt,php,rb,swift}" \
  --ignore "**/{node_modules,bin,obj,dist,build,.venv,vendor,target,.git}/**" \
  --min-tokens 50 --min-lines 5 .
```

Parse `.clean-code-review-jscpd/jscpd-report.json`. For each `duplicates[]` entry report first-file + line range, second-file + line range, token count. Group by token count descending; show top 10.

> **Conditional**: If Node is not available, skip this sub-step and note **"Block-duplication scan skipped — Node.js not available."** in the report.

#### 5.2 Repeated string/numeric literals (cross-file)

`jscpd` only catches duplicated *blocks* — the surrounding code has to match. The same string literal scattered across 20 unrelated call sites (e.g. a hook name, error code, mode flag, config key) is invisible to it. This sub-scan catches them.

```bash
# Cross-language literal-duplication scan. Requires Node.
node -e "$(cat <<'NODE_EOF'
const fs = require('fs'), path = require('path');
const SKIP_DIRS = new Set(['node_modules','bin','obj','dist','build','.venv','vendor','target','.git','.next','__pycache__']);
const EXTS = /\.(mjs|js|ts|tsx|jsx|cs|py|go|rs|java|kt|php|rb|swift|scala)$/i;
const MIN_STR = 8, MIN_NUM = 3, MIN_FILES = 3;
const NOISE = [
  /^https?:\/\//,                  // URLs
  /^\.{0,2}\//,                    // unix paths
  /^[A-Za-z]:[\\\/]/,              // windows paths
  /^[0-9a-f]{16,}$/i,              // long hex hashes / SHAs
  /^node:/,                        // node:* builtins
  /^@[\w-]+\/[\w./-]+$/,           // scoped npm packages
  /^[a-z]+\/[a-z0-9+.\-_]+$/,      // mime types (application/json etc)
  /^[,\s]*\w[\w$]*:\s*$/,          // object-key fragment ": "
  /^,\s/,                          // template-string assembly fragment ", x"
  /:\s*$/,                         // trailing key marker
  /^\s*$/                          // pure whitespace
];
const KEYWORDS = new Set(['function','string','boolean','object','undefined','default','console','process','message','status','result','value','target','source','options','content','request','response','required','optional','warning']);
const files = [];
(function walk(d){ for(const e of fs.readdirSync(d,{withFileTypes:true})){ if(SKIP_DIRS.has(e.name)) continue; const p=path.join(d,e.name); if(e.isDirectory()) walk(p); else if(EXTS.test(e.name)) files.push(p);}})('.');
const occ = new Map(); // value -> [{file, line}]
for(const f of files){
  const lines = fs.readFileSync(f,'utf-8').split('\n');
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|#|--|\*)/.test(line)) return; // skip pure-comment lines
    // strings: "..." or '...' (coarse, no escape handling)
    for (const m of line.matchAll(/(["'])((?:(?!\1).){8,})\1/g)) {
      const v = m[2];
      if (NOISE.some(r => r.test(v))) continue;
      if (KEYWORDS.has(v)) continue;
      if (!occ.has(v)) occ.set(v, []);
      occ.get(v).push({file: f, line: i + 1});
    }
    // numbers (≥3 digits, integer or decimal; skip leading-zero hex/UUIDs)
    for (const m of line.matchAll(/(?<![\w.])([0-9]{3,}(?:\.[0-9]+)?)(?![\w.])/g)) {
      const v = m[1];
      if (NOISE.some(r => r.test(v))) continue;
      if (!occ.has(v)) occ.set(v, []);
      occ.get(v).push({file: f, line: i + 1});
    }
  });
}
const findings = [];
for (const [v, hits] of occ) {
  const distinctFiles = new Set(hits.map(h => h.file));
  if (distinctFiles.size >= MIN_FILES) {
    findings.push({ value: v, files: distinctFiles.size, occurrences: hits.length, sample: hits.slice(0, 5) });
  }
}
findings.sort((a, b) => b.occurrences - a.occurrences);
console.log(JSON.stringify({ totalFindings: findings.length, top: findings.slice(0, 25) }, null, 2));
NODE_EOF
)"
```

Report each finding as: `value`, file count, total occurrences, first 5 file:line samples. Severity: `warn`.

> **Why this matters**: The same hook name, mode flag, error code, or config key copy-pasted across files becomes a multi-week migration phase once it reaches 20+ sites. Catching duplication at copy #3 is one extract; catching it at #50 is a refactor sprint. See the DRY table in [clean-code.instructions.md](../../instructions/clean-code.instructions.md#L54).

> **Tuning**: `MIN_FILES=3` keeps noise low. Drop to `2` for stricter enforcement on smaller codebases. `MIN_STR=8` filters out single-word noise; raise to `12` if too many false positives.

> **Conditional**: If Node is not available, skip and note in report.

#### 5.3 Repeated regex literals (cross-file)

Catches the same regex defined in multiple places — a frequent DRY violation for validation patterns, log parsers, and route matchers.

```bash
node -e "$(cat <<'NODE_EOF'
const fs = require('fs'), path = require('path');
const SKIP_DIRS = new Set(['node_modules','bin','obj','dist','build','.venv','vendor','target','.git','.next','__pycache__']);
const EXTS = /\.(mjs|js|ts|tsx|jsx|cs|py|go|rs|java|kt|php|rb|swift|scala)$/i;
const MIN_FILES = 2;
// Language-specific regex-construction patterns. Captures the pattern literal.
const RX = [
  /new\s+RegExp\s*\(\s*(["'])((?:(?!\1).){4,})\1/g,                                                // JS/TS: new RegExp("...")
  /\bre\.(?:compile|match|search|fullmatch|sub|findall)\s*\(\s*r?(["'])((?:(?!\1).){4,})\1/g,        // Python
  /new\s+Regex\s*\(\s*@?(["'])((?:(?!\1).){4,})\1/g,                                                // C#
  /regexp\.MustCompile\s*\(\s*["`]((?:(?!["`]).){4,})["`]/g,                                        // Go
  /Regex::new\s*\(\s*r?[#]?["']((?:(?!["']).){4,})["']/g,                                           // Rust
  /Pattern\.compile\s*\(\s*["']((?:(?!["']).){4,})["']/g,                                           // Java
  /preg_(?:match|replace|split|grep)\s*\(\s*["']((?:(?!["']).){4,})["']/g,                          // PHP
];
const files = [];
(function walk(d){ for(const e of fs.readdirSync(d,{withFileTypes:true})){ if(SKIP_DIRS.has(e.name)) continue; const p=path.join(d,e.name); if(e.isDirectory()) walk(p); else if(EXTS.test(e.name)) files.push(p);}})('.');
const occ = new Map();
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf-8').split('\n');
  lines.forEach((line, i) => {
    for (const rx of RX) {
      for (const m of line.matchAll(rx)) {
        const pat = m[m.length - 1]; // last capture = pattern
        if (!occ.has(pat)) occ.set(pat, []);
        occ.get(pat).push({ file: f, line: i + 1 });
      }
    }
  });
}
const findings = [];
for (const [p, hits] of occ) {
  const distinctFiles = new Set(hits.map(h => h.file));
  if (distinctFiles.size >= MIN_FILES) {
    findings.push({ pattern: p, files: distinctFiles.size, occurrences: hits.length, sample: hits.slice(0, 5) });
  }
}
findings.sort((a, b) => b.occurrences - a.occurrences);
console.log(JSON.stringify({ totalFindings: findings.length, top: findings.slice(0, 25) }, null, 2));
NODE_EOF
)"
```

Report each finding as: `pattern`, file count, total occurrences, first 5 file:line samples. Severity: `warn`.

> **Why this matters**: Regex drift is the worst kind. When the validation rule changes, every copy needs updating; missing one creates a security or correctness gap. Centralize patterns in a single module from copy #2.

> **Conditional**: If Node is not available, skip and note in report.

### 6. Engineering hygiene scan (security + correctness regex matrix)

Eleven engineering anti-pattern checks with **cross-stack regex coverage**: JS/TS, Python, .NET, Java/Kotlin, Go, Rust, PHP, Swift, Ruby, PowerShell, and Bicep. Each rule self-gates on file extension — a Java rule only evaluates `.java`/`.kt` files, so a Python-only project gets zero extra noise from cross-stack checks. Each check is mapped to a specific principle in [`architecture-principles.instructions.md`](../../instructions/architecture-principles.instructions.md) or [`security.instructions.md`](../../instructions/security.instructions.md).

| Check | Severity | Catches | Stacks covered |
|-------|----------|---------|----------------|
| `empty-catch` | error | `catch (e) {}` / `except: pass` / `if err != nil {}` / `rescue ... end` / PS `catch {}` | JS/TS, C#, Java/Kt, Scala, Swift, Python, Go, Ruby, PowerShell |
| `exec-injection` | error | Interpolated shell commands (`` exec(`...${x}...`) ``, `Process.Start($"...{x}")`, `Runtime.exec(s+x)`, `exec.Command("sh","-c",x)`, `Command::new("sh")`, `shell_exec($x)`, Swift `Process` arg interp, PS `Invoke-Expression $x` / `iex $x`) | JS/TS, Python, C#, Java/Kt, Go, Rust, PHP, Swift, PowerShell |
| `disabled-test` | warn | `.skip` / `.only` / `xit` / `xdescribe` / `@pytest.mark.skip` / `@unittest.skip` / `[Ignore]` / `[Fact(Skip=...)]` / `@Disabled` / `@Ignore` / `t.Skip()` / `#[ignore]` / `markTestSkipped` / `XCTSkip` / Pester `-Skip` / `-Pending` | All 9 stacks + PowerShell |
| `hardcoded-secret` | error | Known token shapes (`sk-...`, `ghp_...`, `xox[bapsr]-...`, `AKIA...`, JWT `eyJ...eyJ...`) plus PS `ConvertTo-SecureString -AsPlainText "literal"` | All (token shapes are language-agnostic) + PowerShell, Bicep |
| `sql-injection` | error | Interpolated SQL (JS template `` ` ``, Py f-string, C# `$"..."`, Java `String.format`, Go `fmt.Sprintf`, Rust `format!`, PHP `.` concat) — requires uppercase SQL grammar shape (`WHERE`/`SET`/`FROM`/`INTO`) to keep false positives near zero | JS/TS, Python, C#, Java/Kt, Go, Rust, PHP |
| `dynamic-import` | warn | `` import(`./${name}`) `` / `` require(`./${name}`) `` — silent breakage after refactors | JS/TS |
| `loose-type` | warn | TS `: any` / `<any>` / `as any`, C# `dynamic x`, Py `: Any` / `-> Any`, Go bare `interface{}` | TS, C#, Python, Go |
| `magic-timeout` | info | `setTimeout`, `time.sleep`, `time.Sleep`, `thread::sleep`, `Thread.sleep`, `XCTWaiter`, `asyncio.sleep` with literal ≥1000; PS `Start-Sleep -Seconds ≥100` | All (covers most timeout APIs) + PowerShell |
| `cross-pkg-import` | warn | `from '../../sibling/src/...'` — monorepo internal-import boundary violation | JS/TS |
| `hardcoded-region` | warn | Bicep `location: 'eastus'` (any Azure region literal) — should be `param location string = resourceGroup().location` per `bicep.instructions.md` | Bicep |
| `insecure-config` | error | Bicep `publicNetworkAccess: 'Enabled'` / `minimumTlsVersion: 'TLS1_0\|1'` / `supportsHttpsTrafficOnly: false` / `allowBlobPublicAccess: true` | Bicep |

```bash
# Engineering hygiene scan. Requires Node. Single pass over source tree.
node -e "$(cat <<'NODE_EOF'
const fs = require('fs'), path = require('path');
const SKIP_DIRS = new Set(['node_modules','bin','obj','dist','build','.venv','vendor','target','.git','.next','__pycache__','.forge']);
const ALL = /\.(mjs|js|ts|tsx|jsx|cs|py|go|rs|java|kt|php|rb|swift|scala|ps1|psm1|bicep)$/i;
const CHECKS = [
  { id:'empty-catch',     sev:'error', exts:/\.(mjs|js|ts|tsx|jsx|cs|java|kt|scala|swift)$/i, re:/catch\s*\([^)]*\)\s*\{\s*\}/g },
  { id:'empty-catch',     sev:'error', exts:/\.py$/i,                                          re:/except[^\n:]*:\s*\n\s*pass\b/gm },
  { id:'empty-catch',     sev:'error', exts:/\.go$/i,                                          re:/if\s+(?:[^{;]*;\s*)?err\s*!=\s*nil\s*\{\s*\}/g },
  { id:'empty-catch',     sev:'error', exts:/\.rb$/i,                                          re:/rescue[^\n]*\n\s*end\b/g },
  { id:'exec-injection',  sev:'error', exts:/\.(mjs|js|ts|tsx|jsx)$/i,                         re:/\b(?:exec|execSync)\s*\(\s*`[^`]*\$\{/g },
  { id:'exec-injection',  sev:'error', exts:/\.py$/i,                                          re:/(?:os\.system|subprocess\.(?:call|run|Popen))\s*\(\s*f["']/g },
  { id:'exec-injection',  sev:'error', exts:/\.cs$/i,                                          re:/Process\.Start\s*\(\s*\$"[^"]*\{[^}]+\}|Process\.Start\s*\(\s*"[^"]*"\s*\+/g },
  { id:'exec-injection',  sev:'error', exts:/\.(java|kt)$/i,                                   re:/Runtime\.getRuntime\(\)\.exec\s*\(\s*[^,)]*[\+]|Runtime\.getRuntime\(\)\.exec\s*\(\s*String\.format/g },
  { id:'exec-injection',  sev:'error', exts:/\.go$/i,                                          re:/exec\.Command\s*\(\s*"(?:sh|bash|cmd)"\s*,\s*"\/?-?c"/g },
  { id:'exec-injection',  sev:'error', exts:/\.rs$/i,                                          re:/Command::new\s*\(\s*"(?:sh|bash|cmd)"\s*\)[^;]*\.arg\s*\(\s*"\/?-?c"/g },
  { id:'exec-injection',  sev:'error', exts:/\.php$/i,                                         re:/\b(?:shell_exec|system|passthru|proc_open|popen)\s*\(\s*[^)]*\$\w+/g },
  { id:'exec-injection',  sev:'error', exts:/\.swift$/i,                                       re:/\.arguments\s*=\s*\[[^\]]*\\\(/g },
  { id:'disabled-test',   sev:'warn',  exts:/\.(mjs|js|ts|tsx|jsx)$/i,                         re:/\b(?:it|test|describe)\.(?:skip|only)\s*\(|\bx(?:it|describe)\s*\(/g },
  { id:'disabled-test',   sev:'warn',  exts:/\.py$/i,                                          re:/@(?:pytest\.mark\.skip|unittest\.skip)\b/g },
  { id:'disabled-test',   sev:'warn',  exts:/\.cs$/i,                                          re:/\[(?:Ignore|Skip|Fact\s*\(\s*Skip\s*=|Theory\s*\(\s*Skip\s*=)/g },
  { id:'disabled-test',   sev:'warn',  exts:/\.(java|kt)$/i,                                   re:/@(?:Disabled|Ignore)\b/g },
  { id:'disabled-test',   sev:'warn',  exts:/\.go$/i,                                          re:/\bt\.(?:Skip|SkipNow)\s*\(/g },
  { id:'disabled-test',   sev:'warn',  exts:/\.rs$/i,                                          re:/#\[ignore(?:\s*=|\])/g },
  { id:'disabled-test',   sev:'warn',  exts:/\.php$/i,                                         re:/\$this->markTestSkipped\b|@group\s+disabled\b/g },
  { id:'disabled-test',   sev:'warn',  exts:/\.swift$/i,                                       re:/\bXCTSkip\b|throw\s+XCTSkip/g },
  { id:'hardcoded-secret',sev:'error', exts:ALL,                                               re:/(?:sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{36}|gho_[A-Za-z0-9]{36}|xox[bapsr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,})/g },
  { id:'sql-injection',   sev:'error', exts:ALL,                                               re:/`\s*(?:SELECT\s+|INSERT\s+INTO\s+|UPDATE\s+\w+\s+SET\s+|DELETE\s+FROM\s+|DROP\s+(?:TABLE|INDEX|DATABASE)\s+|ALTER\s+TABLE\s+)[^`]*\$\{[^}]+\}/g },
  { id:'sql-injection',   sev:'error', exts:/\.py$/i,                                          re:/f["'](?:SELECT\s+|INSERT\s+INTO\s+|UPDATE\s+\w+\s+SET\s+|DELETE\s+FROM\s+)[^"']*\{[^}]+\}/g },
  { id:'sql-injection',   sev:'error', exts:/\.cs$/i,                                          re:/\$"(?:SELECT\s+|INSERT\s+INTO\s+|UPDATE\s+\w+\s+SET\s+|DELETE\s+FROM\s+)[^"]*\{[^}]+\}/g },
  { id:'sql-injection',   sev:'error', exts:/\.(java|kt)$/i,                                   re:/String\.format\s*\(\s*"(?:SELECT\s+|INSERT\s+INTO\s+|UPDATE\s+\w+\s+SET\s+|DELETE\s+FROM\s+)[^"]*%[sd]/g },
  { id:'sql-injection',   sev:'error', exts:/\.go$/i,                                          re:/fmt\.Sprintf\s*\(\s*"(?:SELECT\s+|INSERT\s+INTO\s+|UPDATE\s+\w+\s+SET\s+|DELETE\s+FROM\s+)[^"]*%[sd]/g },
  { id:'sql-injection',   sev:'error', exts:/\.rs$/i,                                          re:/format!\s*\(\s*"(?:SELECT\s+|INSERT\s+INTO\s+|UPDATE\s+\w+\s+SET\s+|DELETE\s+FROM\s+)[^"]*\{[^}]*\}/g },
  { id:'sql-injection',   sev:'error', exts:/\.php$/i,                                         re:/"(?:SELECT\s+|INSERT\s+INTO\s+|UPDATE\s+\w+\s+SET\s+|DELETE\s+FROM\s+)[^"]*"\s*\.\s*\$\w+/g },
  { id:'dynamic-import',  sev:'warn',  exts:/\.(mjs|js|ts|tsx|jsx)$/i,                         re:/\b(?:import|require)\s*\(\s*`[^`]*\$\{/g },
  { id:'loose-type',      sev:'warn',  exts:/\.(ts|tsx)$/i,                                    re:/(?<![\w$]):\s*any\b|<any>|\bas\s+any\b/g },
  { id:'loose-type',      sev:'warn',  exts:/\.cs$/i,                                          re:/\bdynamic\s+\w+\s*[=;]/g },
  { id:'loose-type',      sev:'warn',  exts:/\.py$/i,                                          re:/:\s*Any\b|->\s*Any\b/g },
  { id:'loose-type',      sev:'warn',  exts:/\.go$/i,                                          re:/\binterface\s*\{\s*\}/g },
  { id:'magic-timeout',   sev:'info',  exts:ALL,                                               re:/\b(?:setTimeout|setInterval)\s*\([\s\S]*?,\s*(\d{4,})\s*\)/g },
  { id:'magic-timeout',   sev:'info',  exts:ALL,                                               re:/\b(?:Sleep|Thread\.sleep|asyncio\.sleep|time\.sleep|time\.Sleep|thread::sleep|\bsleep)\s*\(\s*(\d{4,})\b/g },
  { id:'cross-pkg-import',sev:'warn',  exts:/\.(mjs|js|ts|tsx|jsx)$/i,                         re:/from\s+["']\.\.\/\.\.\/[^.\/'"]+\/src\//g },
  // === PowerShell (.ps1, .psm1) ===
  { id:'exec-injection',   sev:'error', exts:/\.(ps1|psm1)$/i,                                   re:/\b(?:Invoke-Expression|iex)\b[^\n#]*\$/g },
  { id:'empty-catch',      sev:'error', exts:/\.(ps1|psm1)$/i,                                   re:/\bcatch\s*(?:\[[^\]]*\]\s*)?\{\s*\}/g },
  { id:'disabled-test',    sev:'warn',  exts:/\.(ps1|psm1)$/i,                                   re:/\b(?:Describe|Context|It|BeforeAll|BeforeEach)\b[^{\n]*-(?:Skip|Pending)\b/g },
  { id:'magic-timeout',    sev:'info',  exts:/\.(ps1|psm1)$/i,                                   re:/Start-Sleep\s+(?:-Seconds\s+\d{3,}|-Milliseconds\s+\d{5,})/g },
  { id:'hardcoded-secret', sev:'error', exts:/\.(ps1|psm1)$/i,                                   re:/ConvertTo-SecureString[^\n]*-AsPlainText[^\n]*["'][^"'$\n]{4,}["']|ConvertTo-SecureString[^\n]*["'][^"'$\n]{4,}["'][^\n]*-AsPlainText/g },
  // === Bicep (.bicep) — mechanical enforcement of bicep.instructions.md rules ===
  { id:'hardcoded-region', sev:'warn',  exts:/\.bicep$/i,                                        re:/(?:location:\s*|param\s+\w*[Ll]ocation\w*\s+string\s*=\s*)'(?:east|west|north|south|central|canada|brazil|uk|france|germany|switzerland|norway|sweden|poland|italy|spain|asia|australia|japan|korea|india|uae|qatar|africa|israel|gov)\w*'/g },
  { id:'insecure-config',  sev:'error', exts:/\.bicep$/i,                                        re:/publicNetworkAccess:\s*'Enabled'|minimumTlsVersion:\s*'TLS1_[01]'|supportsHttpsTrafficOnly:\s*false|allowBlobPublicAccess:\s*true/g },
];
const files = [];
(function walk(d){ for (const e of fs.readdirSync(d,{withFileTypes:true})) { if (SKIP_DIRS.has(e.name)) continue; const p=path.join(d,e.name); if (e.isDirectory()) walk(p); else if (/\.[a-z]+$/i.test(e.name)) files.push(p); }})('.');
const findings = [];
for (const f of files) {
  let src; try { src = fs.readFileSync(f,'utf-8'); } catch { continue; }
  for (const c of CHECKS) {
    if (!c.exts.test(f)) continue;
    for (const m of src.matchAll(c.re)) {
      const line = src.slice(0, m.index).split('\n').length;
      findings.push({ id:c.id, sev:c.sev, file:f, line, snippet:m[0].slice(0,80).replace(/\n/g,' ') });
    }
  }
}
const byId = {};
for (const f of findings) {
  if (!byId[f.id]) byId[f.id] = { sev:f.sev, count:0, samples:[] };
  byId[f.id].count++;
  if (byId[f.id].samples.length < 5) byId[f.id].samples.push({ file:f.file, line:f.line, snippet:f.snippet });
}
console.log(JSON.stringify({ totalFindings: findings.length, byId }, null, 2));
NODE_EOF
)"
```

Report each check separately with its sample hits. Aggregate the error-severity checks (`empty-catch`, `exec-injection`, `hardcoded-secret`, `sql-injection`) into the top of the report — these are blocking.

> **Why this matters**: Each check maps to a real past incident or a pattern explicitly forbidden by the architecture/security instruction files. Empty catches hide root causes (debugging time burned). `exec` with interpolation has burned us on Windows quoting and is the canonical command-injection vector. Disabled tests propagate the failing-test-as-pass anti-pattern. Hardcoded secrets in fixtures end up in tarballs. SQL injection is OWASP A03. Dynamic imports broke after the Phase 53 orchestrator split (memory: `dynamic-import-path-after-split.md`). Loose types defeat the type system and accumulate silently. Magic timeouts cause the gate-too-short class of bug (meta-bug example). Cross-package internal imports violate the Dependency Rule.

> **Tuning**: Most regexes are intentionally narrow to keep false-positive rate low. Loosen `hardcoded-secret` by lowering the `{20,}` / `{36}` minima. Tighten `loose-type` to `error` if you want strict-mode enforcement. The `magic-timeout` check captures only literal numbers passed directly; named constants are correctly ignored.

> **False-positive notes**:
> - `disabled-test` may produce hits in auditor / linter source files that contain `xit(` or `.skip(` as string literals for their own pattern matching. Whitelist your auditor files when reviewing.
> - `hardcoded-secret` will match intentional test fixtures (e.g. `sk-FAKE...EXAMPLE` strings to demonstrate secret-scanning). Move fixtures to clearly-named files like `*-fixture.*` or `*-example.*` and exclude those from review.
> - `loose-type` may produce hits in generated code or type-shim files. Review samples before treating counts as absolute.
> - `cross-pkg-import` only catches `../../` (two-level) sibling imports. Deeper monorepo layouts need a custom regex.
> - `sql-injection` uses strict SQL grammar shape matching (uppercase keyword + `WHERE`/`SET`/`FROM`/`INTO`) to keep false positives near zero. Lowercase or partial SQL fragments will not match; this is intentional.

> **Conditional**: If Node is not available, skip and note in report.

### 7. Dual-shell parity scan (PowerShell ↔ Bash)

If the project ships both PowerShell (`.ps1`) and Bash (`.sh`) entry points, every script must have a sibling in the other shell at the same path. A `setup.ps1` without `setup.sh` (or vice versa) halves the user base on the missing platform.

```bash
node -e "$(cat <<'NODE_EOF'
const fs = require('fs'), path = require('path');
const SKIP = new Set(['node_modules','.git','.venv','vendor','dist','build','bin','obj','target','.next','__pycache__','.forge']);
const ps1 = new Map(), sh = new Map();
(function walk(d){
  for (const e of fs.readdirSync(d,{withFileTypes:true})) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else {
      const ext = path.extname(e.name).toLowerCase();
      const base = path.basename(e.name, ext);
      const key = path.join(path.dirname(p), base);
      if (ext === '.ps1') ps1.set(key, p);
      else if (ext === '.sh') sh.set(key, p);
    }
  }
})('.');
if (ps1.size < 2 && sh.size < 2) {
  console.log(JSON.stringify({ skipped:true, reason:'Project does not ship enough dual-shell scripts to evaluate parity (<2 of either kind).' }));
  process.exit(0);
}
const findings = [];
for (const [key, p] of ps1) if (!sh.has(key)) findings.push({ kind:'missing-sh', basename:path.basename(key), ps1:p });
for (const [key, p] of sh)  if (!ps1.has(key)) findings.push({ kind:'missing-ps1', basename:path.basename(key), sh:p });
console.log(JSON.stringify({ totalUnpaired: findings.length, findings }, null, 2));
NODE_EOF
)"
```

Report each unpaired script with its kind (`missing-sh` or `missing-ps1`), basename, and the existing file's path. Severity: `warn`.

> **Why this matters**: Plan Forge has shipped multiple bugs from a `.ps1` script gaining a feature its `.sh` twin didn't (most recently meta-bug #216 — `pforge.sh` missing the shared-skills copy loop). The parity scan is a one-second check that prevents the entire class of bug.

> **Limitation**: Parity in filenames doesn't guarantee parity in behavior. Pair the scan with a manual diff review of the shell-specific implementations when the script's responsibilities are non-trivial.

> **Conditional**: If the project doesn't ship both shells (fewer than 2 scripts of either kind), the scanner skips itself and notes the reason. To force the scan on a Bash-only or PowerShell-only project, edit the threshold inline.

### 8. Boy Scout delta check (optional, requires git)

```bash
# Only when running on a feature branch with a clear base
git diff --name-only origin/main...HEAD | head -50
```

For every changed file under `--scope`, re-run Step 1 (linter) twice — once against `HEAD` and once against `git show origin/main:<file>` — and compare violation counts. Categorise:

- `improved` — violations decreased (positive Boy Scout signal)
- `boy-scout-violation` — file was edited but violation count did **not** decrease (warn)
- `regression` — file was edited and violation count **increased** (error)

> **Why this matters**: The Boy Scout Rule in `architecture-principles.instructions.md` ("leave the code cleaner than you found it") is only enforceable with a delta check. Without it, the rule is aspirational.

> **Conditional**: Skip this step if not on a feature branch, if the base branch can't be determined, or if `git` is not available.

### 9. Aggregate and report

Merge findings into a unified report grouped by category:

```
┌─────────────────────────────────────────────┐
│  Clean Code Review — <timestamp>            │
├─────────────────────────────────────────────┤
│  Category           │ Errors │ Warnings     │
│  ───────────────────┼────────┼──────────    │
│  Module size        │   N    │    N         │
│  Function length    │   N    │    N         │
│  Complexity         │   N    │    N         │
│  Parameter count    │   N    │    N         │
│  Markers (TODO/etc) │   —    │    N         │
│  Commented code     │   —    │    N         │
│  Debug print/log    │   —    │  bulk (N)    │
│  Dup — blocks       │   —    │    N         │
│  Dup — literals     │   —    │    N         │
│  Dup — regexes      │   —    │    N         │
│  Empty catch        │   N    │    —         │
│  Exec injection     │   N    │    —         │
│  Disabled test      │   —    │    N         │
│  Hardcoded secret   │   N    │    —         │
│  SQL injection      │   N    │    —         │
│  Dynamic import     │   —    │    N         │
│  Loose type         │   —    │    N         │
│  Magic timeout      │   —    │  info (N)    │
│  Cross-pkg import   │   —    │    N         │
│  Shell parity       │   —    │    N         │
│  Boy Scout delta    │   N    │    N         │
├─────────────────────────────────────────────┤
│  Total: N errors, N warnings                │
└─────────────────────────────────────────────┘
```

If `--out <path>` is provided, write the full JSON report. Otherwise print the summary table and the top 10 highest-severity findings with file paths and line numbers.

### 10. (Optional) Generate fix suggestions (`--fix-suggestions`)

Append a concrete remediation for each finding:

| Finding type | Fix suggestion pattern |
|-------------|----------------------|
| Function >300 LOC | "Extract `<identified-block>` into a helper function `<suggested-name>` in the same module" |
| Complexity threshold exceeded | "Replace nested conditionals at line N with early-return guard clauses; consider extracting `<block>` into a named function" |
| >4 positional params | "Wrap parameters into an `options` object: `{ paramA, paramB, ... }`" |
| TODO/FIXME marker | "Convert to a tracked issue (e.g. `forge_bug_file` if Plan Forge is configured) or remove if resolved" |
| Commented-out code | "Delete lines N–M; the code is preserved in git history (`git log -p -- <file>`)" |
| Module >3,000 LOC | "Split by responsibility: extract `<cohesive-group>` into `<suggested-file>`" |
| Magic number | "Extract `<value>` at line N to a named constant: `const <SUGGESTED_NAME> = <value>`" |
| Duplicated block (jscpd) | "Extract the duplicated block at <file>:<line> into a shared helper in the nearest common module" |
| Duplicated literal (Step 5.2) | "Extract `<value>` to a named constant. If it's part of a stable small set (modes, tiers, hook names, error codes), centralize it in your project's enums/constants module — never re-type" |
| Duplicated regex (Step 5.3) | "Extract the regex `<pattern>` into a single module export and import it from every call site. Regex drift is the worst kind — when the rule changes, every copy must update" |
| `empty-catch` | "At `<file>:<line>` — at minimum log the error: `catch (e) { logger.error('<context>', e); throw; }`. Empty catches hide root causes. If the swallow is intentional, add a comment explaining why and a typed guard on `e`" |
| `exec-injection` | "Replace `` exec(`cmd ${arg}`) `` with `spawn('cmd', [arg])` (or `subprocess.run(['cmd', arg], shell=False)` in Python). Args-array form bypasses the shell entirely — no quoting, no injection" |
| `disabled-test` | "At `<file>:<line>` — either re-enable the test (preferred) or delete it. A disabled test is a lie: CI is green while behavior is unverified. If the underlying bug is real, file it via `forge_bug_file` and reference the issue in a commit message explaining the removal" |
| `hardcoded-secret` | "Move `<token-shape>` at `<file>:<line>` to an env var or secret manager NOW. Then rotate the secret — assume it's compromised by virtue of being in source control. Run `git log -p -- <file>` to confirm what historical commits expose it" |
| `sql-injection` | "Replace `` `SELECT ... ${x}` `` with a parameterized query: `db.query('SELECT ... WHERE id = ?', [x])`. Never interpolate user input into SQL strings — this is OWASP A03" |
| `dynamic-import` | "Replace `` import(`./${name}`) `` with an explicit switch/map of static imports: `{ foo: () => import('./foo'), bar: () => import('./bar') }[name]?.()`. Static paths survive refactors; computed paths break silently" |
| `loose-type` | "Replace `any` / `dynamic` / `Any` at `<file>:<line>` with the actual type. If the type is truly unknown, use `unknown` (TS) / `object` (C#) and narrow with a type guard before use" |
| `magic-timeout` | "Extract the literal at `<file>:<line>` to a named constant at module scope: `const <NAME>_TIMEOUT_MS = <value>`. Magic timeouts are the source of the gate-too-short class of bug — make them findable" |
| `cross-pkg-import` | "Replace `from '../../sibling/src/internal'` with an import from the sibling's public entry point (`from 'sibling'`). If the public API doesn't expose what you need, add it deliberately — don't bypass the package boundary" |
| `missing-sh` / `missing-ps1` | "Create the missing shell twin at the same path. Both shells must reach feature parity in the same commit — a one-shell PR halves the user base on the missing platform" |
| Boy Scout violation | "You edited <file> without reducing violations. Either fix one existing warning in this file (preferred), or document why this PR explicitly avoids touching unrelated code" |

Fix suggestions are advisory — they do NOT modify code. The agent or user applies them in a follow-up step.

## Safety Rules

- **Read-only**: This skill analyses code. It MUST NOT modify any source files.
- **No invented findings**: Every finding must come from a linter or grep result. Do not add findings from general knowledge.
- **Scope-bound**: Only scan files matching `--scope`. Do not expand scope silently.
- **No tooling install**: Do NOT install new linters or analyzers. If a step's tool is missing, skip and note the gap in the report.
- **Deterministic**: Running the skill twice on the same codebase must produce the same findings.

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "I'll eyeball the code instead of running the linter" | Misses findings the linter catches mechanically; inconsistent coverage between runs |
| "Skip the linter — the grep steps cover enough" | Greps approximate; the linter is the only tool that measures cyclomatic complexity and function length with AST precision |
| "Report all debug-print hits individually" | Step 3 intentionally bulk-triages them as one advisory. Individual reporting floods the report with noise |
| "Generate fix suggestions without `--fix-suggestions` flag" | Unsolicited suggestions clutter the report and distract from triage. The user opts in when ready to remediate |
| "Modify the source code to fix findings" | This is a review skill, not a fix skill. Modifying code without explicit user intent violates read-only safety |
| "Install jscpd/eslint/ruff for the user" | The skill must respect what the project already has. Suggest the tool in the report, do not install it |

## Warning Signs

- Report shows zero findings in a codebase known to have large or complex files — the linter likely failed silently; check exit code and raw output
- Module-size scan flags every file as >3,000 LOC — the line counter is not stripping comments; verify the regex
- `--fix-suggestions` output recommends splitting a file that is <500 LOC — threshold miscalibrated; re-check against the thresholds table
- Boy Scout delta shows "regression" on every changed file — linter config drifted between HEAD and base; report the drift instead of the false-positive deltas

## Exit Proof

After completing this skill, confirm:

- [ ] All available steps were attempted (linter, module-size, grep-matrix, long-params, all three duplication sub-scans if Node available, engineering hygiene scan, dual-shell parity scan, Boy Scout if on a branch)
- [ ] Skipped steps are noted with the reason
- [ ] Findings are grouped by category with error/warning counts
- [ ] If `--fix-suggestions` was requested, each finding has a concrete remediation
- [ ] If `--out` was specified, JSON report exists at the given path
- [ ] No source files were modified during the review

## Relationship to Other Tools

| Tool / Instruction | Relationship |
|-------------------|-------------|
| [.github/instructions/clean-code.instructions.md](../../instructions/clean-code.instructions.md) | Defines the thresholds and review checklist this skill enforces mechanically |
| [.github/instructions/architecture-principles.instructions.md](../../instructions/architecture-principles.instructions.md) | Provides the Boy Scout Rule that Step 8 enforces; the engineering hygiene scan in Step 6 enforces the no-empty-catch and dependency-rule guardrails |
| [.github/instructions/security.instructions.md](../../instructions/security.instructions.md) | Provides the no-`exec`-with-interpolation rule, secret-handling rule, and SQL-injection rule that Step 6 enforces mechanically |
| `/code-review` skill | **Run `/clean-code-review` FIRST, then `/code-review`.** This skill is the mechanical/quantitative pass; `/code-review` is the qualitative/judgment pass (architecture, security, patterns, tests). |
| `forge_sweep` | Lighter-weight marker-only scan (TODO/FIXME). This skill is the comprehensive version that also covers size, complexity, params, duplication, and Boy Scout. |

## Persistent Memory (if OpenBrain is configured)

- **Before review**: `search_thoughts("clean code finding", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-clean-code-review")` — surface recurring violations and prior triage decisions
- **After review**: `capture_thought("Clean code review: <summary — N errors / M warnings, top finding>", project: "<YOUR PROJECT NAME>", created_by: "copilot-vscode", source: "skill-clean-code-review")` — track quality trend over time

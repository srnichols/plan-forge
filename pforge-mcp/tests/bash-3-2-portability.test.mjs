/**
 * setup.sh, validate-setup.sh and pforge.sh run on the Bash and the tools that macOS ships (#427): Bash 3.2, and BSD
 * find, grep, sed and awk. The macOS job in validate.yml runs them there. These tests are what a Linux or Windows
 * contributor can run: source-read guards against the Bash 4 and GNU-only constructs that stopped them, and the two
 * helpers that replaced `grep -oP` and `find -printf`, checked against what they replaced.
 *
 * Source-read guard: GNU Bash and GNU tools accept every construct below, so nothing else would notice one coming back.
 */

import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const isWin = process.platform === "win32";
const BASH = isWin ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].find((p) => existsSync(p)) : "bash";
const SCRIPTS = ["setup.sh", "validate-setup.sh", "pforge.sh"];

// What is not in Bash 3.2 or in BSD userland, and so must not be in these scripts.
const NOT_PORTABLE = [
  [/\b(declare|local|typeset)\s+-[a-zA-Z]*A\b/, "an associative array (declare -A), Bash 4.0+"],
  [/\b(mapfile|readarray)\b/, "mapfile/readarray, Bash 4.0+"],
  [/\bgrep\s+(-[a-zA-Z]+\s+)*-[a-zA-Z]*P/, "grep -P, which BSD grep does not have"],
  [/\bfind\b[^|;\n]*\s-printf\b/, "find -printf, which BSD find does not have"],
  [/\$\{[A-Za-z_][A-Za-z_0-9]*(,,|\^\^)[^}]*\}/, "case-modifying expansion, Bash 4.0+"],
  [/;;&|\|&|&>>/, "a Bash 4 operator (;;& or |& or &>>)"],
  [/\[\[\s+-v\s/, "[[ -v var ]], Bash 4.2+"],
  [/\bsed\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*r\b/, "sed -r; the portable spelling is sed -E"],
];

const code = (text) =>
  text
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

describe("the shell scripts do not use what Bash 3.2 and BSD tools lack", () => {
  for (const script of SCRIPTS) {
    it(`${script} has none of it`, () => {
      const source = code(readFileSync(join(REPO_ROOT, script), "utf8"));
      const found = NOT_PORTABLE.filter(([pattern]) => pattern.test(source)).map(([, what]) => what);
      expect(found).toEqual([]);
    });
  }

  it("is found by the scan above when a script has it", () => {
    expect(NOT_PORTABLE.every(([pattern]) => !pattern.test(code("# declare -A in a comment\necho ok")))).toBe(true);
    expect(NOT_PORTABLE[0][0].test('declare -A TABLE=(["a"]="b")')).toBe(true);
    expect(NOT_PORTABLE[1][0].test('mapfile -t lines < <(echo hi)')).toBe(true);
    expect(NOT_PORTABLE[2][0].test("got=$(grep -oP 'a\\K.' file)")).toBe(true);
    expect(NOT_PORTABLE[3][0].test("find . -maxdepth 1 -name '*.md' -printf '%f'")).toBe(true);
  });
});

function helper(name) {
  const source = readFileSync(join(REPO_ROOT, "setup.sh"), "utf8");
  const start = source.indexOf(`\n${name}() {`);
  expect(start, `setup.sh defines ${name}`).toBeGreaterThan(-1);
  return source.slice(start + 1, source.indexOf("\n}\n", start) + 3);
}

function runBash(script, timeout = 120_000) {
  const run = spawnSync(BASH, ["-c", script], { encoding: "utf8", timeout });
  expect(run.status, run.stderr).toBe(0);
  return run.stdout;
}

const tmpDirs = [];
afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "pf-bsd-portability-"));
  tmpDirs.push(dir);
  return dir;
};

describe.skipIf(!BASH)("setup.sh helpers that replaced GNU-only code", () => {
  it("frontmatter_description gives the text grep -oP gave, for every prompt, agent and skill in the repository", () => {
    const files = spawnSync("git", ["ls-files", "*.prompt.md", "*.agent.md", "SKILL.md", "*/SKILL.md"], { cwd: REPO_ROOT, encoding: "utf8" }).stdout.split("\n").filter(Boolean);
    expect(files.length).toBeGreaterThan(100);
    const list = join(tempDir(), "files.txt");
    writeFileSync(list, `${files.map((file) => join(REPO_ROOT, file).replaceAll("\\", "/")).join("\n")}\n`);
    // One fork per file: the function is called directly, and each file's output ends with a marker, because a file with no
    // description prints nothing at all.
    const out = runBash(
      `${helper("frontmatter_description")}\nwhile IFS= read -r f; do printf '%s\\t' "$f"; frontmatter_description "$f"; printf '\\001\\n'; done < "${list.replaceAll("\\", "/")}"`,
      600_000,
    );
    const got = new Map(
      out
        .split("\u0001\n")
        .filter(Boolean)
        .map((chunk) => {
          const tab = chunk.indexOf("\t");
          return [chunk.slice(0, tab), chunk.slice(tab + 1).replace(/\n$/, "")];
        }),
    );

    // The first "description:" in the file, minus one opening quote, up to the next quote: what grep -oP 'description:\s*"?\K[^"]+' printed.
    const expected = (text) => {
      for (const line of text.split("\n")) {
        const match = /description:\s*"?([^"]+)/.exec(line);
        if (match) return match[1].replace(/\r$/, "");
      }
      return "";
    };
    const different = [];
    for (const file of files) {
      const text = readFileSync(join(REPO_ROOT, file), "utf8");
      const want = expected(text);
      const have = (got.get(join(REPO_ROOT, file).replaceAll("\\", "/")) ?? "").replace(/\r$/, "");
      if (want !== have) different.push(`${file}: want [${want}] have [${have}]`);
    }
    expect(different, different.join("\n")).toEqual([]);
  }, 700_000);

  it("frontmatter_description reads a quoted, an unquoted and an indented value, the first of two, and nothing", () => {
    const dir = tempDir();
    const cases = [
      ["quoted", 'description: "Foo bar baz"\n', "Foo bar baz"],
      ["unquoted", "description: Use when X\n", "Use when X"],
      ["indented", "  description: indented value\n", "indented value"],
      ["two", "description: first\ndescription: second\n", "first"],
      ["none", "---\nname: x\n---\nnothing here\n", ""],
    ];
    for (const [name, content] of cases) writeFileSync(join(dir, name), content);
    const out = runBash(`${helper("frontmatter_description")}\ncd "${dir.replaceAll("\\", "/")}"; for n in quoted unquoted indented two none; do printf '%s=[%s]\\n' "$n" "$(frontmatter_description "$n")"; done`);
    expect(out.trim().split("\n").map((line) => line.replace(/\r$/, ""))).toEqual(cases.map(([name, , want]) => `${name}=[${want}]`));
  });

  it("json_names lists the names of the paths that exist as a JSON array, and [] when none do", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "prompts"));
    mkdirSync(join(dir, "skills", "alpha"), { recursive: true });
    mkdirSync(join(dir, "skills", "beta"), { recursive: true });
    mkdirSync(join(dir, "with space", "prompts"), { recursive: true });
    for (const file of ["prompts/a.prompt.md", "prompts/b.prompt.md", "prompts/note.txt", "skills/file.txt", "with space/prompts/x.prompt.md"]) writeFileSync(join(dir, file), "");
    const base = dir.replaceAll("\\", "/");
    const out = runBash(
      [
        helper("json_names"),
        `cd "${base}"`,
        'echo "prompts=$(json_names prompts/*.prompt.md)"',
        'echo "skills=$(json_names skills/*/)"',
        'echo "none=$(json_names prompts/*.agent.md)"',
        'echo "space=$(json_names "with space"/prompts/*.prompt.md)"',
      ].join("\n"),
    );
    expect(out.trim().split("\n").map((line) => line.replace(/\r$/, ""))).toEqual(['prompts=["a.prompt.md","b.prompt.md"]', 'skills=["alpha","beta"]', "none=[]", 'space=["x.prompt.md"]']);
  });
});

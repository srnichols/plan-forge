import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPodGitEnvironment } from "../src/k8s/pod-git-env.mjs";
import { runWorkerEntrypoint } from "../deploy/worker-entrypoint.mjs";

const TEST_ROOT = path.dirname(fileURLToPath(import.meta.url));
const PROCESS_TIMEOUT_MS = 10_000;
const directories = [];

async function workspace() {
  const directory = await mkdtemp(path.join(TEST_ROOT, ".claw-worker-env-"));
  directories.push(directory);
  return directory;
}

function fakeChild(code = 0) {
  const child = new EventEmitter();
  child.kill = vi.fn();
  queueMicrotask(() => child.emit("close", code));
  return child;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("one-shot image environment", () => {
  it("fails an invalid job identity before spawning and never prints its value", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const spawnFn = vi.fn();
    const code = await runWorkerEntrypoint({
      args: ["claw", "worker", "--one-shot"], cwd: await workspace(),
      env: { GIT_AUTHOR_NAME: "fixture\ninvalid-identity" }, spawnFn,
    });
    expect(code).toBe(127);
    expect(spawnFn).not.toHaveBeenCalled();
    expect(stderr.mock.calls.some(([text]) => text.includes("invalid-identity"))).toBe(false);
  });

  it("removes inherited trace destinations and credential-output switches", () => {
    const env = createPodGitEnvironment({
      env: {
        GIT_TRACE2_EVENT: "credential-trace.json", GIT_TRACE2_PERF: "credential-trace.log",
        GIT_TRACE_REDACT: "0", GIT_TRACE_CURL_NO_DATA: "0", GH_DEBUG: "api",
      },
      home: path.join(TEST_ROOT, ".job-scope"),
    });
    expect(Object.keys(env).some((name) => name.startsWith("GIT_TRACE2"))).toBe(false);
    expect(env.GIT_TRACE_REDACT).toBe("1");
    expect(env.GIT_TRACE_CURL_NO_DATA).toBe("1");
    expect(env.GH_DEBUG).toBe("");
  });

  it.each(["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"])(
    "rejects control characters in an explicitly configured %s", (name) => {
      expect(() => createPodGitEnvironment({
        env: { [name]: "fixture\ninvalid-identity" }, home: path.join(TEST_ROOT, ".job-scope"),
      })).toThrowError(expect.objectContaining({ code: "POD_GIT_IDENTITY_INVALID" }));
    },
  );

  it("obtains HTTPS credentials through the environment helper without contacting GitHub or writing global config", async () => {
    const directory = await workspace();
    const trace = path.join(directory, "helper-arguments.txt");
    const helper = path.join(directory, "gh");
    await writeFile(helper, [
      "#!/bin/sh",
      'printf "%s\\n" "$@" >> "$HELPER_ARGUMENTS_FILE"',
      'test "$1" = auth && test "$2" = git-credential && test "$3" = get || exit 2',
      "while IFS= read -r line; do test -n \"$line\" || break; done",
      'printf "username=x-access-token\\npassword=%s\\n\\n" "$GH_TOKEN"',
      "",
    ].join("\n"));
    await chmod(helper, 0o755);
    const token = "fixture-token-not-a-live-credential";
    const env = createPodGitEnvironment({
      env: {
        PATH: `${directory}${path.delimiter}${process.env.PATH}`,
        SystemRoot: process.env.SystemRoot,
        HELPER_ARGUMENTS_FILE: trace,
        PFORGE_CLAW_GH_TOKEN: token,
      },
      home: directory,
    });
    const result = spawnSync("git", ["credential", "fill"], {
      cwd: directory, env, encoding: "utf8",
      input: "protocol=https\nhost=example.com\n\n",
      timeout: PROCESS_TIMEOUT_MS,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`password=${token}`);
    expect(result.stderr).not.toContain(token);
    expect(await readFile(trace, "utf8")).toBe("auth\ngit-credential\nget\n");
    expect(existsSync(path.join(directory, ".gitconfig"))).toBe(false);
  });

  it("provides real Git author and committer identity without per-command author overrides", async () => {
    const directory = await workspace();
    const env = createPodGitEnvironment({
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
      home: directory,
    });
    for (const role of ["AUTHOR", "COMMITTER"]) {
      const identity = spawnSync("git", ["var", `GIT_${role}_IDENT`], {
        cwd: directory, env, encoding: "utf8", timeout: PROCESS_TIMEOUT_MS,
      });
      expect(identity.error).toBeUndefined();
      expect(identity.status).toBe(0);
      expect(identity.stdout).toMatch(/^Forge-Claw <claw@localhost> /);
    }
    expect(existsSync(path.join(directory, ".gitconfig"))).toBe(false);
  });

  it("does not carry inherited Git parameter injection or tracing into the job", () => {
    const env = createPodGitEnvironment({
      env: {
        GIT_CONFIG_PARAMETERS: "'credential.helper=unexpected-host-helper'",
        GIT_CONFIG_KEY_9: "credential.helper",
        GIT_CONFIG_VALUE_9: "unexpected-host-helper",
        GIT_TRACE: "1",
        GIT_CURL_VERBOSE: "1",
      },
      home: path.join(TEST_ROOT, ".isolated-home"),
    });
    expect(env).not.toHaveProperty("GIT_CONFIG_PARAMETERS");
    expect(env).not.toHaveProperty("GIT_CONFIG_KEY_9");
    expect(env).not.toHaveProperty("GIT_CONFIG_VALUE_9");
    expect(env.GIT_TRACE).toBe("0");
    expect(env.GIT_CURL_VERBOSE).toBe("0");
  });

  it("uses the real Claw CLI dispatch with a writable home and keeps tokens out of process arguments", async () => {
    const directory = await workspace();
    const spawnFn = vi.fn(() => fakeChild());
    const token = "fixture-entrypoint-token";
    const copilotToken = "fixture-entrypoint-copilot-token";
    const status = await runWorkerEntrypoint({
      args: ["claw", "worker", "--one-shot", "--job", "j1"],
      cwd: directory,
      env: { PFORGE_CLAW_GH_TOKEN: token, PFORGE_CLAW_COPILOT_TOKEN: copilotToken },
      spawnFn,
    });
    expect(status).toBe(0);
    const [command, args, options] = spawnFn.mock.calls[0];
    expect(command).toBe(process.execPath);
    expect(path.basename(args[0])).toBe("cli.mjs");
    expect(args.slice(1)).toEqual(["worker", "--one-shot", "--job", "j1"]);
    expect(options.env).toMatchObject({
      GH_TOKEN: token,
      COPILOT_GITHUB_TOKEN: copilotToken,
      HOME: path.join(directory, "home"),
      GIT_CONFIG_VALUE_1: "!gh auth git-credential",
    });
    expect(existsSync(options.env.HOME)).toBe(true);
    expect(JSON.stringify(args)).not.toContain(token);
    expect(JSON.stringify(args)).not.toContain(copilotToken);
  });

  it("preserves repo-local pforge delegation and cleans up child signal handlers on failure", async () => {
    const directory = await workspace();
    await writeFile(path.join(directory, "pforge.sh"), "#!/bin/sh\nexit 0\n");
    await chmod(path.join(directory, "pforge.sh"), 0o755);
    const before = process.listenerCount("SIGTERM");
    const spawnFn = vi.fn(() => fakeChild(17));
    expect(await runWorkerEntrypoint({
      args: ["smith"], cwd: directory, env: {}, spawnFn,
    })).toBe(17);
    expect(spawnFn.mock.calls[0].slice(0, 2)).toEqual(["bash", [path.join(directory, "pforge.sh"), "smith"]]);
    expect(process.listenerCount("SIGTERM")).toBe(before);
  });

  it("keeps the assigned job home outside the clone when a repo-local pforge command runs", async () => {
    const directory = await workspace();
    const repo = path.join(directory, "repo");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(repo);
    await writeFile(path.join(repo, "pforge.sh"), "#!/bin/sh\nexit 0\n");
    await chmod(path.join(repo, "pforge.sh"), 0o755);
    const home = path.join(directory, "job-home");
    const spawnFn = vi.fn(() => fakeChild());
    await runWorkerEntrypoint({ args: ["smith"], cwd: repo, env: { HOME: home }, spawnFn });
    expect(spawnFn.mock.calls[0][2].env.HOME).toBe(home);
    expect(existsSync(path.join(repo, "home"))).toBe(false);
    expect(existsSync(home)).toBe(true);
  });
});

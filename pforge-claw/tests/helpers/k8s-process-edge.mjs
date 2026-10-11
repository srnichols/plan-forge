import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { run } from "../../src/jobs/worktree.mjs";
import { assertFixturePath, callJobFixture, HELPER_ROOT } from "./k8s-fixture-common.mjs";
import { runFixtureCommand } from "./k8s-command.mjs";
import { createPublicationGitFixture } from "./publication-git-fixture.mjs";

const GIT_WRITES = new Set(["checkout", "add", "commit", "push"]);
const CHILD_HELPERS = new Set(["k8s-command.mjs"]);
const REMOTE_ARGUMENT_FROM_END = 2;

async function cloneFixture({ args, options, env, workdir }) {
  const target = args.at(-1);
  const remote = new URL(args[args.length - REMOTE_ARGUMENT_FROM_END]);
  if (remote.protocol !== "https:" || remote.hostname !== "example.com" || remote.username || remote.password) {
    throw new Error("K8S_E2E_CLONE_REMOTE_INVALID");
  }
  await assertFixturePath(workdir, target);
  await mkdir(target, { recursive: true });
  const { files } = await callJobFixture({ env, route: "checkout" });
  for (const file of files) {
    const destination = await assertFixturePath(target, path.join(target, ...file.path.split("/")));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, Buffer.from(file.content, "base64"));
  }
  options.signal?.throwIfAborted();
  return { code: 0, stdout: "", stderr: "" };
}

async function gitFixtureCommand({ args, options, env, workdir, publicationGit }) {
  if (args[0] === "clone") return cloneFixture({ args, options, env, workdir });
  const operation = args[0] === "-C" ? args[2] : args[0];
  if (args[0] === "-C") await assertFixturePath(workdir, args[1]);
  const verifiedRef = publicationGit(args[0] === "-C" ? args.slice(2) : args);
  if (verifiedRef) return verifiedRef;
  if (operation === "status") return { code: 0, stdout: " M fixture.txt\n", stderr: "" };
  if (operation === "diff" && args.includes("--cached") && args.includes("--name-only")) {
    return { code: 0, stdout: "fixture.txt\n", stderr: "" };
  }
  if (operation === "rev-list") return { code: 0, stdout: "1\n", stderr: "" };
  if (GIT_WRITES.has(operation)) return { code: 0, stdout: "", stderr: "" };
  throw new Error("K8S_E2E_GIT_EDGE_REFUSED");
}

function nodeFixtureCommand({ command, args, options }) {
  if (command === process.execPath && CHILD_HELPERS.has(path.basename(args[0] ?? ""))
    && path.dirname(args[0]) === HELPER_ROOT) return run(command, args, options);
  throw new Error("K8S_E2E_EXTERNAL_COMMAND_REFUSED");
}

/** Inject only process/HTTPS Git transport edges; real runners and filesystem remain intact. */
export function createK8sProcessEdge({ env, workdir, onCommand = () => {} }) {
  const publicationGit = createPublicationGitFixture({ jobId: env.PFORGE_CLAW_JOB_ID });
  return async (command, args, options = {}) => {
    options.signal?.throwIfAborted();
    await assertFixturePath(workdir, options.cwd ?? workdir);
    onCommand({ command: path.basename(command), args: [...args] });
    if (command === "git") {
      const completed = await gitFixtureCommand({ args, options, env, workdir, publicationGit });
      return { ...completed, ...(options.requireSettlement === true ? { settlementConfirmed: true } : {}) };
    }
    if (["smith", "drain-memory"].includes(args.at(-1))) return runFixtureCommand([args.at(-1)], { cwd: options.cwd });
    return nodeFixtureCommand({ command, args, options });
  };
}

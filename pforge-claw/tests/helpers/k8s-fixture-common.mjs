import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonical } from "../../src/protocol/lease-grant.mjs";
import {
  FIXTURE_CA_ENV, FIXTURE_CONTEXT_ENV, FIXTURE_CORE_PORT, FIXTURE_HTTP_PORT, FIXTURE_NAMESPACE_ENV, FIXTURE_RUNTIME_ENV, FIXTURE_SECRET_NAME,
  validateE2eNamespace,
} from "../../scripts/k8s-e2e-overlay.mjs";

export const HELPER_ROOT = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_LANE = "k8s-dev";
export const FIXTURE_PREFIX = "/fixture/k8s";
export const FIXTURE_CONTROL_FILE = ".k8s-fixture-control.json";
export const FIXTURE_PROOF_FILE = "k8s-e2e-result.json";
export const FIXTURE_MAX_BYTES = 10_240;
export const FIXTURE_TIMEOUT_MS = 60_000;
export const FIXTURE_TCP_PORT_MAX = 65_535;
export const FIXTURE_HTTP_STATUS = Object.freeze({
  OK: 200, CREATED: 201, BAD_REQUEST: 400, UNAUTHORIZED: 401, FORBIDDEN: 403,
  NOT_FOUND: 404, CONFLICT: 409, BAD_GATEWAY: 502,
});
export { FIXTURE_CA_ENV, FIXTURE_CONTEXT_ENV, FIXTURE_CORE_PORT, FIXTURE_HTTP_PORT, FIXTURE_NAMESPACE_ENV, FIXTURE_RUNTIME_ENV, FIXTURE_SECRET_NAME };
const HEX_DIGEST = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
export const FIXTURE_PLAN_PATH = "docs/plans/fixture-plan.md";
export const FIXTURE_RECEIPT_FILE = ".k8s-fixture-worker-receipt.json";
const CHECKOUT_FILES = Object.freeze(["README.md", ".vscode/mcp.json", "pforge-mcp/server.mjs", FIXTURE_PLAN_PATH]);

/** Validate the fixture's disposable namespace and explicit local-cluster context. */
export function validateFixtureScope({ namespace, context }) {
  validateE2eNamespace(namespace);
  if (typeof context !== "string" || !/^(?:kind|k3d)-[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(context)) {
    throw new Error("K8S_E2E_CONTEXT_NOT_LOCAL");
  }
}

/** Fixture transports may reach only their own service or a test-owned loopback listener. */
export function validateFixtureTransport({ namespace, url: input }) {
  validateE2eNamespace(namespace);
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("K8S_E2E_FIXTURE_TRANSPORT_INVALID");
  }
  const hosts = ["127.0.0.1", "localhost", "[::1]",
    `pforge-claw-dispatcher.${namespace}.svc`, `pforge-claw-dispatcher.${namespace}.svc.cluster.local`];
  if (!["ws:", "wss:"].includes(url.protocol) || !hosts.includes(url.hostname)
    || url.pathname !== "/claw/workers" || url.username || url.password || url.search || url.hash) {
    throw new Error("K8S_E2E_FIXTURE_TRANSPORT_INVALID");
  }
  return url;
}

/** Reject paths outside an owned, existing fixture root, including symlink escapes. */
export async function assertFixturePath(root, target) {
  const canonicalRoot = await realpath(root);
  const relative = path.relative(canonicalRoot, path.resolve(target));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("K8S_E2E_FIXTURE_PATH_INVALID");
  }
  let current = canonicalRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const resolved = await realpath(current);
      const nested = path.relative(canonicalRoot, resolved);
      if (nested === ".." || nested.startsWith(`..${path.sep}`) || path.isAbsolute(nested)) {
        throw new Error("K8S_E2E_FIXTURE_PATH_INVALID");
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return path.resolve(target);
}

/** Validate a job identity without admitting path or transport overrides. */
export function validateFixtureJob(jobId) {
  if (typeof jobId !== "string" || !IDENTIFIER.test(jobId)) throw new Error("K8S_E2E_JOB_INVALID");
  return jobId;
}

/** Authenticate fixture-only control messages without comparing secret strings. */
export function sameFixtureToken(expected, candidate) {
  if (!HEX_DIGEST.test(expected ?? "") || !HEX_DIGEST.test(candidate ?? "")) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(candidate, "hex"));
}

/** Sign only a job-scoped fixture message; no secret is returned or persisted. */
export function signFixtureMessage({ key, namespace, context, route, jobId, body = {} }) {
  validateFixtureScope({ namespace, context });
  validateFixtureJob(jobId);
  if (!HEX_DIGEST.test(key ?? "")) throw new Error("K8S_E2E_JOB_AUTH_INVALID");
  return createHmac("sha256", key)
    .update(canonical({ namespace, context, route, jobId, body })).digest("hex");
}

/** Call the dispatcher fixture surface using the real worker's derived job key. */
export async function callJobFixture({ env, route, body = {}, fetchFn = fetch }) {
  const namespace = env[FIXTURE_NAMESPACE_ENV];
  const context = env[FIXTURE_CONTEXT_ENV];
  const jobId = env.PFORGE_CLAW_JOB_ID;
  const url = validateFixtureTransport({ namespace, url: env.PFORGE_CLAW_DISPATCHER_URL });
  if (!["checkout", "receipt"].includes(route)) throw new Error("K8S_E2E_FIXTURE_REQUEST_FAILED");
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = `${FIXTURE_PREFIX}/${route}`;
  const mac = signFixtureMessage({ key: env.PFORGE_CLAW_JOB_KEY, namespace, context, route, jobId, body });
  const response = await fetchFn(url, {
    method: "POST", signal: AbortSignal.timeout(FIXTURE_TIMEOUT_MS),
    headers: { "content-type": "application/json", "x-fixture-namespace": namespace, "x-fixture-context": context, "x-fixture-job": jobId, "x-fixture-mac": mac },
    body: JSON.stringify(body),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!response.ok || bytes.length > FIXTURE_MAX_BYTES) throw new Error("K8S_E2E_FIXTURE_REQUEST_FAILED");
  return JSON.parse(bytes.toString("utf8"));
}

/** Read the bounded, private fixture control capability on the dispatcher only. */
export async function readFixtureControl(home) {
  const file = await assertFixturePath(home, path.join(home, FIXTURE_CONTROL_FILE));
  const bytes = await readFile(file);
  if (bytes.length > FIXTURE_MAX_BYTES) throw new Error("K8S_E2E_CONTROL_INVALID");
  const control = JSON.parse(bytes.toString("utf8"));
  validateFixtureScope(control);
  if (!HEX_DIGEST.test(control.token ?? "") || !/^http:\/\/127\.0\.0\.1:\d+$/.test(control.url ?? "")) {
    throw new Error("K8S_E2E_CONTROL_INVALID");
  }
  return control;
}

/** Materialize only disposable project bytes; no Git, dependency install or credentials. */
export async function prepareFixtureProject(project) {
  await mkdir(project.repo.path, { recursive: true });
  await mkdir(project.repo.forgeHome, { recursive: true });
  const files = {
    "README.md": `Disposable Kubernetes fixture ${project.id}.\n`,
    [FIXTURE_PLAN_PATH]: "# Disposable fixture plan\n\n## Slice 1\nFixture only.\n\n## Slice 2\nFixture only.\n",
    ".vscode/mcp.json": JSON.stringify({ servers: {
      "plan-forge": { command: process.execPath, args: [path.join(HELPER_ROOT, "fake-project-mcp.mjs")] },
    } }),
    "pforge-mcp/server.mjs": [
      `import { startFixtureProjectHttp } from ${JSON.stringify(new URL("./k8s-project-http.mjs", import.meta.url).href)};`,
      "await startFixtureProjectHttp();",
    ].join("\n"),
    ".forge.json": JSON.stringify({
      runtimes: { pforgeCommand: [process.execPath, path.join(HELPER_ROOT, "k8s-command.mjs")], ghCommand: [process.execPath, path.join(HELPER_ROOT, "k8s-command.mjs"), "gh"] },
    }),
  };
  for (const [relative, contents] of Object.entries(files)) {
    const file = await assertFixturePath(project.repo.path, path.join(project.repo.path, ...relative.split("/")));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  }
}

/** Supply a strict allow-listed checkout at the external HTTPS clone boundary. */
export async function fixtureCheckout(project) {
  const files = [];
  for (const relative of CHECKOUT_FILES) {
    const file = await assertFixturePath(project.repo.path, path.join(project.repo.path, ...relative.split("/")));
    files.push({ path: relative, content: (await readFile(file)).toString("base64") });
  }
  return { files };
}

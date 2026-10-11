import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { buildJobEgressPolicy } from "../src/k8s/egress-policy.mjs";
import { ROLES } from "../src/enums.mjs";
import { generateFixtureTls } from "../tests/helpers/k8s-fixture-tls.mjs";

export const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const FIXTURE_SECRET_NAME = "pforge-claw-fixture";
export const FIXTURE_NAMESPACE_ENV = "PFORGE_CLAW_FIXTURE_NAMESPACE";
export const FIXTURE_CONTEXT_ENV = "PFORGE_CLAW_FIXTURE_CONTEXT";
export const FIXTURE_RUNTIME_ENV = "PFORGE_CLAW_FIXTURE_RUNTIME_TOKEN";
export const FIXTURE_CA_ENV = "PFORGE_CLAW_FIXTURE_CA";
export const FIXTURE_TLS_CERT_ENV = "PFORGE_CLAW_FIXTURE_TLS_CERT";
export const FIXTURE_TLS_KEY_ENV = "PFORGE_CLAW_FIXTURE_TLS_KEY";
const DEV_OVERLAY = path.join(PACKAGE_ROOT, "deploy", "k8s", "overlays", "dev");
const BASE_NAMESPACE = "pforge-claw";
const DISPATCHER_NAME = "pforge-claw-dispatcher";
const EGRESS_CONTROL_NAME = "pforge-claw-egress-control";
const EGRESS_PROBE_NAME = "pforge-claw-egress-probe";
const EGRESS_TARGET_NAME = "pforge-claw-egress-target";
const PROBE_TIMEOUT_MS = 5000;
const MIN_SUCCESS_STATUS = 200;
const MAX_SUCCESS_STATUS = 300;
const E2E_NAMESPACE = /^pforge-claw-e2e-[a-z0-9]([-a-z0-9]{0,45}[a-z0-9])?$/;
const NAMESPACE_MAX_LENGTH = 63;
export const FIXTURE_HTTP_PORT = 3190;
export const FIXTURE_CORE_PORT = 3191;
const SECRET_RANDOM_BYTES = 32;

/**
 * Require a disposable namespace, never an operator's existing deployment namespace.
 * @param {string} namespace
 * @returns {string}
 */
export function validateE2eNamespace(namespace) {
  if (typeof namespace !== "string" || !E2E_NAMESPACE.test(namespace) || namespace.length > NAMESPACE_MAX_LENGTH) {
    throw new Error("K8S_E2E_NAMESPACE_INVALID");
  }
  return namespace;
}

function imageOverride(name, image) {
  if (typeof image !== "string" || !/^[a-z0-9][a-z0-9./_:@-]*$/i.test(image)) {
    throw new Error("K8S_E2E_IMAGE_INVALID");
  }

  const digestIndex = image.indexOf("@");
  if (digestIndex !== -1) {
    const digest = image.slice(digestIndex + 1);
    if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error("K8S_E2E_IMAGE_DIGEST_INVALID");
    return { name, newName: image.slice(0, digestIndex), digest };
  }
  const tagIndex = image.lastIndexOf(":");
  if (tagIndex <= image.lastIndexOf("/")) throw new Error("K8S_E2E_IMAGE_TAG_REQUIRED");
  const newTag = image.slice(tagIndex + 1);
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(newTag)) throw new Error("K8S_E2E_IMAGE_TAG_REQUIRED");
  return { name, newName: image.slice(0, tagIndex), newTag };
}

function fixtureSecretEnv(name) {
  return { name, valueFrom: { secretKeyRef: { name: FIXTURE_SECRET_NAME, key: name } } };
}

function dispatcherFixturePatch({ namespace, context }) {
  return {
    target: { group: "apps", version: "v1", kind: "Deployment", name: DISPATCHER_NAME },
    patch: JSON.stringify([
      { op: "add", path: "/spec/template/spec/containers/0/command", value: ["node", "/app/tests/helpers/k8s-dispatcher.mjs"] },
      { op: "replace", path: "/spec/template/spec/containers/0/env", value: [
        { name: "PFORGE_CLAW_HOME", value: "/data" },
        { name: FIXTURE_NAMESPACE_ENV, value: namespace },
        { name: FIXTURE_CONTEXT_ENV, value: context },
        fixtureSecretEnv(FIXTURE_TLS_CERT_ENV), fixtureSecretEnv(FIXTURE_TLS_KEY_ENV),
      ] },
      { op: "add", path: "/spec/template/spec/containers/0/livenessProbe/httpGet/scheme", value: "HTTPS" },
      { op: "add", path: "/spec/template/spec/containers/0/readinessProbe/httpGet/scheme", value: "HTTPS" },
      { op: "add", path: "/spec/template/spec/volumes/-", value: { name: "fixture-config", configMap: { name: "pforge-claw-config" } } },
      { op: "add", path: "/spec/template/spec/containers/0/volumeMounts/-", value: { name: "fixture-config", mountPath: "/fixture-config", readOnly: true } },
    ]),
  };
}

function dispatcherProbePatch({ namespace }) {
  const dispatcherUrl = `https://${DISPATCHER_NAME}.${namespace}.svc:${FIXTURE_HTTP_PORT}/healthz`;
  const negativeUrl = `http://${EGRESS_TARGET_NAME}:${FIXTURE_HTTP_PORT}/healthz`;
  const code = [
    'import { get } from "node:https"; import { lookup } from "node:dns/promises";',
    `const ca = process.env.${FIXTURE_CA_ENV};`,
    'if (!ca) throw new Error("fixture CA is required");',
    `const signal = () => AbortSignal.timeout(${PROBE_TIMEOUT_MS});`,
    `const status = await new Promise((resolve, reject) => { const request = get(${JSON.stringify(dispatcherUrl)}, { ca, signal: signal() }, (response) => { response.resume(); resolve(response.statusCode); }); request.once("error", reject); });`,
    `if (!(status >= ${MIN_SUCCESS_STATUS} && status < ${MAX_SUCCESS_STATUS})) throw new Error("allowed dispatcher unavailable");`,
    `await lookup(${JSON.stringify(EGRESS_TARGET_NAME)}); let denied = false;`,
    `try { await fetch(${JSON.stringify(negativeUrl)}, { signal: signal() }); } catch { denied = true; }`,
    'if (!denied) throw new Error("worker policy unexpectedly allowed the negative target");',
    'console.log("worker policy allowed dispatcher and DNS; negative target denied");',
  ].join(" ");
  return {
    target: { group: "batch", version: "v1", kind: "Job", name: EGRESS_PROBE_NAME },
    patch: JSON.stringify([
      { op: "replace", path: "/spec/template/spec/containers/0/command", value: ["node", "--input-type=module", "-e", code] },
      { op: "add", path: "/spec/template/spec/containers/0/env", value: [fixtureSecretEnv(FIXTURE_CA_ENV)] },
    ]),
  };
}

/**
 * Pin Namespace, namespaced resources, RBAC subjects and fixture images in one Kustomize overlay.
 * The disposable worker probe verifies dispatcher HTTPS with its fixture CA; the negative target stays HTTP.
 * @param {{namespace: string, destination: string, dispatcherImage: string, workerImage: string}} options
 * @returns {object}
 */
export function buildDevOverlay({ namespace, destination, dispatcherImage, workerImage, context = "kind-fixture" }) {
  validateE2eNamespace(namespace);
  return {
    apiVersion: "kustomize.config.k8s.io/v1beta1",
    kind: "Kustomization",
    namespace,
    resources: [path.relative(destination, DEV_OVERLAY), "job-egress.yaml"],
    images: [
      imageOverride(DISPATCHER_NAME, dispatcherImage),
      imageOverride("pforge-claw-worker-node", workerImage),
    ],
    patches: [
      {
        target: { version: "v1", kind: "Namespace", name: BASE_NAMESPACE },
        patch: JSON.stringify([{ op: "replace", path: "/metadata/name", value: namespace }]),
      },
      {
        target: { group: "rbac.authorization.k8s.io", version: "v1", kind: "RoleBinding", name: DISPATCHER_NAME },
        patch: JSON.stringify([{ op: "replace", path: "/subjects/0/namespace", value: namespace }]),
      },
      ...[EGRESS_CONTROL_NAME, EGRESS_PROBE_NAME].map((name) => ({
        target: { group: "batch", version: "v1", kind: "Job", name },
        patch: JSON.stringify([{ op: "add", path: "/spec/suspend", value: true }]),
      })),
      dispatcherFixturePatch({ namespace, context }),
      dispatcherProbePatch({ namespace }),
    ],
    configMapGenerator: [{ name: "pforge-claw-config", behavior: "replace", files: ["config.json"] }],
  };
}

/**
 * Rebase fixture lane configuration onto the same isolated namespace and worker image.
 * @param {{namespace: string, workerImage: string, template: object}} options
 * @returns {object}
 */
export function materializeDevConfig({
  namespace, workerImage, template, context = "kind-fixture", fixtureHome = "/data", pathImpl = path.posix,
}) {
  validateE2eNamespace(namespace);
  imageOverride("pforge-claw-worker-node", workerImage);
  const config = structuredClone(template);
  for (const lane of config.lanes) {
    if (lane.kind !== "k8s") continue;
    lane.k8s.namespace = namespace;
    lane.k8s.defaultImage = workerImage;
    if (config.projects) lane.k8s.secrets = {
      github: { name: FIXTURE_SECRET_NAME, key: "PFORGE_CLAW_GH_TOKEN" },
      copilot: false,
      env: Object.fromEntries([FIXTURE_NAMESPACE_ENV, FIXTURE_CONTEXT_ENV, FIXTURE_RUNTIME_ENV, FIXTURE_CA_ENV]
        .map((name) => [name, { name: FIXTURE_SECRET_NAME, key: name }])),
    };
  }
  if (!config.projects) return config;
  materializeFixtureIdentity(config);
  config.worker = {
    dispatcherUrl: `wss://${DISPATCHER_NAME}.${namespace}.svc:${FIXTURE_HTTP_PORT}/claw/workers`,
  };
  config.http = { bind: "127.0.0.1", port: FIXTURE_CORE_PORT };
  config.runtimes = {
    default: "openai", pforgeCommand: "auto",
    byok: { openai: { keySecret: FIXTURE_RUNTIME_ENV, endpoint: "https://example.com/runtime" } },
  };
  config.projects = config.projects.map((project, index) => fixtureProjectConfig({
    project, index, fixtureHome, pathImpl, workerImage,
  }));
  void context;
  return config;
}

function materializeFixtureIdentity(config) {
  config.instanceId = "k8s-fixture";
  const chatId = "1";
  config.channels = { telegram: {
    enabled: true, botTokenSecret: "PFORGE_CLAW_TELEGRAM_TOKEN", mode: "poll", generalChat: { chatId },
  } };
  config.allowlist = ROLES.map((role, index) => ({
    channel: "telegram", userId: String(index + 1), role,
  }));
  config.schedules = [];
  config.bootstrap = { copy: [".forge.json"], env: [], install: "none" };
  delete config.memory;
  delete config.capture;
}

function fixtureProjectConfig({ project, index, fixtureHome, pathImpl, workerImage }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(project.id ?? "")) throw new Error("K8S_E2E_PROJECT_INVALID");
  const repoPath = pathImpl.join(fixtureHome, "fixtures", project.id);
  return {
    ...project,
    repo: { path: repoPath, forgeHome: pathImpl.join(repoPath, ".forge"), remote: `https://example.com/${project.id}.git`, baseBranch: "main" },
    channel: { adapter: "telegram", chatId: "1", topicId: String(index + 1) },
    homeLane: "local", image: workerImage,
    models: { chat: "fixture-chat", work: "fixture-work" },
    bootstrap: {
      copy: [".forge.json"], env: [FIXTURE_NAMESPACE_ENV, FIXTURE_CONTEXT_ENV, FIXTURE_RUNTIME_ENV, FIXTURE_CA_ENV], install: "none",
    },
  };
}

/**
 * Write only into an existing directory inside this package, including after symlink resolution.
 * @param {{namespace: string, destination: string, dispatcherImage: string, workerImage: string, config?: object}} options
 * @returns {Promise<{directory: string, config: object, kustomization: object}>}
 */
export async function writeDevOverlay(options) {
  const [root, destination] = await Promise.all([realpath(PACKAGE_ROOT), realpath(options.destination)]);
  const relative = path.relative(root, destination);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("K8S_E2E_DESTINATION_INVALID");
  }
  const kustomization = buildDevOverlay({ ...options, destination });
  const template = options.config ?? JSON.parse(await readFile(path.join(DEV_OVERLAY, "config.json"), "utf8"));
  const config = materializeDevConfig({ ...options, template });
  const egress = buildJobEgressPolicy({ namespace: options.namespace, allow: config.k8s?.egress?.allow ?? [] });
  const tls = await generateFixtureTls(options.namespace);
  const secrets = {
    PFORGE_CLAW_GH_TOKEN: randomBytes(SECRET_RANDOM_BYTES).toString("hex"),
    [FIXTURE_RUNTIME_ENV]: randomBytes(SECRET_RANDOM_BYTES).toString("hex"),
    [FIXTURE_NAMESPACE_ENV]: options.namespace,
    [FIXTURE_CONTEXT_ENV]: options.context ?? "kind-fixture",
    [FIXTURE_CA_ENV]: tls.ca,
    [FIXTURE_TLS_CERT_ENV]: tls.cert,
    [FIXTURE_TLS_KEY_ENV]: tls.key,
  };
  kustomization.secretGenerator = [{ name: FIXTURE_SECRET_NAME, literals: Object.entries(secrets).map(([key, value]) => `${key}=${value}`) }];
  kustomization.generatorOptions = { disableNameSuffixHash: true };
  await writeFile(path.join(destination, "kustomization.yaml"), JSON.stringify(kustomization, null, 2) + "\n", { mode: 0o600 });
  await writeFile(path.join(destination, "config.json"), JSON.stringify(config, null, 2) + "\n");
  await writeFile(path.join(destination, "job-egress.yaml"), JSON.stringify(egress, null, 2) + "\n");
  return { directory: destination, config, kustomization };
}

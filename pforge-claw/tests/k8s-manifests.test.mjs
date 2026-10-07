import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateConfig } from "../src/config.mjs";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const K8S_ROOT = path.join(PACKAGE_ROOT, "deploy", "k8s");
const BASE_ROOT = path.join(K8S_ROOT, "base");
const OVERLAY_ROOT = path.join(K8S_ROOT, "overlays", "example");
const BASE_KUSTOMIZATION = path.join(BASE_ROOT, "kustomization.yaml");
const OVERLAY_KUSTOMIZATION = path.join(OVERLAY_ROOT, "kustomization.yaml");
const DEPLOYMENT_NAME = "pforge-claw-dispatcher";
const DISPATCHER_SECRET = "pforge-claw-secrets";
const D12_RULES = Object.freeze({
  batch: Object.freeze({ jobs: new Set(["create", "get", "list", "watch", "delete"]) }),
  "": Object.freeze({
    pods: new Set(["get", "list", "watch"]),
    "pods/log": new Set(["get", "list", "watch"]),
  }),
});

function stripComment(line) {
  let quote = null;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quote === '"') {
      if (char === "\\" && index + 1 < line.length) index++;
      else if (char === '"') quote = null;
    } else if (quote === "'") {
      if (char === "'" && line[index + 1] === "'") index++;
      else if (char === "'") quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "#" && (index === 0 || /\s/.test(line[index - 1]))) {
      return line.slice(0, index).trimEnd();
    }
  }
  return line.trimEnd();
}

function splitMapping(text) {
  let quote = null;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quote === '"') {
      if (char === "\\") index++;
      else if (char === '"') quote = null;
    } else if (quote === "'") {
      if (char === "'" && text[index + 1] === "'") index++;
      else if (char === "'") quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ":" && (index === text.length - 1 || /\s/.test(text[index + 1]))) {
      const key = text.slice(0, index).trim();
      if (!key || key.includes(":")) throw new Error(`Invalid YAML mapping key: ${text}`);
      return [key, text.slice(index + 1).trim()];
    }
  }
  throw new Error(`Expected a YAML mapping entry: ${text}`);
}

function splitInlineList(text) {
  const parts = [];
  let quote = null;
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quote === '"') {
      if (char === "\\") index++;
      else if (char === '"') quote = null;
    } else if (quote === "'") {
      if (char === "'" && text[index + 1] === "'") index++;
      else if (char === "'") quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ",") {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (quote) throw new Error("Unterminated quoted scalar in inline list.");
  const last = text.slice(start).trim();
  if (last) parts.push(last);
  return parts;
}

function parseScalar(text) {
  if (!text) return null;
  if (text === "[]") return [];
  if (text === "{}") return {};
  if (text.startsWith("{")) throw new Error("Only empty inline YAML maps are supported.");
  if (text.startsWith("[") && text.endsWith("]")) {
    const contents = text.slice(1, -1).trim();
    if (!contents) return [];
    const parts = splitInlineList(contents);
    if (parts.some((part) => !part)) throw new Error("Empty values are not supported in inline YAML lists.");
    return parts.map(parseScalar);
  }
  if (text.startsWith("[") || text.endsWith("]") || text.endsWith("}")) {
    throw new Error(`Malformed inline YAML scalar: ${text}`);
  }
  if (text.startsWith('"')) {
    try {
      const value = JSON.parse(text);
      if (typeof value !== "string") throw new Error("Expected a quoted string.");
      return value;
    } catch (error) {
      throw new Error(`Invalid double-quoted YAML scalar: ${text}`, { cause: error });
    }
  }
  if (text.startsWith("'")) {
    if (!text.endsWith("'") || text.length < 2) throw new Error(`Invalid single-quoted YAML scalar: ${text}`);
    return text.slice(1, -1).replaceAll("''", "'");
  }
  if (/^(?:[&*!]|.*\s[&*!])/.test(text)) throw new Error(`Unsupported YAML anchor, alias, or tag: ${text}`);
  if (text === "|" || text === ">" || text.startsWith("|") || text.startsWith(">")) {
    throw new Error(`Unsupported YAML block scalar: ${text}`);
  }
  if (/^(?:null|Null|NULL|~)$/.test(text)) return null;
  if (/^(?:true|True|TRUE)$/.test(text)) return true;
  if (/^(?:false|False|FALSE)$/.test(text)) return false;
  if (/^-?(?:0|[1-9]\d*)$/.test(text)) return Number(text);
  return text;
}

function parseYamlDocument(text) {
  const lines = text.split(/\r?\n/).flatMap((line, index) => {
    if (line.includes("\t")) throw new Error(`Tabs are not valid indentation (line ${index + 1}).`);
    const content = stripComment(line);
    if (!content.trim()) return [];
    const indent = content.length - content.trimStart().length;
    if (indent % 2 !== 0) throw new Error(`Inconsistent indentation (line ${index + 1}).`);
    return [{ indent, text: content.trimStart(), line: index + 1 }];
  });
  if (lines.length === 0) return null;

  function parseBlock(start, indent) {
    if (lines[start]?.indent !== indent) throw new Error(`Unexpected indentation (line ${lines[start]?.line}).`);
    const isList = lines[start].text === "-" || lines[start].text.startsWith("- ");
    const value = isList ? [] : {};
    let index = start;
    while (index < lines.length && lines[index].indent === indent) {
      const line = lines[index];
      const isItem = line.text === "-" || line.text.startsWith("- ");
      if (isItem !== isList) throw new Error(`Mixed YAML list and map (line ${line.line}).`);
      if (isList) {
        const itemText = line.text.slice(1).trim();
        index++;
        if (!itemText) {
          if (lines[index]?.indent !== indent + 2) throw new Error(`Missing nested YAML list value (line ${line.line}).`);
          const [item, next] = parseBlock(index, indent + 2);
          value.push(item);
          index = next;
        } else if (!itemText.startsWith('"') && !itemText.startsWith("'") && /:\s|:$/.test(itemText)) {
          const [key, raw] = splitMapping(itemText);
          const item = {};
          if (Object.hasOwn(item, key)) throw new Error(`Duplicate YAML key "${key}" (line ${line.line}).`);
          if (raw) {
            item[key] = parseScalar(raw);
          } else if (lines[index]?.indent === indent + 4) {
            const [nested, next] = parseBlock(index, indent + 4);
            item[key] = nested;
            index = next;
          } else {
            item[key] = null;
          }
          if (lines[index]?.indent === indent + 2) {
            const [continuation, next] = parseBlock(index, indent + 2);
            if (!continuation || Array.isArray(continuation)) throw new Error(`Expected mapping continuation (line ${line.line}).`);
            for (const [continuedKey, continuedValue] of Object.entries(continuation)) {
              if (Object.hasOwn(item, continuedKey)) throw new Error(`Duplicate YAML key "${continuedKey}".`);
              item[continuedKey] = continuedValue;
            }
            index = next;
          }
          value.push(item);
        } else {
          value.push(parseScalar(itemText));
        }
      } else {
        const [key, raw] = splitMapping(line.text);
        if (Object.hasOwn(value, key)) throw new Error(`Duplicate YAML key "${key}" (line ${line.line}).`);
        index++;
        if (raw) {
          value[key] = parseScalar(raw);
        } else if (lines[index]?.indent === indent + 2) {
          const [nested, next] = parseBlock(index, indent + 2);
          value[key] = nested;
          index = next;
        } else {
          if (lines[index]?.indent > indent) throw new Error(`Inconsistent indentation (line ${lines[index].line}).`);
          value[key] = null;
        }
      }
      if (lines[index]?.indent > indent && (!isList || lines[index].indent !== indent + 2)) {
        throw new Error(`Unexpected indentation (line ${lines[index].line}).`);
      }
    }
    return [value, index];
  }

  const [document, next] = parseBlock(0, lines[0].indent);
  if (next !== lines.length || lines[0].indent !== 0) throw new Error("YAML document has trailing or indented content.");
  return document;
}

function parseYamlSubset(text) {
  return text.split(/^\s*---\s*$/m)
    .map(parseYamlDocument)
    .filter((document) => document !== null);
}

function walkYaml(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walkYaml(fullPath, files);
    else if (entry.isFile() && entry.name.endsWith(".yaml")) files.push(fullPath);
  }
  return files;
}

function loadAll() {
  return walkYaml(K8S_ROOT).flatMap((file) => parseYamlSubset(readFileSync(file, "utf8"))
    .map((doc) => ({ file, doc })));
}

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function documentsOfKind(documents, kind) {
  return documents.filter(({ doc }) => doc.kind === kind).map(({ doc }) => doc);
}

function getDeployment(documents) {
  const deployment = documentsOfKind(documents, "Deployment")[0];
  ensure(deployment, "A dispatcher Deployment is required.");
  return deployment;
}

function checkNoClusterRoles(documents) {
  ensure(!documents.some(({ doc }) => ["ClusterRole", "ClusterRoleBinding"].includes(doc.kind)), "Cluster-wide RBAC is forbidden.");
}

function checkRoleRules(documents) {
  for (const role of documentsOfKind(documents, "Role")) {
    for (const rule of role.rules ?? []) {
      const groups = rule.apiGroups ?? [];
      const resources = rule.resources ?? [];
      const verbs = rule.verbs ?? [];
      ensure(groups.length > 0 && resources.length > 0 && verbs.length > 0, "Role rules must name groups, resources, and verbs.");
      ensure(![...groups, ...resources, ...verbs].includes("*"), "Wildcard RBAC rules are forbidden.");
      for (const group of groups) {
        for (const resource of resources) {
          const allowed = D12_RULES[group]?.[resource];
          ensure(allowed, `RBAC resource ${group}/${resource} is outside the D12 matrix.`);
          ensure(verbs.every((verb) => allowed.has(verb)), `RBAC verbs exceed the D12 matrix for ${group}/${resource}.`);
        }
      }
    }
  }
}

function checkNoInlineSecrets(documents) {
  ensure(!documents.some(({ doc }) => doc.kind === "Secret" && (Object.hasOwn(doc, "data") || Object.hasOwn(doc, "stringData"))), "Inline Kubernetes Secret data is forbidden.");
  ensure(!documents.some(({ doc }) => Object.hasOwn(doc, "secretGenerator")), "secretGenerator is forbidden.");
}

function checkDeploymentShape(documents) {
  const deployment = getDeployment(documents);
  ensure(deployment.spec?.replicas === 1, "Dispatcher Deployment must have exactly one replica.");
  ensure(deployment.spec?.strategy?.type === "Recreate", "Dispatcher Deployment strategy must be Recreate.");
  ensure(!Object.hasOwn(deployment.spec?.strategy ?? {}, "rollingUpdate"), "Recreate strategy must not define rollingUpdate.");
}

function checkSecurityContexts(documents) {
  const podSpec = getDeployment(documents).spec?.template?.spec;
  ensure(podSpec?.securityContext?.runAsNonRoot === true, "Pod securityContext must set runAsNonRoot: true.");
  for (const container of podSpec?.containers ?? []) {
    ensure(container.securityContext?.runAsNonRoot !== false, "Containers must not disable runAsNonRoot.");
    ensure(container.securityContext?.allowPrivilegeEscalation === false, "Containers must disable privilege escalation.");
  }
}

function checkPersistentHome(documents) {
  const podSpec = getDeployment(documents).spec?.template?.spec;
  const home = podSpec?.containers?.[0];
  ensure(home?.env?.some(({ name, value }) => name === "PFORGE_CLAW_HOME" && value === "/data"), "PFORGE_CLAW_HOME must be /data.");
  ensure(home?.volumeMounts?.some(({ mountPath }) => mountPath === "/data"), "Dispatcher must mount persistent storage at /data.");
}

function checkNetworkPolicy(documents) {
  const policy = documentsOfKind(documents, "NetworkPolicy").find(({ metadata }) => metadata?.name === "pforge-claw-dispatcher");
  ensure(policy, "Dispatcher NetworkPolicy is required.");
  ensure(policy.spec?.podSelector?.matchLabels?.app === "pforge-claw"
    && policy.spec?.podSelector?.matchLabels?.component === "dispatcher", "NetworkPolicy must select the dispatcher.");
  ensure((policy.spec?.policyTypes ?? []).includes("Egress"), "Dispatcher NetworkPolicy must include Egress.");
  ensure(policy.spec?.ingress?.length === 1
    && policy.spec.ingress[0].ports?.length === 1
    && policy.spec.ingress[0].ports[0].protocol === "TCP"
    && policy.spec.ingress[0].ports[0].port === 3190, "NetworkPolicy ingress must allow only TCP 3190.");
  const egressPorts = (policy.spec?.egress ?? []).flatMap(({ ports = [] }) => ports);
  ensure(egressPorts.some(({ protocol, port }) => protocol === "UDP" && port === 53)
    && egressPorts.some(({ protocol, port }) => protocol === "TCP" && port === 53)
    && egressPorts.some(({ protocol, port }) => protocol === "TCP" && port === 443), "NetworkPolicy egress must allow DNS and TCP 443.");
  ensure(policy.spec.egress.some(({ to = [] }) => to.some(({ ipBlock }) => ipBlock?.cidr === "0.0.0.0/0"
    && !Object.hasOwn(ipBlock, "except"))), "NetworkPolicy must permit HTTPS egress without private-CIDR exceptions.");
}

function checkBaseHasNoIngress(documents) {
  const base = documents.find(({ file }) => file === BASE_KUSTOMIZATION)?.doc;
  ensure(base, "Base kustomization.yaml is required.");
  ensure(!(base.resources ?? []).some((resource) => /ingress/i.test(resource)), "Base kustomization must not include Ingress.");
}

const INVARIANT_CHECKERS = Object.freeze({
  noClusterRoles: checkNoClusterRoles,
  roleRules: checkRoleRules,
  noInlineSecrets: checkNoInlineSecrets,
  deploymentShape: checkDeploymentShape,
  securityContexts: checkSecurityContexts,
  persistentHome: checkPersistentHome,
  networkPolicy: checkNetworkPolicy,
  baseHasNoIngress: checkBaseHasNoIngress,
});

describe("Kubernetes YAML subset parser", () => {
  it("parses nested maps, lists, quoted and primitive scalars", () => {
    expect(parseYamlSubset(`root:
  values:
    - name: "quoted value"
      enabled: true
      count: 3
      empty: null
    - name: second
  emptyList: []
  emptyMap: {}`)).toEqual([{
      root: {
        values: [
          { name: "quoted value", enabled: true, count: 3, empty: null },
          { name: "second" },
        ],
        emptyList: [],
        emptyMap: {},
      },
    }]);
  });

  it.each([
    ["anchors", "value: &anchor thing"],
    ["aliases", "value: *anchor"],
    ["block scalars", "value: |"],
    ["tags", "value: !custom thing"],
  ])("rejects %s", (_name, yaml) => {
    expect(() => parseYamlSubset(yaml)).toThrow();
  });

  it("rejects inconsistent indentation without returning a partial parse", () => {
    expect(() => parseYamlSubset("root:\n   child: value")).toThrow(/indentation/i);
  });
});

describe("Kubernetes dispatcher manifests", () => {
  it("parses every YAML file and gives every resource document required metadata", () => {
    const files = walkYaml(K8S_ROOT);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(parseYamlSubset(readFileSync(file, "utf8")).length, file).toBeGreaterThan(0);
    }
    for (const { file, doc } of loadAll()) {
      if (doc.kind === "Kustomization") continue;
      expect(doc.apiVersion, file).toBeTruthy();
      expect(doc.kind, file).toBeTruthy();
      expect(doc.metadata?.name, file).toBeTruthy();
    }
  });

  it("resolves every kustomization resource and patch path", () => {
    for (const { file, doc } of loadAll()) {
      if (doc.kind !== "Kustomization") continue;
      const referencedPaths = [
        ...(doc.resources ?? []),
        ...(doc.patches ?? []).map((patch) => typeof patch === "string" ? patch : patch.path),
      ];
      for (const resource of referencedPaths) {
        expect(resource, file).toBeTruthy();
        expect(existsSync(path.resolve(path.dirname(file), resource)), `${file}: ${resource}`).toBe(true);
      }
    }
  });

  it("lists every base manifest in the base kustomization", () => {
    const base = parseYamlSubset(readFileSync(BASE_KUSTOMIZATION, "utf8"))[0];
    const manifests = readdirSync(BASE_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml") && entry.name !== "kustomization.yaml")
      .map((entry) => entry.name)
      .sort();
    expect([...base.resources].sort()).toEqual(manifests);
  });

  it("keeps service, deployment, storage, service account and RBAC references aligned", () => {
    const documents = loadAll();
    const deployment = getDeployment(documents);
    const podSpec = deployment.spec.template.spec;
    const service = documentsOfKind(documents, "Service")[0];
    const pvc = documentsOfKind(documents, "PersistentVolumeClaim")[0];
    const roleBinding = documentsOfKind(documents, "RoleBinding")[0];
    const serviceAccount = documentsOfKind(documents, "ServiceAccount")[0];
    const container = podSpec.containers[0];
    expect(service.spec.selector).toEqual(deployment.spec.template.metadata.labels);
    expect(service.spec.ports[0].targetPort).toBe(container.ports[0].name);
    expect(podSpec.volumes.find(({ name }) => name === "data").persistentVolumeClaim.claimName).toBe(pvc.metadata.name);
    expect(pvc.spec).toMatchObject({ accessModes: ["ReadWriteOnce"] });
    expect(pvc.spec.resources.requests.storage).toBe("1Gi");
    expect(pvc.spec).not.toHaveProperty("storageClassName");
    expect(podSpec.serviceAccountName).toBe("pforge-claw-dispatcher");
    expect(serviceAccount).toMatchObject({ metadata: { name: podSpec.serviceAccountName }, automountServiceAccountToken: true });
    expect(roleBinding.roleRef).toMatchObject({ kind: "Role", name: "pforge-claw-dispatcher" });
    expect(roleBinding.subjects).toContainEqual(expect.objectContaining({
      kind: "ServiceAccount",
      name: podSpec.serviceAccountName,
      namespace: "pforge-claw",
    }));
    expect(service.spec.ports[0]).toMatchObject({ port: 3190, protocol: "TCP" });
  });

  it("mounts the generated configuration read-only and exposes only the intended ingress paths", () => {
    const overlay = parseYamlSubset(readFileSync(OVERLAY_KUSTOMIZATION, "utf8"))[0];
    const deploymentPatchPath = path.join(OVERLAY_ROOT, "patch-deployment.yaml");
    const deploymentPatch = parseYamlSubset(readFileSync(deploymentPatchPath, "utf8"))[0];
    const patchedContainer = deploymentPatch.spec.template.spec.containers[0];
    const configMount = patchedContainer.volumeMounts.find(({ mountPath }) => mountPath === "/data/config.json");
    expect(overlay.configMapGenerator).toContainEqual(expect.objectContaining({
      name: "pforge-claw-config",
      files: ["config.json"],
    }));
    expect(configMount).toMatchObject({ name: "config", subPath: "config.json", readOnly: true });
    expect(deploymentPatch.spec.template.spec.volumes).toContainEqual(expect.objectContaining({
      name: "config",
      configMap: expect.objectContaining({ name: "pforge-claw-config" }),
    }));
    const ingress = documentsOfKind(loadAll(), "Ingress")[0];
    const paths = ingress.spec.rules.flatMap(({ http }) => http.paths.map(({ path: route }) => route));
    expect(paths).toEqual(["/telegram/webhook", "/claw/workers"]);
    expect(paths).not.toContain("/healthz");
    expect(paths).not.toContain("/readyz");
    expect(ingress.spec.tls[0]).toMatchObject({
      hosts: ["pforge-claw.example"],
      secretName: "pforge-claw-tls",
    });
  });

  it("satisfies each named security, RBAC, storage and networking invariant", () => {
    const documents = loadAll();
    for (const checker of Object.values(INVARIANT_CHECKERS)) checker(documents);
    const role = documentsOfKind(documents, "Role")[0];
    expect(role.metadata.namespace).toBe("pforge-claw");
    const deployment = getDeployment(documents);
    const podSpec = deployment.spec.template.spec;
    const container = podSpec.containers[0];
    const env = container.env;
    const tokenEnv = env.find(({ name }) => name === "PFORGE_CLAW_TELEGRAM_TOKEN");
    expect(tokenEnv.valueFrom.secretKeyRef).toEqual({
      name: DISPATCHER_SECRET,
      key: "PFORGE_CLAW_TELEGRAM_TOKEN",
    });
    expect(tokenEnv.valueFrom.secretKeyRef).not.toHaveProperty("optional");
    for (const name of ["PFORGE_CLAW_TELEGRAM_WEBHOOK_SECRET", "PFORGE_CLAW_GH_TOKEN", "PFORGE_CLAW_COPILOT_TOKEN"]) {
      expect(env.find((entry) => entry.name === name).valueFrom.secretKeyRef.optional).toBe(true);
    }
    expect(podSpec.securityContext).toMatchObject({
      runAsUser: 10001,
      runAsGroup: 10001,
      fsGroup: 10001,
      seccompProfile: { type: "RuntimeDefault" },
    });
    expect(container).toMatchObject({
      image: "pforge-claw-dispatcher:placeholder",
      ports: [{ name: "http", containerPort: 3190 }],
      securityContext: {
        runAsNonRoot: true,
        allowPrivilegeEscalation: false,
        readOnlyRootFilesystem: true,
        capabilities: { drop: ["ALL"] },
      },
    });
    expect(container.livenessProbe.httpGet).toMatchObject({ path: "/healthz", port: "http" });
    expect(container.readinessProbe.httpGet).toMatchObject({ path: "/readyz", port: "http" });
    expect(container.resources.requests).toBeTruthy();
    expect(container.resources.limits).toBeTruthy();
  });

  it.each([
    ["replicas", (documents) => {
      getDeployment(documents).spec.replicas = 2;
      return INVARIANT_CHECKERS.deploymentShape;
    }],
    ["RollingUpdate", (documents) => {
      getDeployment(documents).spec.strategy.type = "RollingUpdate";
      return INVARIANT_CHECKERS.deploymentShape;
    }],
    ["wildcard verbs", (documents) => {
      documentsOfKind(documents, "Role")[0].rules[0].verbs = ["*"];
      return INVARIANT_CHECKERS.roleRules;
    }],
    ["pod deletion", (documents) => {
      documentsOfKind(documents, "Role")[0].rules[1].verbs.push("delete");
      return INVARIANT_CHECKERS.roleRules;
    }],
    ["ClusterRole", (documents) => {
      documents.push({ file: "negative-test", doc: { kind: "ClusterRole" } });
      return INVARIANT_CHECKERS.noClusterRoles;
    }],
    ["inline Secret data", (documents) => {
      documents.push({ file: "negative-test", doc: { kind: "Secret", stringData: { token: "placeholder" } } });
      return INVARIANT_CHECKERS.noInlineSecrets;
    }],
    ["runAsNonRoot false", (documents) => {
      getDeployment(documents).spec.template.spec.securityContext.runAsNonRoot = false;
      return INVARIANT_CHECKERS.securityContexts;
    }],
  ])("rejects %s", (_name, mutate) => {
    const documents = structuredClone(loadAll());
    const checker = mutate(documents);
    expect(() => checker(documents)).toThrow();
  });

  it("validates the example configuration with a reachable HTTP bind and polling Telegram", async () => {
    const config = JSON.parse(readFileSync(path.join(OVERLAY_ROOT, "config.json"), "utf8"));
    const result = await validateConfig(config, { mode: "template" });
    expect(result.errors).toEqual([]);
    expect(config.http.bind).not.toBe("127.0.0.1");
    expect(config.channels.telegram.mode).toBe("poll");
  });
});

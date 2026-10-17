import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as policies from "../src/k8s/egress-policy.mjs";
import { PACKAGE_ROOT, writeDevOverlay } from "../scripts/k8s-e2e-overlay.mjs";
import { runK8sE2e } from "../scripts/k8s-e2e.mjs";

const NAMESPACE = "pforge-claw-e2e-api";
const CONTEXT = "kind-api-fixture";
const DISPATCHER_IMAGE = "pforge-claw-k8s-fixture-dispatcher:ci";
const WORKER_IMAGE = "pforge-claw-k8s-fixture-worker:ci";
const ENDPOINT = Object.freeze({ address: "192.0.2.10", port: 6443 });
const directories = [];

function endpointResource() {
  return {
    apiVersion: "v1", kind: "Endpoints", metadata: { name: "kubernetes", namespace: "default" },
    subsets: [{ addresses: [{ ip: ENDPOINT.address }], ports: [{ port: ENDPOINT.port, protocol: "TCP" }] }],
  };
}

async function overlay(apiServerEndpoints) {
  const destination = await mkdtemp(path.join(PACKAGE_ROOT, "scripts", ".k8s-api-egress-test-"));
  directories.push(destination);
  return writeDevOverlay({
    namespace: NAMESPACE, context: CONTEXT, destination,
    dispatcherImage: DISPATCHER_IMAGE, workerImage: WORKER_IMAGE, apiServerEndpoints,
  });
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("dispatcher API egress uses exact control-plane backend endpoints", () => {
  it("allows the translated API endpoint port without allowing all outbound 6443 or any worker", () => {
    expect(typeof policies.buildDispatcherApiEgressPolicy).toBe("function");
    const policy = policies.buildDispatcherApiEgressPolicy({
      namespace: NAMESPACE, endpoints: [ENDPOINT, ENDPOINT, { address: "2001:db8::10", port: 7443 }],
    });
    expect(policy.spec.podSelector.matchLabels).toEqual({ app: "pforge-claw", component: "dispatcher" });
    expect(policy.spec.policyTypes).toEqual(["Egress"]);
    expect(policy.spec.egress).toEqual([
      { to: [{ ipBlock: { cidr: "192.0.2.10/32" } }], ports: [{ protocol: "TCP", port: 6443 }] },
      { to: [{ ipBlock: { cidr: "2001:db8::10/128" } }], ports: [{ protocol: "TCP", port: 7443 }] },
    ]);
    expect(JSON.stringify(policy)).not.toContain("0.0.0.0/0");
    expect(JSON.stringify(policy)).not.toContain("pforge-claw/role");
    expect(policy.metadata.namespace).toBe(NAMESPACE);
  });

  it.each([
    { address: "0.0.0.0/0", port: 6443 }, { address: "api.example.test", port: 6443 },
    { address: "192.0.2.10", port: "6443" }, { address: "192.0.2.10", port: 0 },
    { address: "192.0.2.10", port: 65536 }, { address: "2001:db8::10%eth0", port: 6443 },
  ])("rejects malformed or broad endpoint %j without selecting a fallback", (endpoint) => {
    expect(typeof policies.buildDispatcherApiEgressPolicy).toBe("function");
    expect(() => policies.buildDispatcherApiEgressPolicy({ namespace: NAMESPACE, endpoints: [endpoint] }))
      .toThrowError(expect.objectContaining({ code: "K8S_EGRESS_CONFIG_INVALID" }));
  });

  it("adds only the explicit endpoint policy to the isolated overlay and preserves worker default deny", async () => {
    const rendered = await overlay([ENDPOINT]);
    expect(rendered.kustomization.resources).toContain("dispatcher-api-egress.yaml");
    const policy = JSON.parse(await readFile(path.join(rendered.directory, "dispatcher-api-egress.yaml"), "utf8"));
    expect(policy.spec.egress[0]).toEqual({
      to: [{ ipBlock: { cidr: "192.0.2.10/32" } }], ports: [{ protocol: "TCP", port: 6443 }],
    });
    const worker = JSON.parse(await readFile(path.join(rendered.directory, "job-egress.yaml"), "utf8"));
    expect(worker.spec.egress).toEqual([]);
    expect(worker.spec.podSelector.matchLabels["pforge-claw/role"]).toBe("job");
  });
});

describe("the live disposable gate discovers API endpoints before resource creation", () => {
  it("reads only the selected context's Kubernetes endpoint and requires an actual API response before scenario execution", async () => {
    const runner = vi.fn(async (command, args) => {
      if (command !== "kubectl") return "";
      if (args.includes("endpoints")) return JSON.stringify(endpointResource());
      if (args.includes("apply")) {
        const directory = args.at(-1);
        const policy = JSON.parse(await readFile(path.join(directory, "dispatcher-api-egress.yaml"), "utf8"));
        expect(policy.spec.egress[0].ports[0].port).toBe(ENDPOINT.port);
      }
      if (args.includes("-e")) return '{"status":"unconfirmed"}';
      if (args.includes("/app/tests/helpers/k8s-scenario.mjs")) throw new Error("Scenario must not run before API proof");
      return "";
    });
    await expect(runK8sE2e({
      namespace: NAMESPACE, context: CONTEXT, dispatcherImage: DISPATCHER_IMAGE, workerImage: WORKER_IMAGE,
    }, { runner })).rejects.toThrow("K8S_E2E_API_UNCONFIRMED");
    const calls = runner.mock.calls.map(([, args]) => args);
    expect(calls.find((args) => args.includes("endpoints"))).toEqual([
      "--context", CONTEXT, "get", "endpoints", "kubernetes", "-n", "default", "-o", "json",
    ]);
    expect(calls.findIndex((args) => args.includes("endpoints"))).toBeLessThan(
      calls.findIndex((args) => args.includes("create") && args.includes("namespace")),
    );
    expect(calls.some((args) => args.includes("/app/tests/helpers/k8s-scenario.mjs"))).toBe(false);
  });

  it.each(["empty", "wrong-resource", "malformed-port", "too-many"])("stops before creating any resource when endpoint discovery is %s", async (kind) => {
    const resource = endpointResource();
    if (kind === "empty") resource.subsets = [];
    if (kind === "wrong-resource") resource.metadata.name = "unapproved-service";
    if (kind === "malformed-port") resource.subsets[0].ports[0].port = "6443";
    if (kind === "too-many") resource.subsets[0].addresses = Array.from(
      { length: policies.MAX_EGRESS_TARGETS + 1 }, () => ({ ip: ENDPOINT.address }),
    );
    const runner = vi.fn(async (_command, args) => args.includes("endpoints") ? JSON.stringify(resource) : "");
    await expect(runK8sE2e({
      namespace: NAMESPACE, context: CONTEXT, dispatcherImage: DISPATCHER_IMAGE, workerImage: WORKER_IMAGE,
    }, { runner })).rejects.toThrow("K8S_E2E_API_ENDPOINTS_INVALID");
    expect(runner.mock.calls.some(([, args]) => ["create", "apply", "delete"].some((operation) => args.includes(operation))))
      .toBe(false);
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKFLOW = path.join(REPO_ROOT, ".github", "workflows", "pforge-claw.yml");

describe("Guard: cross-platform CI installs required offline toolchains", () => {
  it("provides the pinned Kubernetes client before boundary and unit tests", () => {
    const source = readFileSync(WORKFLOW, "utf8");
    expect(source).toMatch(/uses:\s*azure\/setup-kubectl@v4\s+with:\s+version:\s*['"]v1\.32\.2['"]/);
    expect(source.indexOf("azure/setup-kubectl")).toBeLessThan(source.indexOf("name: Run dependency boundary guards"));
  });

  it("selects supported Bash on macOS instead of running Bash 4 scripts with the system Bash 3", () => {
    const source = readFileSync(WORKFLOW, "utf8");
    expect(source).toContain("name: Install supported Bash on macOS");
    expect(source).toContain("if: runner.os == 'macOS'");
    expect(source).toContain("brew --prefix bash");
    expect(source).toContain("GITHUB_PATH");
  });
});

describe("Guard: Kubernetes CI diagnostics cannot print job credentials", () => {
  it("never describes pods with their literal secret-bearing environment", () => {
    expect(/kubectl\s+describe\s+pod\b/.test(readFileSync(WORKFLOW, "utf8"))).toBe(false);
  });

  describe("Guard: Kubernetes CI validates actual fixture Jobs and canonical history", () => {
    it("pins a compatible kind binary and digest for the containerd 2 node image", () => {
      const source = readFileSync(WORKFLOW, "utf8");
      const action = source.match(/uses:\s*helm\/kind-action@v1\.12\.0[\s\S]*?(?=\n\s+- name:)/)?.[0];
      expect(action).toContain("version: 'v0.27.0'");
      expect(action).toContain("node_image: kindest/node:v1.32.2@sha256:f226345927d7e348497136874b6d207e0b32cc52154ad8323129352923a3142f");
    });

    it("captures the real kind image-import failure before applying any secret-bearing fixture resources", () => {
      const source = readFileSync(WORKFLOW, "utf8");
      const command = "kind load docker-image pforge-claw-k8s-fixture-dispatcher:ci pforge-claw-k8s-fixture-worker:ci --name kind";
      expect(source).toContain(command);
      expect(source.indexOf(command)).toBeLessThan(source.indexOf("name: Run Kubernetes end-to-end tests"));
      expect(source).toContain("name: Load disposable fixture images into kind");
    });

    it.each(["dispatcher", "worker"])("builds the pinned %s fixture target before the lane gate", (target) => {
      const source = readFileSync(WORKFLOW, "utf8");
      const command = `docker build --platform linux/amd64 --file pforge-claw/deploy/Dockerfile.k8s-fixtures --target ${target} --tag pforge-claw-k8s-fixture-${target}:ci .`;
      expect(source.includes(command)).toBe(true);
      expect(source.indexOf(command)).toBeLessThan(source.indexOf("name: Run Kubernetes end-to-end tests"));
    });

    it("passes explicit context, namespace and both fixture images to the paired gate", () => {
      const source = readFileSync(WORKFLOW, "utf8");
      for (const argument of [
        "--context kind-kind",
        "--namespace pforge-claw-e2e-ci",
        "--dispatcher-fixture-image pforge-claw-k8s-fixture-dispatcher:ci",
        "--worker-fixture-image pforge-claw-k8s-fixture-worker:ci",
      ]) expect(source.includes(argument)).toBe(true);
    });

    it("requires positive signed-job, canonical application and cleanup evidence instead of skip output", () => {
      const source = readFileSync(WORKFLOW, "utf8");
      for (const field of [
        "scenarioEvidence", "approvalConsumed", "leaseGrantVerified",
        "oneShot", "applicationAck", "canonicalL2FileCount", "cleanedUp",
      ]) expect(source.includes(field)).toBe(true);
    });

    it("requires an authenticated API response through the exact endpoint policy before accepting kind evidence", () => {
      const source = readFileSync(WORKFLOW, "utf8");
      expect(source).toContain("gate.apiReachability");
      expect(source).toContain('api.status!=="reachable"');
      expect(source).toContain("api.httpStatus!==404");
      expect(source).toContain("api.endpointCount<1");
    });
  });

  it("routes failed-pod JSON through the bounded diagnostics helper", () => {
    const command = /kubectl\s+get\s+pod\s+"\$pod"\s+-n\s+"\$namespace"\s+-o\s+json\s*\|\s*node\s+pforge-claw\/scripts\/k8s-diagnostics\.mjs/;
    expect(command.test(readFileSync(WORKFLOW, "utf8"))).toBe(true);
  });
});

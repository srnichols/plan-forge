import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as crossproject from "../src/crossproject.mjs";
import { APPROVER_ROLES, QUORUM_MODES } from "../src/approvals.mjs";

const proofUrl = new URL("../src/jobs/approval-proof.mjs", import.meta.url);
const crossprojectUrl = new URL("../src/crossproject.mjs", import.meta.url);
const PUBLIC_PROOF_NAMES = Object.freeze([
  "consumedApprovalFor", "approvedChoicesFor", "isDeclaredFanoutChild", "fanoutProofFor",
]);
const ALLOWED_IMPORTS = Object.freeze([
  "node:crypto", "../errors.mjs", "../enums.mjs", "./model.mjs", "./request-identity.mjs",
]);

function proofSource() {
  return readFileSync(proofUrl, "utf8");
}

describe("Guard: approval proof stays in the inner jobs layer", () => {
  it("exists as an independently importable inner module", async () => {
    const proof = await import(proofUrl.href);
    for (const name of PUBLIC_PROOF_NAMES) expect(proof[name]).toBeTypeOf("function");
  });

  it("uses only built-in crypto and inner model, enums, errors and request normalization", () => {
    const source = proofSource().replace(/\/\*[\s\S]*?\*\//g, "");
    const imports = [...source.matchAll(/^\s*import[\s\S]*?\bfrom\s+["']([^"']+)["'];/gm)]
      .map((match) => match[1]);
    expect(imports).toContain("./model.mjs");
    expect(imports).toContain("./request-identity.mjs");
    expect(imports.every((specifier) => ALLOWED_IMPORTS.includes(specifier))).toBe(true);
    expect(source).not.toMatch(/\bimport\s*\(|\brequire\s*\(/);
    expect(source).not.toMatch(/(?:features|handlers|channels|placement|dispatcher|crossproject|runtime)\//);
  });

  it("reads proofs without channel, lifecycle, event, placement or state writes", () => {
    const source = proofSource();
    expect(source).not.toMatch(/\.\s*(?:append|emit|send|edit|writeJsonAtomic)\s*\(/);
    expect(source).not.toMatch(/\b(?:transition|createJob|placeJob|createApprovalService|authorizeJobRequest)\s*\(/);
    expect(source).not.toMatch(/\b(?:bus|logger|setInterval|setTimeout)\b/);
  });

  it("retains crossproject public names as identical reexports instead of cloned validators", async () => {
    const proof = await import(proofUrl.href);
    const source = readFileSync(crossprojectUrl, "utf8");
    expect(source).toContain('from "./jobs/approval-proof.mjs"');
    for (const name of PUBLIC_PROOF_NAMES) {
      expect(crossproject[name]).toBe(proof[name]);
      expect(source).not.toMatch(new RegExp(`(?:export\\s+)?function\\s+${name}\\s*\\(`));
    }
    expect(source).not.toMatch(/\bfunction\s+(?:validConsumedProof|consumedInTime|sameApprovalSubject)\s*\(/);
  });

  it("reuses one pure general visibility predicate without changing visibleProjects", async () => {
    const proof = await import(proofUrl.href);
    const projects = [
      { id: "alpha" }, { id: "beta", visibility: "normal" }, { id: "restricted", visibility: "restricted" },
    ];
    expect(projects.filter(proof.isGeneralProjectVisible).map((project) => project.id)).toEqual(["alpha", "beta"]);
    expect(crossproject.visibleProjects({ config: { projects }, scope: "general" }))
      .toEqual(projects.filter(proof.isGeneralProjectVisible));
    expect(readFileSync(crossprojectUrl, "utf8")).toContain("projects.filter(isGeneralProjectVisible)");
  });

  it("preserves the existing approval role and selected quorum sets exactly", async () => {
    const proof = await import(proofUrl.href);
    expect(proof.APPROVER_ROLES).toBe(APPROVER_ROLES);
    expect(proof.QUORUM_MODES).toBe(QUORUM_MODES);
    expect(Object.isFrozen(proof.APPROVER_ROLES)).toBe(true);
    expect(Object.isFrozen(proof.QUORUM_MODES)).toBe(true);
  });

  it("resolves current configured identity without trusting role provenance", async () => {
    const proof = await import(proofUrl.href);
    const config = { allowlist: [{ channel: "telegram", userId: 42, role: "owner" }] };
    expect(proof.approvalRoleFor(config, "42")).toBe("owner");
    expect(proof.approvalRoleFor(config, "42", "another-adapter")).toBeUndefined();
    config.allowlist[0].role = "viewer";
    expect(proof.approvalRoleFor(config, "42", "telegram")).toBe("viewer");
    expect(proof.approvalRoleFor(config, null)).toBeUndefined();
  });

  it("distinguishes scheduled request provenance from current caller authority without widening other channels", async () => {
    const proof = await import(proofUrl.href);
    const owner = { channel: "telegram", userId: 42, role: "owner" };
    const config = { allowlist: [owner, { channel: "telegram", userId: 43, role: "approver" }] };
    const job = { callerId: "42", adapter: "scheduler" };
    expect(proof.currentJobCaller({ config, job })).toBe(owner);
    expect(proof.approvalRoleFor(config, "43", "scheduler")).toBe("approver");
    expect(proof.currentJobCaller({ config, job: { ...job, adapter: "another-adapter" } })).toBeNull();
    owner.role = "approver";
    expect(proof.currentJobCaller({ config, job })).toBeNull();
    expect(proof.currentJobCaller({ config, job: { ...job, adapter: "telegram" } })).toBe(owner);
    owner.role = "viewer";
    expect(proof.currentJobCaller({ config, job: { ...job, adapter: "telegram" } })).toBeNull();
  });

  it("retains direct no-parent-walk and immutable family membership call boundaries", () => {
    const source = proofSource();
    const direct = source.slice(source.indexOf("export function consumedApprovalFor"),
      source.indexOf("export function approvedChoicesFor"));
    const family = source.slice(source.indexOf("export function fanoutProofFor"));
    expect(direct).not.toMatch(/\.parentId|fanoutProofFor\s*\(/);
    expect(family).toContain("storedFanoutParentFor(store, parent)");
    expect(family).toContain("declaredFanoutChildren(store, stored)");
    expect(family).toContain("isDeclaredInputChild(stored, children, child)");
    expect(family).toContain("consumedApprovalFor({ store, config, job: stored })");
  });
});

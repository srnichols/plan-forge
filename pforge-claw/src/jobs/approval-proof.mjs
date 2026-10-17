import { createHash } from "node:crypto";
import { APPROVER_ROLES, QUORUM_MODES, ROLES, SCHEDULE_REQUEST_ADAPTER, VISIBILITY } from "../enums.mjs";
import { ClawError } from "../errors.mjs";
import { currentJobs, JOBS_STREAM } from "./model.mjs";
import { normalizeRequestFields } from "./request-identity.mjs";

/**
 * @typedef {{projectId:string,childId:string,branch:string}} FanoutTarget
 * @typedef {{
 *   id:string,type:string,projectId:string,parentId:string|null,state:string,
 *   task:string,description:string,approvalDigest:string,targets:FanoutTarget[],
 *   callerId:string,callerRole:string|null,adapter:string|null,updateId:string|null,
 *   chatId:string|null,threadId:string|null
 * }} FanoutParent
 * @typedef {Omit<FanoutParent,"task"|"targets"|"approvalDigest"> & {
 *   mutating:boolean,fanoutParentId:string,targetBranch:string
 * }} FanoutChild
 * @typedef {ReturnType<typeof import("../state/store.mjs").createStore>} ClawStore
 * @typedef {{
 *   allowlist?:Array<{channel:string,userId:string|number,role:string}>,
 *   projects?:Array<{id:string,visibility?:string}>
 * }} ApprovalProofConfig
 * @typedef {{
 *   v:number,kind:string,jobId:string,shortId:string,chatId:string,threadId:string|null,
 *   requesterId:string,nonceHash:string,expiresAt:number,usedAt:number,approverId:string,
 *   decision:string,quorum?:string,ts?:string
 * }} ConsumedApproval
 * @typedef {{
 *   id:string,type:string,projectId:string,parentId?:string|null,callerId?:string,
 *   adapter?:string|null,updateId?:string|null,chatId?:string|null,threadId?:string|null,
 *   quorum?:string
 * }} ApprovalJob
 */

export const FANOUT_MAX_TARGETS = 20;
export const FANOUT_ATTRIBUTION_FIELDS = Object.freeze([
  "callerId", "callerRole", "adapter", "updateId", "chatId", "threadId",
]);
export { APPROVER_ROLES, QUORUM_MODES };

const DEFAULT_APPROVAL_CHANNEL = "telegram";
const APPROVAL_BINDING_FIELDS = Object.freeze([
  "jobId", "shortId", "chatId", "threadId", "requesterId", "nonceHash", "expiresAt",
]);

function identityValue(value) {
  return value === undefined || value === null ? null : String(value);
}

function sameAttribution(parent, child) {
  return FANOUT_ATTRIBUTION_FIELDS.every((field) => identityValue(parent[field]) === identityValue(child[field]));
}

function fanoutDeclaration(parent) {
  return {
    id: parent.id,
    type: parent.type,
    projectId: parent.projectId,
    parentId: parent.parentId ?? null,
    description: parent.description,
    task: parent.task,
    attribution: FANOUT_ATTRIBUTION_FIELDS.map((field) => identityValue(parent[field])),
    targets: parent.targets.map(({ projectId, childId, branch }) => ({ projectId, childId, branch })),
  };
}

/**
 * @param {FanoutParent} parent
 * @returns {string}
 */
export function fanoutDeclarationDigest(parent) {
  return createHash("sha256").update(JSON.stringify(fanoutDeclaration(parent))).digest("hex");
}

function hasUnsignedOverride(job) {
  return Object.hasOwn(job, "runtime") || Object.hasOwn(job, "provider");
}

function validTarget(parentId, target) {
  return target && typeof target.childId === "string" && typeof target.projectId === "string"
    && target.childId !== parentId && target.branch === `claw/${target.childId}`;
}

function validParentShape(parent) {
  if (parent?.type !== "fanout" || parent.projectId !== "general" || parent.parentId !== null) return false;
  return typeof parent.task === "string" && !!parent.task.trim() && !hasUnsignedOverride(parent);
}

/**
 * @param {FanoutParent} parent
 * @returns {boolean}
 */
export function isValidFanoutDeclaration(parent) {
  if (!validParentShape(parent)) return false;
  if (!Array.isArray(parent.targets) || !parent.targets.length || parent.targets.length > FANOUT_MAX_TARGETS) return false;
  const projects = new Set();
  const children = new Set();
  for (const target of parent.targets) {
    if (!validTarget(parent.id, target)) return false;
    projects.add(target.projectId);
    children.add(target.childId);
  }
  return projects.size === parent.targets.length && children.size === parent.targets.length
    && parent.approvalDigest === fanoutDeclarationDigest(parent);
}

function matchesDeclaredChild(parent, target, child) {
  if (!child || hasUnsignedOverride(child)) return false;
  return child.id === target.childId && child.projectId === target.projectId
    && child.type === "task" && child.mutating === true
    && child.parentId === parent.id && child.fanoutParentId === parent.id
    && child.description === parent.task && child.targetBranch === target.branch
    && sameAttribution(parent, child);
}

/**
 * Membership binds declared identifiers, task and requesting provenance, never a role grant.
 * @param {{parent?:FanoutParent,child?:FanoutChild}} options
 * @returns {boolean}
 */
export function isDeclaredFanoutChild({ parent, child } = {}) {
  if (!isValidFanoutDeclaration(parent) || !child) return false;
  const target = parent.targets.find((candidate) => candidate.childId === child.id);
  return !!target && matchesDeclaredChild(parent, target, child);
}

/**
 * @param {ClawStore} store
 * @param {FanoutParent} parent
 * @returns {FanoutChild[]|null}
 */
export function declaredFanoutChildren(store, parent) {
  if (!isValidFanoutDeclaration(parent)) return null;
  const jobs = currentJobs(store);
  const children = [];
  for (const target of parent.targets) {
    const child = jobs[target.childId];
    if (!isDeclaredFanoutChild({ parent, child })) return null;
    children.push(child);
  }
  return children;
}

function configuredIdentity(config, userId, adapter = DEFAULT_APPROVAL_CHANNEL) {
  if (userId === undefined || userId === null) return undefined;
  const channel = adapter === SCHEDULE_REQUEST_ADAPTER ? DEFAULT_APPROVAL_CHANNEL : adapter ?? DEFAULT_APPROVAL_CHANNEL;
  return config?.allowlist?.find((entry) => (
    entry.channel === channel && String(entry.userId) === String(userId)
  ));
}

/**
 * @param {ApprovalProofConfig} config
 * @param {string|number|null|undefined} userId
 * @param {string|null|undefined} adapter
 * @returns {string|undefined}
 */
export function approvalRoleFor(config, userId, adapter = DEFAULT_APPROVAL_CHANNEL) {
  return configuredIdentity(config, userId, adapter)?.role;
}

/**
 * Scheduler is request provenance, not a new authenticated channel or a synthetic owner.
 * @param {{config?:ApprovalProofConfig,job?:ApprovalJob}} options
 * @returns {{channel:string,userId:string|number,role:string}|null}
 */
export function currentJobCaller({ config, job } = {}) {
  const identity = configuredIdentity(config, job?.callerId, job?.adapter);
  if (!APPROVER_ROLES.includes(identity?.role)) return null;
  if (job?.adapter === SCHEDULE_REQUEST_ADAPTER && identity.role !== ROLES[0]) return null;
  return identity;
}

function consumedInTime(record) {
  if (!Number.isFinite(record.usedAt) || !Number.isFinite(record.expiresAt) || record.usedAt >= record.expiresAt) return false;
  return /^[0-9a-f]{64}$/.test(record.nonceHash) && record.usedAt >= 0;
}

function proofMatchesJob(record, job) {
  if (record.jobId !== job.id || identityValue(record.requesterId) !== identityValue(job.callerId)) return false;
  return identityValue(record.chatId) === identityValue(job.chatId)
    && identityValue(record.threadId) === identityValue(job.threadId);
}

function validSelectedQuorum(record, job) {
  if (!Object.hasOwn(record, "quorum")) return true;
  return job.type === "plan" && QUORUM_MODES.includes(record.quorum);
}

function validConsumedProof({ record, issued, job, config }) {
  if (record.kind !== "approval.consumed" || record.decision !== "approve" || !issued) return false;
  if (!APPROVAL_BINDING_FIELDS.every((field) => identityValue(record[field]) === identityValue(issued[field]))) return false;
  if (!consumedInTime(record) || !proofMatchesJob(record, job) || !validSelectedQuorum(record, job)) return false;
  return APPROVER_ROLES.includes(approvalRoleFor(config, record.approverId, job.adapter))
    && currentJobCaller({ config, job }) !== null;
}

function sameApprovalSubject(left, right) {
  if (!left || !right || left.id !== right.id) return false;
  try {
    return JSON.stringify(normalizeRequestFields(left)) === JSON.stringify(normalizeRequestFields(right));
  } catch {
    return false;
  }
}

function storedApprovalJob(store, job) {
  if (!job || typeof job.id !== "string") return null;
  const stored = currentJobs(store)[job.id];
  if (!sameApprovalSubject(stored, job)) return null;
  const original = [...store.read(JOBS_STREAM)].find(({ record }) => (
    record.kind === "job.created" && record.job.id === job.id
  ))?.record.job;
  return sameApprovalSubject(original, stored) ? stored : null;
}

function approvalRecordsByHash(records) {
  const byHash = new Map();
  for (const record of records) {
    if (!record?.nonceHash) continue;
    if (record.kind === "approval.issued") {
      byHash.set(record.nonceHash, record);
      continue;
    }
    if (!["approval.consumed", "approval.expired"].includes(record.kind)) continue;
    const issued = byHash.get(record.nonceHash);
    if (issued) byHash.set(record.nonceHash, { ...issued, ...record });
  }
  return byHash;
}

/**
 * Selects direct historical approval only; parentId never extends the approval subject.
 * Family callers must additionally use fanoutProofFor before inheriting a parent's proof.
 * @param {{store?:ClawStore,config?:ApprovalProofConfig,job?:ApprovalJob}} options
 * @returns {ConsumedApproval|null}
 */
export function consumedApprovalFor({ store, config, job } = {}) {
  if (!store) return null;
  const stored = storedApprovalJob(store, job);
  if (!stored) return null;
  const approvals = [...store.read("approvals")].map(({ record }) => record);
  for (const record of approvalRecordsByHash(approvals).values()) {
    const issued = approvals.find((candidate) => (
      candidate.kind === "approval.issued" && candidate.nonceHash === record.nonceHash
    ));
    if (validConsumedProof({ record, issued, job: stored, config })) return record;
  }
  return null;
}

/**
 * Projects data from validated consumption, not approval authority or submitted job choices.
 * Null means no radio override: retain the immutable stored base, never an incoming copy.
 * Apply before local unsigned execution only; verified signed worker choices are authoritative.
 * Detached inputs need only id/type; durable scope/roles were checked by consumedApprovalFor.
 * @param {{job?:Pick<ApprovalJob,"id"|"type">,approval?:ConsumedApproval|null}} options
 * @returns {{quorum:string|null}}
 */
export function approvedChoicesFor({ job, approval } = {}) {
  if (!job || !approval || approval.kind !== "approval.consumed" || approval.decision !== "approve") {
    return Object.freeze({ quorum: null });
  }
  if (approval.jobId !== job.id) return Object.freeze({ quorum: null });
  if (!validSelectedQuorum(approval, job)) throw new ClawError("APPROVAL_QUORUM_INVALID");
  return Object.freeze({ quorum: approval.quorum ?? null });
}

/**
 * @param {ClawStore} store
 * @param {FanoutParent} parent
 * @returns {FanoutParent|null}
 */
export function storedFanoutParentFor(store, parent) {
  if (!store || !isValidFanoutDeclaration(parent)) return null;
  const stored = currentJobs(store)[parent.id];
  if (!stored || !isValidFanoutDeclaration(stored)
    || fanoutDeclarationDigest(stored) !== fanoutDeclarationDigest(parent)) return null;
  const original = [...store.read(JOBS_STREAM)].find(({ record }) => (
    record.kind === "job.created" && record.job.id === parent.id
  ))?.record.job;
  return original && fanoutDeclarationDigest(original) === parent.approvalDigest ? stored : null;
}

function isDeclaredInputChild(parent, children, child) {
  if (!child) return true;
  return children.some((candidate) => candidate.id === child.id)
    && isDeclaredFanoutChild({ parent, child });
}

/**
 * @param {{visibility?:string}} project
 * @returns {boolean}
 */
export function isGeneralProjectVisible(project) {
  return project.visibility !== VISIBILITY[1];
}

/**
 * Historical proof covers only the immutable declared family; current state never grants authority.
 * @param {{store?:ClawStore,config?:ApprovalProofConfig,parent?:FanoutParent,child?:FanoutChild}} options
 * @returns {ConsumedApproval|null}
 */
export function fanoutProofFor({ store, config, parent, child } = {}) {
  const stored = storedFanoutParentFor(store, parent);
  if (!stored) return null;
  const children = declaredFanoutChildren(store, stored);
  if (!children || !isDeclaredInputChild(stored, children, child)) return null;
  const visible = new Set((config?.projects ?? []).filter(isGeneralProjectVisible).map((project) => String(project.id)));
  if (stored.targets.some((target) => !visible.has(target.projectId))) return null;
  return consumedApprovalFor({ store, config, job: stored });
}

import { lstat } from "node:fs/promises";
import path from "node:path";
import { ClawError } from "../errors.mjs";
import {
  applyDelta, assembleDeltaChunks, encodeDeltaChunks, forwardDelta, resolveForgeHome,
  L2_ERROR_CODES,
} from "../memory/l2-sync.mjs";
import {
  applicationIdentity, collectApplicationChunk, createApplicationTransfer, L2_MAX_CHUNKS, matchesApplicationAck,
} from "./l2-ack.mjs";
import { L2_ACK_ERRORS } from "./messages.mjs";

export const L2_APPLY_READ = "l2.apply";

function validateHome(project, config) {
  const lanes = new Map((config.lanes ?? []).map((lane) => [lane.id, lane]));
  if (!lanes.has(project.homeLane) || !project.repo?.path) throw new ClawError(L2_ERROR_CODES.PATH_REJECTED);
  const home = resolveForgeHome({ project, config });
  if (!lanes.has(home.laneId) || lanes.get(home.laneId).kind === "k8s"
    || (!path.posix.isAbsolute(home.path) && !path.win32.isAbsolute(home.path))) {
    throw new ClawError(L2_ERROR_CODES.PATH_REJECTED);
  }
  const configured = project.repo.forgeHome;
  if (configured && configured.includes(":") && !path.win32.isAbsolute(configured)) {
    const prefix = configured.slice(0, configured.indexOf(":"));
    if (!lanes.has(prefix)) throw new ClawError(L2_ERROR_CODES.PATH_REJECTED);
  }
  return home;
}

function rejectAck(identity, error, signal) {
  return {
    ...identity, ok: false,
    code: signal?.aborted ? L2_ACK_ERRORS.CANCELLED
      : error instanceof ClawError ? error.code : L2_ACK_ERRORS.HOME_UNAVAILABLE,
  };
}

function assertApplicationActive(signal) {
  if (signal?.aborted) throw new ClawError(L2_ACK_ERRORS.CANCELLED);
}

function validateDeltaIdentity(identity, delta) {
  const hash = encodeDeltaChunks({ delta, deltaId: identity.deltaId })[0].sha256Total;
  if (hash !== identity.sha256Total) throw new ClawError(L2_ERROR_CODES.CHECKSUM_MISMATCH);
}

async function validateHomeDirectory(home) {
  try {
    const metadata = await lstat(home.path);
    if (metadata.isSymbolicLink()) throw new ClawError(L2_ERROR_CODES.PATH_REJECTED);
    if (!metadata.isDirectory()) throw new ClawError(L2_ACK_ERRORS.HOME_UNAVAILABLE);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function assembleTransfer(identity, chunks, maxChunks) {
  if (!Array.isArray(chunks) || !chunks.length) throw new ClawError(L2_ERROR_CODES.CHUNK_MISSING);
  if (chunks.length > maxChunks) throw new ClawError(L2_ERROR_CODES.DELTA_TOO_LARGE);
  const transfer = createApplicationTransfer({ ...identity, chunk: chunks[0], maxChunks });
  for (const chunk of chunks) {
    if (chunk?.deltaId !== identity.deltaId || chunk?.sha256Total !== identity.sha256Total) {
      throw new ClawError(L2_ACK_ERRORS.SCOPE);
    }
    collectApplicationChunk(transfer, chunk);
  }
  return assembleDeltaChunks({ chunks: [...transfer.chunks.values()] });
}

/** currentLaneId:null is forwarding-only; receive/read accept optional {signal}, passed to lane.read out-of-band. */
export function createL2Receiver({ config, currentLaneId, directory, maxChunks = L2_MAX_CHUNKS } = {}) {
  const registered = structuredClone(config);
  const isForwardingOnly = currentLaneId === null;
  if (!registered || !Array.isArray(registered.projects) || !Array.isArray(registered.lanes)
    || (!isForwardingOnly && !registered.lanes.some((lane) => lane.id === currentLaneId))
    || !Number.isSafeInteger(maxChunks) || maxChunks < 1 || maxChunks > L2_MAX_CHUNKS) {
    throw new ClawError(L2_ERROR_CODES.MALFORMED);
  }
  const projects = new Map(registered.projects.map((project) => [project.id, project]));
  const homes = new Map([...projects.values()].map((project) => [project.id, validateHome(project, registered)]));

  function projectFor(identity) {
    const project = projects.get(identity.projectId);
    if (!project) throw new ClawError("PROJECT_NOT_FOUND");
    return project;
  }

  async function applyRegistered(identity, delta, signal) {
    assertApplicationActive(signal);
    const project = projectFor(identity);
    const home = homes.get(project.id);
    if (isForwardingOnly || home.laneId !== currentLaneId) throw new ClawError(L2_ACK_ERRORS.SCOPE);
    if (!path.isAbsolute(project.repo.path) || !path.isAbsolute(home.path)) throw new ClawError(L2_ERROR_CODES.PATH_REJECTED);
    const checkout = await lstat(project.repo.path);
    if (!checkout.isDirectory()) throw new ClawError(L2_ACK_ERRORS.HOME_UNAVAILABLE);
    await validateHomeDirectory(home);
    validateDeltaIdentity(identity, delta);
    assertApplicationActive(signal);
    const applied = await applyDelta({ forgeHome: home.path, delta });
    assertApplicationActive(signal);
    return applied.ok === true
      ? { ...identity, ok: true }
      : { ...identity, ok: false, code: L2_ERROR_CODES.CONFLICT };
  }

  async function read(request, { signal } = {}) {
    let identity;
    try {
      identity = applicationIdentity(request?.args ?? {});
      assertApplicationActive(signal);
      if (request.tool !== L2_APPLY_READ || request.projectId !== identity.projectId) throw new ClawError(L2_ACK_ERRORS.SCOPE);
      const project = projectFor(identity);
      const home = homes.get(project.id);
      if (request.args.forgeHome !== undefined
        && (typeof request.args.forgeHome !== "string" || path.relative(home.path, request.args.forgeHome) !== "")) {
        throw new ClawError(L2_ERROR_CODES.PATH_REJECTED);
      }
      return await applyRegistered(identity, request.args.delta, signal);
    } catch (error) {
      return rejectAck(identity ?? {}, error, signal);
    }
  }

  async function receive(transfer, { signal } = {}) {
    let identity;
    try {
      identity = applicationIdentity(transfer ?? {});
      assertApplicationActive(signal);
      const project = projectFor(identity);
      const delta = assembleTransfer(identity, transfer.chunks, maxChunks);
      validateDeltaIdentity(identity, delta);
      const ack = await forwardDelta({
        project, config: registered, delta, currentLaneId,
        applyLocal: () => applyRegistered(identity, delta, signal),
        sendToLane: async (laneId, request) => {
          const lane = directory?.get?.(laneId);
          if (!lane || typeof lane.read !== "function") throw new ClawError(L2_ACK_ERRORS.HOME_UNAVAILABLE);
          return lane.read({
            ...request, projectId: identity.projectId, args: { ...request.args, ...identity },
          }, { signal });
        },
      });
      assertApplicationActive(signal);
      if (!matchesApplicationAck(identity, ack)) throw new ClawError(L2_ACK_ERRORS.UNCONFIRMED);
      return ack;
    } catch (error) {
      return rejectAck(identity ?? {}, error, signal);
    }
  }

  return { receive, read };
}

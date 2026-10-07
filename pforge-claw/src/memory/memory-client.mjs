import { randomUUID } from "node:crypto";

export const MEMORY_ORIGINS = Object.freeze(["trusted", "untrusted"]);
export const MEMORY_STREAMS = Object.freeze({
  local: "memory-local",
  pending: "memory-pending",
  captured: "memory-captured",
  confirm: "memory-confirm",
});
export const MAX_CONTENT = 3500;
export const MAX_TAGS = 10;
export const MAX_TAG_LEN = 40;

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE = /(?:\+?\d[\d(). -]{6,}\d)/g;
const IPV4_RE = /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g;
const USER_ID_RE = /\b(?:user|from|chat)[ _-]?id[:= ]\d{5,}\b/gi;

function cleanSegment(value) {
  return String(value ?? "unknown").replace(/[^A-Za-z0-9._-]/g, "-") || "unknown";
}

function registryProject(registry, projectId, config) {
  return registry?.byId?.(projectId)
    ?? (config?.projects ?? []).find((project) => String(project.id) === String(projectId));
}

function normalizeToolResult(result) {
  if (result?.structuredContent !== undefined) {
    const structured = result.structuredContent;
    if (typeof structured === "string") {
      try {
        return JSON.parse(structured);
      } catch {
        return { text: structured };
      }
    }
    return structured;
  }
  const text = result?.content?.find((entry) => entry?.type === "text")?.text;
  if (typeof text === "string") {
    try {
      return JSON.parse(text);
    } catch {
      return { text };
    }
  }
  return result && typeof result === "object" ? result : {};
}

function latestById(state, record) {
  if (typeof record?.id !== "string") return state;
  state.set(record.id, record);
  return state;
}

function cleanHit(hit, config, secrets) {
  return {
    id: hit?.id ?? hit?.recordRef ?? null,
    project: hit?.project ?? null,
    content: sanitizeRecord({
      config,
      secrets,
      text: hit?.content ?? hit?.snippet ?? hit?.text ?? "",
    }),
    origin: MEMORY_ORIGINS.includes(hit?.origin) ? hit.origin : "untrusted",
    visibility: hit?.visibility === "restricted" ? "restricted" : "normal",
  };
}

function isAllowedHit(hit, allowedProjects) {
  const project = allowedProjects.get(String(hit?.project ?? ""));
  return Boolean(project)
    && project.visibility !== "restricted"
    && hit?.visibility !== "restricted";
}

export function buildSource({ instanceId, lane, ref } = {}) {
  return `pforge-claw/${cleanSegment(instanceId)}/${cleanSegment(lane)}/${cleanSegment(ref)}`;
}

export function buildCreatedBy(config, { userId, role } = {}) {
  const callerId = String(userId ?? "");
  const alias = config?.allowlist?.find((entry) => String(entry.userId) === callerId)?.alias;
  if (typeof alias === "string" && /^[a-z][a-z0-9-]{0,31}$/.test(alias) && alias !== callerId) {
    return `pforge-claw:${alias}`;
  }
  return `pforge-claw:${role ?? "unknown"}`;
}

export function isL3Off(project) {
  return project?.memory?.l3 === "off";
}

export function sanitizeRecord({ config, secrets, text } = {}) {
  let sanitized = typeof secrets?.redact === "function"
    ? secrets.redact(String(text ?? ""))
    : String(text ?? "");
  sanitized = sanitized
    .replace(EMAIL_RE, "«redacted:email»")
    .replace(PHONE_RE, "«redacted:phone»")
    .replace(IPV4_RE, "«redacted:ip»")
    .replace(USER_ID_RE, "«redacted:user-id»");
  for (const entry of config?.allowlist ?? []) {
    const id = String(entry?.userId ?? "");
    if (id) sanitized = sanitized.split(id).join("«redacted:user-id»");
  }
  return sanitized.slice(0, MAX_CONTENT);
}

export function normalizeTags(tags, origin = "trusted") {
  const values = Array.isArray(tags) ? tags : [];
  const normalized = values
    .filter((tag) => typeof tag === "string")
    .map((tag) => tag.toLowerCase().replace(/[^a-z0-9:_-]/g, "").slice(0, MAX_TAG_LEN))
    .filter((tag) => tag && tag !== "pforge-claw" && tag !== "untrusted");
  const mandatory = origin === "untrusted" ? ["pforge-claw", "untrusted"] : ["pforge-claw"];
  return [...new Set(normalized)].slice(0, MAX_TAGS - mandatory.length).concat(mandatory);
}

export function createMemoryClient({
  config = {},
  mcp,
  store,
  secrets,
  registry,
  logger,
  now = Date.now,
  idFactory = randomUUID,
} = {}) {
  function projectFor(projectId) {
    return registryProject(registry, projectId, config);
  }

  async function callProject(projectId, toolName, args) {
    if (!mcp || typeof mcp.call !== "function") throw new Error("MCP_UNAVAILABLE");
    const result = await mcp.call(projectId, toolName, args);
    const normalized = normalizeToolResult(result);
    if (result?.isError || normalized?.ok === false || normalized?.error) {
      throw new Error("MCP_TOOL_FAILED");
    }
    return normalized;
  }

  async function capture(projectId, {
    content,
    type,
    origin = "trusted",
    tags,
    lane,
    ref,
    caller = {},
  } = {}) {
    const project = projectFor(projectId);
    const validOrigin = MEMORY_ORIGINS.includes(origin) ? origin : "trusted";
    const payload = {
      content: sanitizeRecord({ config, secrets, text: content }),
      type: String(type ?? "lesson"),
      project: projectId,
      source: buildSource({ instanceId: config.instanceId, lane, ref }),
      created_by: buildCreatedBy(config, caller),
      origin: validOrigin,
      tags: normalizeTags(tags, validOrigin),
      visibility: project?.visibility === "restricted" ? "restricted" : "normal",
    };
    const id = String(idFactory());

    if (isL3Off(project)) {
      try {
        store.append(MEMORY_STREAMS.local, {
          v: 1,
          id,
          projectId,
          payload,
          localOnly: true,
          _status: "local",
          at: now(),
        });
        return { ok: true, stored: "claw-state", l3: false };
      } catch (error) {
        logger?.warn?.("Local memory could not be stored", { code: error?.code ?? "MEMORY_STATE_FAILED" });
        return { ok: false, code: "MEMORY_STATE_FAILED" };
      }
    }

    try {
      await callProject(projectId, "forge_memory_capture", payload);
      return { ok: true, stored: "project-mcp" };
    } catch (error) {
      try {
        store.append(MEMORY_STREAMS.pending, {
          v: 1,
          id,
          projectId,
          payload,
          _status: "pending",
          at: now(),
        });
        return { ok: false, code: "MEMORY_PENDING" };
      } catch (storeError) {
        logger?.warn?.("Pending memory could not be stored", {
          code: storeError?.code ?? "MEMORY_STATE_FAILED",
        });
        return { ok: false, code: "MEMORY_STATE_FAILED" };
      }
    }
  }

  async function search(projectId, query, { limit = 5 } = {}) {
    try {
      const normalized = await callProject(projectId, "forge_search", {
        query: sanitizeRecord({ config, secrets, text: query }),
        limit,
      });
      return {
        ok: true,
        hits: (Array.isArray(normalized.hits) ? normalized.hits : [])
          .map((hit) => cleanHit(hit, config, secrets)),
      };
    } catch (error) {
      const code = /^[A-Z][A-Z0-9_]{0,63}$/.test(String(error?.code ?? ""))
        ? error.code
        : "MEMORY_SEARCH_FAILED";
      return { ok: false, code, hits: [] };
    }
  }

  async function fanoutSearch(query, { limit = 5 } = {}) {
    const projects = (registry?.all?.() ?? config.projects ?? [])
      .filter((project) => project.visibility !== "restricted");
    const allowedProjects = new Map(projects.map((project) => [String(project.id), project]));
    const results = await Promise.allSettled(projects.map((project) => search(project.id, query, { limit })));
    const hits = [];
    const errors = [];
    results.forEach((result, index) => {
      const projectId = projects[index].id;
      if (result.status === "rejected") {
        errors.push({ projectId, code: "MEMORY_SEARCH_FAILED" });
        return;
      }
      if (!result.value.ok) {
        errors.push({ projectId, code: result.value.code });
        return;
      }
      for (const hit of result.value.hits) {
        if (isAllowedHit(hit, allowedProjects)) hits.push(hit);
      }
    });
    return { hits, errors };
  }

  function pendingCounts() {
    const counts = store.fold(MEMORY_STREAMS.pending, latestById, new Map());
    const byProject = {};
    for (const record of counts.values()) {
      if (record._status !== "pending") continue;
      const projectId = String(record.projectId ?? "");
      byProject[projectId] = (byProject[projectId] ?? 0) + 1;
    }
    const local = store.fold(MEMORY_STREAMS.local, (count, record) => (
      record.localOnly === true ? count + 1 : count
    ), 0);
    return { ...byProject, local };
  }

  return { capture, search, fanoutSearch, pendingCounts };
}

/**
 * Azure AI Foundry quota management for Plan Forge.
 * Phase-FOUNDRY-QUOTA-PREFLIGHT Slice 1.
 *
 * Exports:
 *   getDeploymentQuota  — async REST call to AOAI control-plane; fail-open.
 *   quotaCacheGet / quotaCacheSet — 5-minute in-memory TTL cache.
 *   compareSliceEstimate — synchronous comparator (status/headroomPct/message).
 *
 * @module foundry-quota
 */

// ─── In-memory TTL cache ──────────────────────────────────────────────────────
// Keyed by "${subscriptionId}/${resourceGroup}/${accountName}/${deploymentName}"
// TTL: 5 minutes (operators may resize deployments; stale quota = wrong warnings).

const _cache = new Map();

/**
 * Retrieve a cached quota entry, or null if absent/expired.
 * @param {string} key
 * @returns {object|null}
 */
export function quotaCacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    _cache.delete(key);
    return null;
  }
  return entry.value;
}

/**
 * Store a quota entry with a TTL.
 * @param {string} key
 * @param {object} value
 * @param {number} [ttlMs=300000] - 5 minutes by default
 */
export function quotaCacheSet(key, value, ttlMs = 5 * 60 * 1_000) {
  _cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

// ─── REST quota fetch ──────────────────────────────────────────────────────────

/**
 * Fetch deployment quota from the Azure Cognitive Services control-plane API.
 * Fail-open: returns { ok: false, reason } on any error so callers can proceed.
 *
 * Cache key: `${subscriptionId}/${resourceGroup}/${accountName}/${deploymentName}`
 * Cache TTL: 5 minutes (configurable via ttlMs param).
 *
 * @param {object} opts
 * @param {string} opts.subscriptionId
 * @param {string} opts.resourceGroup
 * @param {string} opts.accountName
 * @param {string} opts.deploymentName
 * @param {object} [opts.credential]  - Token provider with getToken(scope). Optional when cached.
 * @param {number} [opts.ttlMs=300000]
 * @returns {Promise<{ok:true, deploymentName:string, model:string, tpmCapacity:number|null,
 *                    tpmUsage:number|null, ptuCapacity:number|null, ptuUsage:number|null,
 *                    sku:string|null, fetchedAt:string}
 *                  | {ok:false, reason:string}>}
 */
export async function getDeploymentQuota({
  subscriptionId,
  resourceGroup,
  accountName,
  deploymentName,
  credential,
  ttlMs = 5 * 60 * 1_000,
} = {}) {
  if (!subscriptionId || !resourceGroup || !accountName || !deploymentName) {
    return { ok: false, reason: "missing_required_params" };
  }

  const cacheKey = `${subscriptionId}/${resourceGroup}/${accountName}/${deploymentName}`;
  const cached = quotaCacheGet(cacheKey);
  if (cached) return cached;

  // Acquire bearer token from credential (Phase-FOUNDRY-PROVIDER Slice 3 pattern).
  let token;
  try {
    if (!credential) return { ok: false, reason: "no_credential" };
    const tokenResult = await credential.getToken("https://management.azure.com/.default");
    token = tokenResult?.token;
    if (!token) return { ok: false, reason: "no_token" };
  } catch {
    return { ok: false, reason: "token_error" };
  }

  const url =
    `https://management.azure.com/subscriptions/${subscriptionId}` +
    `/resourceGroups/${resourceGroup}` +
    `/providers/Microsoft.CognitiveServices/accounts/${accountName}` +
    `/deployments/${deploymentName}?api-version=2023-05-01`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (res.status === 429) return { ok: false, reason: "rate_limited" };
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "forbidden" };
    if (res.status === 503) return { ok: false, reason: "service_unavailable" };
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };

    const data = await res.json();
    const props = data.properties || {};
    const cap = props.capacity || {};

    const result = {
      ok: true,
      deploymentName: data.name || deploymentName,
      model: props.model?.name ?? "unknown",
      tpmCapacity: typeof cap.deploymentCapacity === "number" ? cap.deploymentCapacity : null,
      tpmUsage: null,   // Usage endpoint is separate; orchestrator may populate via quota usage API
      ptuCapacity: null,
      ptuUsage: null,
      sku: data.sku?.name ?? null,
      fetchedAt: new Date().toISOString(),
    };

    quotaCacheSet(cacheKey, result, ttlMs);
    return result;
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.code === "ABORT_ERR") {
      return { ok: false, reason: "timeout" };
    }
    return { ok: false, reason: "network_error" };
  }
}

// ─── Slice estimate comparator ────────────────────────────────────────────────

/**
 * Compare a slice token estimate against deployment quota.
 *
 * Status thresholds (headroom = remaining TPM after current usage + slice):
 *   safe     ≥ 30% headroom
 *   warning  10–30%
 *   critical < 10%
 *   unknown  quota unavailable or no tpmCapacity
 *
 * @param {object} quota - Output of getDeploymentQuota() (or cached value)
 * @param {object} sliceEstimate - { tokens_in: number, tokens_out: number }
 * @returns {{ status: "safe"|"warning"|"critical"|"unknown", headroomPct: number|null, message: string }}
 */
export function compareSliceEstimate(quota, sliceEstimate) {
  if (!quota || quota.ok === false) {
    const reason = quota?.reason ?? "quota unavailable";
    return { status: "unknown", headroomPct: null, message: `Quota unavailable: ${reason}` };
  }

  const tpmCapacity = quota.tpmCapacity;
  if (!tpmCapacity || tpmCapacity <= 0) {
    return { status: "unknown", headroomPct: null, message: "TPM capacity not reported by control-plane" };
  }

  const tpmUsed = quota.tpmUsage ?? 0;
  const sliceTokens = (sliceEstimate?.tokens_in ?? 0) + (sliceEstimate?.tokens_out ?? 0);
  const headroomTokens = tpmCapacity - tpmUsed - sliceTokens;
  const headroomPct = (headroomTokens / tpmCapacity) * 100;

  let status;
  if (headroomPct >= 30) status = "safe";
  else if (headroomPct >= 10) status = "warning";
  else status = "critical";

  const deployment = quota.deploymentName || "unknown";
  const message =
    `[foundry-quota] ${status} — ${headroomPct.toFixed(1)}% headroom ` +
    `(${deployment}). ` +
    `Cap=${tpmCapacity.toLocaleString()} tpm, ` +
    `used=${tpmUsed.toLocaleString()} tpm, ` +
    `slice est=${sliceTokens.toLocaleString()} tokens.`;

  return { status, headroomPct: Math.round(headroomPct * 10) / 10, message };
}

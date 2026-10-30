/**
 * Plan Forge — GitHub API requests (#446).
 *
 * One place decides which environment variable carries a GitHub token, how a request sends it, and what a
 * rate-limit answer means, so the update check (update-check.mjs) and the update download
 * (update-from-github.mjs) cannot disagree about whether a request was authenticated, or describe the same
 * refusal in two ways.
 *
 * Separation of concerns:
 *   - This module builds headers, sends a request, and reads what a response says about the rate limit.
 *   - Callers own the URL, the timeout (they pass `signal`), how a failure is reported, and what an answer means.
 *   - It never logs, prints or returns the token.
 */

const GITHUB_ACCEPT = "application/vnd.github+json";
const AUTHENTICATED_REQUESTS_PER_HOUR = 5000;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_TOO_MANY_REQUESTS = 429;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
// "HH:MM" is characters 11 to 16 of an ISO 8601 timestamp.
const ISO_TIME_START = 11;
const ISO_TIME_END = 16;

// GITHUB_TOKEN first, then GH_TOKEN, which the GitHub CLI reads. No other variable is ever read, so a token meant
// for something else is never sent to GitHub.
export const GITHUB_TOKEN_ENV_VARS = Object.freeze(["GITHUB_TOKEN", "GH_TOKEN"]);

// A GitHub token is printable ASCII with no space in it. Anything else cannot be one, and sending it makes fetch throw an
// error that quotes the whole header (`Headers.append: "token ghp_..." is an invalid header value`), which prints the token
// in whatever reports the failure. A value like that is no token: the request goes out without one.
const USABLE_TOKEN = /^[\x21-\x7e]+$/;

/**
 * @param {Record<string, unknown>|undefined} env
 * @returns {string|null} the first usable token in GITHUB_TOKEN_ENV_VARS, trimmed, or null. A blank value, or one that
 *   cannot be a token, is skipped for the next variable.
 */
export function resolveGitHubToken(env) {
  for (const name of GITHUB_TOKEN_ENV_VARS) {
    const value = env?.[name];
    if (typeof value !== "string") continue;
    const token = value.trim();
    if (USABLE_TOKEN.test(token)) return token;
  }
  return null;
}

/**
 * The name of a token variable that is set to something when none of them holds a token that can be sent: the value
 * cannot be a token, so it was skipped, and a message can say so instead of telling the user to set what they have set.
 * Only ever a name from GITHUB_TOKEN_ENV_VARS, never the value.
 *
 * @param {Record<string, unknown>|undefined} env
 * @returns {string|null}
 */
export function findUnusableTokenVariable(env) {
  if (resolveGitHubToken(env)) return null;
  return GITHUB_TOKEN_ENV_VARS.find((name) => typeof env?.[name] === "string" && env[name].trim() !== "") ?? null;
}

/** @param {{ userAgent: string, token?: string|null }} options */
export function githubApiHeaders({ userAgent, token = null } = {}) {
  const headers = { accept: GITHUB_ACCEPT, "user-agent": userAgent };
  if (token) headers.authorization = `token ${token}`;
  return headers;
}

function send(url, { fetchImpl, userAgent, token, signal, redirect }) {
  const init = { headers: githubApiHeaders({ userAgent, token }) };
  if (signal) init.signal = signal;
  if (redirect) init.redirect = redirect;
  return fetchImpl(url, init);
}

async function discardBody(res) {
  try { await res?.body?.cancel?.(); } catch { /* the connection is released either way */ }
}

/**
 * GET `url` from the GitHub API with the user's token, when there is one.
 *
 * A token GitHub rejects (401) is repeated once without it: GitHub answers a public endpoint anonymously, so a stale
 * token in the environment must not make a request worse than having none. Both attempts share `signal`, so the
 * caller's timeout covers the pair. A network failure is thrown for the caller to describe.
 *
 * @param {string} url
 * @param {object} options
 * @param {typeof fetch} [options.fetchImpl]
 * @param {Record<string, unknown>} [options.env]
 * @param {string} options.userAgent
 * @param {AbortSignal} [options.signal]
 * @param {RequestRedirect} [options.redirect]
 * @returns {Promise<{ res: Response, authenticated: boolean, tokenRejected: boolean, ignoredTokenVariable: string|null }>}
 *   `ignoredTokenVariable` names a token variable that was set but skipped because its value cannot be a token (never the
 *   value), so the caller can say the request went out without one.
 */
export async function fetchGitHub(url, { fetchImpl = globalThis.fetch, env = process.env, userAgent, signal, redirect } = {}) {
  const token = resolveGitHubToken(env);
  const ignoredTokenVariable = findUnusableTokenVariable(env);
  const first = await send(url, { fetchImpl, userAgent, token, signal, redirect });
  if (!token || first?.status !== HTTP_UNAUTHORIZED) return { res: first, authenticated: Boolean(token), tokenRejected: false, ignoredTokenVariable };
  await discardBody(first);
  const second = await send(url, { fetchImpl, userAgent, token: null, signal, redirect });
  return { res: second, authenticated: false, tokenRejected: true, ignoredTokenVariable };
}

function headerOf(res, name) {
  const value = typeof res?.headers?.get === "function" ? res.headers.get(name) : null;
  return value ?? null;
}

function wholeNumber(value) {
  return typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : null;
}

function epochSecondsToIso(value) {
  const seconds = wholeNumber(value);
  if (!seconds) return null;
  const date = new Date(seconds * MS_PER_SECOND);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * What a response says about a rate limit, or null when it was not one.
 *
 * GitHub refuses a request for its rate with a 403 or a 429. A 429 is always a limit. A 403 is one when it says the
 * quota is spent (x-ratelimit-remaining: 0) or asks the caller to wait (retry-after, which a secondary limit sends); a
 * 403 with neither is a refusal for another reason, such as a token without access.
 *
 * GitHub sends its quota headers on every response, so a secondary limit arrives with a Retry-After and the headers of a
 * request that was not short of quota. `quotaSpent` says whether the hourly quota is what ran out (it is also true when
 * the response says nothing about what is left); the reset time is a time to wait for only then, so it is read only then.
 * A limit that reports quota left and gives no Retry-After is the one GitHub documents as "wait at least one minute".
 *
 * @param {{ status?: number, headers?: { get?: (name: string) => string|null } }|null|undefined} res
 * @returns {{ limit: number|null, resetAt: string|null, retryAfterSeconds: number|null, quotaSpent: boolean }|null}
 */
export function readRateLimit(res) {
  const status = res?.status;
  if (status !== HTTP_FORBIDDEN && status !== HTTP_TOO_MANY_REQUESTS) return null;
  const retryAfter = headerOf(res, "retry-after");
  const remaining = headerOf(res, "x-ratelimit-remaining");
  if (status === HTTP_FORBIDDEN && remaining !== "0" && retryAfter === null) return null;
  const quotaSpent = remaining === null || remaining === "0";
  return {
    limit: wholeNumber(headerOf(res, "x-ratelimit-limit")),
    resetAt: quotaSpent ? epochSecondsToIso(headerOf(res, "x-ratelimit-reset")) : null,
    retryAfterSeconds: wholeNumber(retryAfter),
    quotaSpent,
  };
}

const plural = (count, unit) => `${count} ${unit}${count === 1 ? "" : "s"}`;

function humanDuration(seconds) {
  return seconds < SECONDS_PER_MINUTE ? plural(seconds, "second") : plural(Math.round(seconds / SECONDS_PER_MINUTE), "minute");
}

function resetLabel(resetAt, now) {
  const resetMs = Date.parse(resetAt);
  const secondsLeft = Math.round((resetMs - now) / MS_PER_SECOND);
  const minutesLeft = Math.max(1, Math.round(secondsLeft / SECONDS_PER_MINUTE));
  const left = secondsLeft > 0 ? ` (in about ${plural(minutesLeft, "minute")})` : "";
  return `${new Date(resetMs).toISOString().slice(ISO_TIME_START, ISO_TIME_END)} UTC${left}`;
}

// What was limited, what "try again" waits for, and whether it was the hourly quota (the only limit a token raises).
// GitHub's own order: a Retry-After is the wait to go by; without one, the reset time of a spent quota; and a limit that
// reports quota left with no Retry-After is the secondary limit it documents as "wait at least one minute".
function limitState({ limit, resetAt, retryAfterSeconds, quotaSpent }, now) {
  if (retryAfterSeconds !== null) {
    return { state: `was reached; GitHub asks to wait about ${humanDuration(retryAfterSeconds)}`, later: "after that wait", hourlyQuota: false };
  }
  if (!quotaSpent) {
    return { state: "was reached; GitHub's guidance is to wait at least a minute", later: "after that wait", hourlyQuota: false };
  }
  const rate = limit ? ` (${limit.toLocaleString("en-US")} requests an hour)` : "";
  if (Number.isFinite(Date.parse(resetAt))) return { state: `is used up${rate} until ${resetLabel(resetAt, now)}`, later: "after that time", hourlyQuota: true };
  return { state: `is used up${rate}`, later: "later", hourlyQuota: true };
}

// The end of the sentence for a request that carried no token and ran into the hourly quota: what a token would give, or,
// when a variable was set to a value that cannot be a token, which one and that it was not sent (never the value).
function tokenAdvice({ ignoredTokenVariable, later }) {
  const perHour = `${AUTHENTICATED_REQUESTS_PER_HOUR.toLocaleString("en-US")} requests an hour`;
  if (ignoredTokenVariable) {
    return `${ignoredTokenVariable} is set to a value that cannot be a token (it has a space or a character that is not printable ASCII), so it was not sent. Correct it to raise the limit to ${perHour}, or try again ${later}.`;
  }
  return `Set GITHUB_TOKEN or GH_TOKEN to a GitHub token to raise it to ${perHour}, or try again ${later}.`;
}

// The facts about a limit with the ones a response did not carry filled in: unknown is null, and a quota nothing says is
// left is taken to be the one that ran out.
function withDefaults({ limit, resetAt, retryAfterSeconds, quotaSpent }) {
  return { limit: limit ?? null, resetAt: resetAt ?? null, retryAfterSeconds: retryAfterSeconds ?? null, quotaSpent: quotaSpent ?? true };
}

/**
 * The sentence to show a user whose request GitHub refused for its rate, saying what was limited, until when, and what
 * helps. A token is offered as the cure only when none was accepted and it was the hourly quota that ran out: for a
 * request that already carried one it is no cure, and neither is it for a secondary limit.
 *
 * @param {{ limit?: number|null, resetAt?: string|null, retryAfterSeconds?: number|null, quotaSpent?: boolean, authenticated?: boolean, tokenRejected?: boolean, ignoredTokenVariable?: string|null }} [info]
 * @param {{ now?: number }} [options]
 * @returns {string}
 */
export function describeRateLimit(info = {}, { now = Date.now() } = {}) {
  const { authenticated = false, tokenRejected = false, ignoredTokenVariable = null } = info;
  const { state, later, hourlyQuota } = limitState(withDefaults(info), now);

  if (authenticated) return `GitHub's API rate limit for this token ${state}. Try again ${later}.`;
  if (tokenRejected) {
    return `GitHub rejected the token in GITHUB_TOKEN or GH_TOKEN (it may be expired or revoked), and the rate limit for requests without one ${state}. Replace the token or unset it, or try again ${later}.`;
  }
  if (!hourlyQuota) return `GitHub's API rate limit for this address ${state}. Try again ${later}.`;
  return `GitHub's API rate limit for this address ${state}. ${tokenAdvice({ ignoredTokenVariable, later })}`;
}

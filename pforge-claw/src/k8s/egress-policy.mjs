import { isIP } from "node:net";
import { ClawError } from "../errors.mjs";

export const MAX_EGRESS_TARGETS = 128;
const MAX_PREFIX_BITS = Object.freeze({ 4: 32, 6: 128 });
const MAX_PORT = 65535;
const DNS_LABEL = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;
const JOB_SELECTOR = Object.freeze({
  "app.kubernetes.io/part-of": "pforge-claw",
  "pforge-claw/role": "job",
});
const DISPATCHER_SELECTOR = Object.freeze({ app: "pforge-claw", component: "dispatcher" });

function validateTargets(namespace, targets) {
  if (typeof namespace !== "string" || !DNS_LABEL.test(namespace)
    || !Array.isArray(targets) || targets.length > MAX_EGRESS_TARGETS) throw new ClawError("K8S_EGRESS_CONFIG_INVALID");
}

function prefixFor(parts, bits) {
  const prefix = Number(parts[1] ?? bits);
  if (parts.length > 2 || (parts.length === 2 && !/^[0-9]+$/.test(parts[1]))
    || !Number.isInteger(prefix) || prefix <= 0 || prefix > bits || parts[0].includes("%")) {
    throw new ClawError("K8S_EGRESS_CIDR_INVALID");
  }
  return prefix;
}

function targetCidr(target) {
  if (typeof target !== "string" || !target || target !== target.trim()) throw new ClawError("K8S_EGRESS_TARGET_INVALID");
  const parts = target.split("/");
  const family = isIP(parts[0]);
  if (!family) throw new ClawError("K8S_EGRESS_HOSTNAME_UNSUPPORTED");
  const bits = MAX_PREFIX_BITS[family];
  const prefix = prefixFor(parts, bits);
  return `${parts[0]}/${prefix}`;
}

/**
 * Render a portable, additive policy from explicit IP/CIDR configuration.
 * Hostname/wildcard rules require an operator-enforced FQDN policy or proxy; they never become a public-HTTPS allowance.
 * @param {{namespace: string, allow?: string[]}} options
 * @returns {object}
 */
export function buildJobEgressPolicy({ namespace, allow = [] } = {}) {
  validateTargets(namespace, allow);
  const cidrs = [...new Set(allow.map(targetCidr))];
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: { name: "pforge-claw-jobs-allow-configured", namespace },
    spec: {
      podSelector: { matchLabels: { ...JOB_SELECTOR } },
      policyTypes: ["Egress"],
      egress: cidrs.length ? [{
        to: cidrs.map((cidr) => ({ ipBlock: { cidr } })),
        ports: [{ protocol: "TCP", port: 443 }],
      }] : [],
    },
  };
}

function apiEndpointRule(endpoint) {
  const { address, port } = endpoint ?? {};
  const family = isIP(typeof address === "string" ? address : "");
  if (!family || address.includes("%") || !Number.isInteger(port) || port <= 0 || port > MAX_PORT) {
    throw new ClawError("K8S_EGRESS_CONFIG_INVALID");
  }
  return {
    to: [{ ipBlock: { cidr: `${address}/${MAX_PREFIX_BITS[family]}` } }],
    ports: [{ protocol: "TCP", port }],
  };
}

/**
 * Allow only explicit API backend IP/port pairs for dispatcher pods, including post-service-NAT ports.
 * Empty endpoints add no permission; worker policies and external HTTPS rules are unchanged.
 * @param {{namespace: string, endpoints?: {address: string, port: number}[]}} options
 * @returns {object}
 */
export function buildDispatcherApiEgressPolicy({ namespace, endpoints = [] } = {}) {
  validateTargets(namespace, endpoints);
  const rules = endpoints.map(apiEndpointRule);
  const unique = [...new Map(rules.map((rule) => [JSON.stringify(rule), rule])).values()];
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: { name: "pforge-claw-dispatcher-api", namespace },
    spec: {
      podSelector: { matchLabels: { ...DISPATCHER_SELECTOR } },
      policyTypes: ["Egress"],
      egress: unique,
    },
  };
}

export const CATEGORIES = [
  "leaked-secret",
  "prompt-injection-echo",
  "license-incompatible-paste",
  "eval-exec-introduced",
  "unexpected-network-call",
  "large-binary-dump",
];

export const SEVERITY_ORDER = ["none", "low", "medium", "high", "critical"];

const CATEGORY_SEVERITY = {
  "leaked-secret": "critical",
  "prompt-injection-echo": "high",
  "license-incompatible-paste": "high",
  "eval-exec-introduced": "medium",
  "unexpected-network-call": "low",
  "large-binary-dump": "medium",
};

const SECRET_PATTERNS = [
  { regex: /-----BEGIN[^\n]*PRIVATE KEY-----/, detail: "Private key block detected" },
  { regex: /AKIA[0-9A-Z]{16}/, detail: "AWS access key pattern detected" },
  { regex: /ghp_[A-Za-z0-9]{36}/, detail: "GitHub PAT pattern detected" },
  {
    regex: /(password|secret|api_key|access_token|private_key)\s*[=:]\s*['"][^'"]{16,}['"]/i,
    detail: "Credential assignment detected",
  },
];

const PROMPT_PATTERNS = [
  /ignore (previous|prior|all) instructions/i,
  /\[SYSTEM\]/,
  /\[INST\]/,
  /<\|system\|>/,
  /act as .{0,30}(DAN|jailbreak|without restrictions)/i,
];

const EXEC_PATTERNS = [
  { regex: /\beval\s*\(/, detail: "eval() introduced" },
  { regex: /\bnew Function\s*\(/, detail: "new Function() introduced" },
  { regex: /\bexec\s*\(.*['"`]/, detail: "exec() with string literal detected" },
  { regex: /__import__\s*\(/, detail: "__import__() introduced" },
  { regex: /getattr\s*\(.*__/, detail: "getattr(..., __*) pattern detected" },
];

const NETWORK_PATTERN = /(fetch|axios)\s*\(\s*['"`]https?:\/\/(?!localhost|127\.0\.0\.1|api\.openai|api\.anthropic|api\.github|githubusercontent)/i;
const URL_PATTERN = /new URL\s*\(\s*['"`]https?:\/\/(?!localhost|127\.0\.0\.1|api\.openai|api\.anthropic|api\.github|githubusercontent)/i;
const GPL_MARKER = /(GPL|GNU General Public License|AGPL|LGPL)/i;
const GPL_LICENSE_TEXT = /(This (file|program|software|library) is free software|under the terms of the GNU)/i;

export function maxSeverity(a, b) {
  return SEVERITY_ORDER.indexOf(a) >= SEVERITY_ORDER.indexOf(b) ? a : b;
}

function pushFinding(findings, category, detail) {
  findings.push({ category, severity: CATEGORY_SEVERITY[category], detail });
}

function getAddedLines(lines) {
  return lines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).map((line) => line.slice(1));
}

function isLargeBase64Line(line) {
  if (line.length < 500) return false;
  let base64Count = 0;
  for (const ch of line) {
    if ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9") || ch === "+" || ch === "/" || ch === "=") {
      base64Count += 1;
    }
  }
  return base64Count / line.length >= 0.8;
}

export function classifyDiff(diff, options = {}) {
  const maxLines = Number.isFinite(options.maxLines) ? Math.max(0, Math.floor(options.maxLines)) : 3000;
  const lines = typeof diff === "string" && diff.length > 0 ? diff.split(/\r?\n/) : [];
  const truncated = lines.length > maxLines;
  const limitedLines = truncated ? lines.slice(0, maxLines) : lines;
  const addedLines = getAddedLines(limitedLines);
  const findings = [];
  let severity = "none";
  let sawGplMarker = false;
  let sawGplLicenseText = false;

  for (const line of addedLines) {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.regex.test(line)) {
        pushFinding(findings, "leaked-secret", pattern.detail);
        severity = maxSeverity(severity, CATEGORY_SEVERITY["leaked-secret"]);
      }
    }

    if (PROMPT_PATTERNS.some((pattern) => pattern.test(line))) {
      pushFinding(findings, "prompt-injection-echo", "Prompt-injection echo pattern detected");
      severity = maxSeverity(severity, CATEGORY_SEVERITY["prompt-injection-echo"]);
    }

    for (const pattern of EXEC_PATTERNS) {
      if (pattern.regex.test(line)) {
        pushFinding(findings, "eval-exec-introduced", pattern.detail);
        severity = maxSeverity(severity, CATEGORY_SEVERITY["eval-exec-introduced"]);
      }
    }

    if (GPL_MARKER.test(line)) sawGplMarker = true;
    if (GPL_LICENSE_TEXT.test(line)) sawGplLicenseText = true;

    if (NETWORK_PATTERN.test(line) || URL_PATTERN.test(line)) {
      pushFinding(findings, "unexpected-network-call", "Hardcoded external network call detected");
      severity = maxSeverity(severity, CATEGORY_SEVERITY["unexpected-network-call"]);
    }

    if (isLargeBase64Line(line)) {
      pushFinding(findings, "large-binary-dump", "Large base64-like added line detected");
      severity = maxSeverity(severity, CATEGORY_SEVERITY["large-binary-dump"]);
    }
  }

  if (sawGplMarker && sawGplLicenseText) {
    pushFinding(findings, "license-incompatible-paste", "GPL-family license header detected in added lines");
    severity = maxSeverity(severity, CATEGORY_SEVERITY["license-incompatible-paste"]);
  }

  return {
    severity,
    findings,
    totalAdded: addedLines.length,
    truncated,
  };
}
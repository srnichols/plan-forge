---
description: Security rules for any stack — input validation, injection prevention, authentication and authorization, secrets, dependencies, logging
applyTo: '**'
priority: HIGH
---

# Security Instructions

> Stack-neutral guidance. When a stack preset is installed, its own
> `security.instructions.md` replaces this file with the stack's libraries and patterns.

Every place where data enters the system — HTTP requests, message consumers, file uploads,
CLI arguments, configuration, webhooks — is a trust boundary. These rules apply at all of them.

---

## 1. Validate input at the boundary

- Validate type, length, range, format and allowed values **before** any work, with a schema
  or validation library rather than hand-written checks scattered through the code.
- Reject unknown fields instead of silently ignoring them when the payload drives writes
  (prevents mass assignment / over-posting).
- Validate on the server even when the client already validated.
- Return a structured error (RFC 9457 problem details or the project's error contract) that
  names the invalid field without echoing dangerous input back.

## 2. Never build code or queries from strings

| Sink | Safe pattern | Never |
|------|-------------|-------|
| SQL | Parameterized queries / ORM bindings | String concatenation or interpolation |
| Shell | Argument arrays passed to the process API | A shell command string containing input |
| HTML | Framework auto-escaping; sanitize rich text with an allowlist | Raw HTML insertion of user content |
| File paths | Resolve, then check the result stays inside an allowed root | Joining user input onto a base path unchecked |
| Code | Parsers and allowlists | `eval`, dynamic code loading from input |
| URLs fetched server-side | Allowlisted hosts and schemes; block private and link-local ranges (SSRF) | Fetching any URL a user supplies |

## 3. Authentication and authorization

- Use the platform's or identity provider's standard flows (OIDC, OAuth 2.1, framework auth);
  never invent token formats or password storage.
- Hash passwords with a slow, salted algorithm (Argon2id, scrypt or bcrypt) — never encrypt or plain-hash them.
- Verify every token completely: signature, issuer, audience, expiry and not-before.
- Authorize on the server for every request and every object: check that the caller may perform
  this action **on this record** (prevents IDOR). Deny by default.
- In multi-tenant systems, derive the tenant from the authenticated identity — never from a
  client-supplied header, query string or body — and scope every query by it.
- Rate-limit authentication endpoints and expensive operations.

## 4. Secrets

| Where secrets may live | Where they must never live |
|------------------------|---------------------------|
| Environment variables injected at runtime | Source code, including tests and comments |
| A secret manager (Key Vault, Secrets Manager, Vault) | Committed configuration files |
| CI/CD secret stores | Plan files, logs, error messages, crash reports |

- Rotate any secret that was ever committed — removing it from the latest commit is not enough.
- Give each service its own least-privilege credentials; prefer managed identities over keys.
- Run a secret scanner before every release (for example `forge_secret_scan`).

## 5. Dependencies and supply chain

- Pin versions with a lock file and commit it.
- Run the ecosystem's vulnerability audit in CI and fail on high/critical findings.
- Prefer maintained packages with a clear owner; remove unused dependencies.
- Use official, version-pinned container base images and scan built images.

## 6. Transport, headers and browsers

- HTTPS everywhere; HSTS in production.
- CORS: an explicit allowlist of origins — never reflect the request origin or allow `*` with credentials.
- Cookies that carry sessions: `Secure`, `HttpOnly`, `SameSite`; protect cookie-authenticated
  state-changing requests against CSRF.
- Set a Content-Security-Policy and the standard security headers for web front ends.

## 7. Errors and logging

- Return generic messages for unexpected errors; log the detail server-side with a correlation id.
- Never log secrets, tokens, passwords, full card numbers or other sensitive personal data.
- Log security events (failed logins, authorization denials, privilege changes) so they can be alerted on.

## 8. Files and uploads

- Enforce size limits, check content type by inspecting the content (not only the extension),
  and store uploads outside the web root with generated names.
- Scan uploads for malware when users can share files with each other.

---

## Pre-merge Security Checklist

- [ ] Every new input is validated at the boundary
- [ ] No string-built SQL, shell commands, HTML or file paths from input
- [ ] Every new endpoint authenticates and authorizes per object (and per tenant)
- [ ] No secrets in the diff
- [ ] New dependencies are necessary, maintained and pass the vulnerability audit
- [ ] Errors and logs reveal nothing sensitive

---

## Temper Guards

| Shortcut | Why It Breaks |
|----------|--------------|
| "It's an internal endpoint, it doesn't need auth" | Internal networks get breached and endpoints get exposed by later routing changes. Authenticate everything. |
| "The front end already validates it" | Attackers call the API directly. Server-side validation is the only validation that counts. |
| "I'll move the key to the vault later" | Committed secrets live in git history forever and get copied with every clone. |
| "The ORM makes us safe from injection" | Raw-query escape hatches and dynamic ordering/filtering still inject. Bind every value. |
| "We only check the user is logged in" | Authentication is not authorization. Check access to the specific record. |

## Warning Signs

- A query, command or path assembled with string concatenation or interpolation
- An endpoint without an authentication requirement or an object-level authorization check
- A tenant or user id read from a header, query string or body and trusted
- Catch blocks that swallow exceptions or return internal error details to the caller
- Secrets, tokens or connection strings in code, tests, sample configs or logs

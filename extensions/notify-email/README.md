# notify-email

Email (SMTP) notification adapter for Plan Forge.

## Install

```bash
pforge ext add notify-email
```

## Configuration

Add to `.forge/notifications/config.json`:

```json
{
  "adapters": {
    "email": {
      "enabled": true,
      "smtpHost": "smtp.example.com",
      "smtpPort": 587,
      "smtpUser": "user@example.com",
      "smtpPass": "${env:SMTP_PASSWORD}",
      "from": "forge@example.com",
      "to": "team@example.com"
    }
  },
  "routes": [
    { "when": { "event": "run-completed" }, "via": ["email"] }
  ]
}
```

Set your environment variable:

```bash
export SMTP_PASSWORD="your-smtp-password"
```

## Adapter Contract

This adapter conforms to the [adapter contract](../../pforge-mcp/notifications/adapter-contract.mjs).
Until the full implementation is installed, `send()` throws `ERR_NOT_IMPLEMENTED` and `validate()` returns `{ ok: false, reason: "not-installed" }`.

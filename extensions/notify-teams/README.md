# notify-teams

Microsoft Teams notification adapter for Plan Forge.

## Install

```bash
pforge ext add notify-teams
```

## Configuration

Add to `.forge/notifications/config.json`:

```json
{
  "adapters": {
    "teams": {
      "enabled": true,
      "webhookUrl": "${env:TEAMS_WEBHOOK_URL}"
    }
  },
  "routes": [
    { "when": { "event": "slice-failed", "severity": ">=high" }, "via": ["teams"] }
  ]
}
```

Set your environment variable:

```bash
export TEAMS_WEBHOOK_URL="https://outlook.office.com/webhook/..."
```

## Adapter Contract

This adapter conforms to the [adapter contract](../../pforge-mcp/notifications/adapter-contract.mjs).
Until the full implementation is installed, `send()` throws `ERR_NOT_IMPLEMENTED` and `validate()` returns `{ ok: false, reason: "not-installed" }`.

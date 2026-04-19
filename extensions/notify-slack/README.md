# notify-slack

Slack notification adapter for Plan Forge.

## Install

```bash
pforge ext add notify-slack
```

## Configuration

Add to `.forge/notifications/config.json`:

```json
{
  "adapters": {
    "slack": {
      "enabled": true,
      "webhookUrl": "${env:SLACK_WEBHOOK_URL}"
    }
  },
  "routes": [
    { "when": { "event": "slice-failed", "severity": ">=high" }, "via": ["slack"] }
  ]
}
```

Set your environment variable:

```bash
export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/T.../B.../..."
```

## Adapter Contract

This adapter conforms to the [adapter contract](../../pforge-mcp/notifications/adapter-contract.mjs).
Until the full SDK is installed, `send()` throws `ERR_NOT_IMPLEMENTED` and `validate()` returns `{ ok: false, reason: "not-installed" }`.

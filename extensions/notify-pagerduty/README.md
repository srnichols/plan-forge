# notify-pagerduty

PagerDuty notification adapter for Plan Forge.

## Install

```bash
pforge ext add notify-pagerduty
```

## Configuration

Add to `.forge/notifications/config.json`:

```json
{
  "adapters": {
    "pagerduty": {
      "enabled": true,
      "integrationKey": "${env:PAGERDUTY_INTEGRATION_KEY}"
    }
  },
  "routes": [
    { "when": { "event": "run-aborted", "severity": ">=high" }, "via": ["pagerduty"] }
  ]
}
```

Set your environment variable:

```bash
export PAGERDUTY_INTEGRATION_KEY="your-integration-key"
```

## Adapter Contract

This adapter conforms to the [adapter contract](../../pforge-mcp/notifications/adapter-contract.mjs).
Until the full implementation is installed, `send()` throws `ERR_NOT_IMPLEMENTED` and `validate()` returns `{ ok: false, reason: "not-installed" }`.

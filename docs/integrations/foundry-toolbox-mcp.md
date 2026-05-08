# Foundry Toolbox MCP Integration

> **Applies to**: Plan Forge v2.90.12-dev+  
> **Source**: Phase-FOUNDRY-PROVIDER (enterprise-fleet-readiness.md §11.5.B)

Azure AI Foundry ships a **Toolbox MCP server** that exposes your Foundry project's tools, knowledge bases, and agent endpoints as native MCP operations. This guide shows how to wire it into your VS Code Copilot Chat / Claude / Cursor session alongside Plan Forge's own MCP server.

---

## Prerequisites

- An Azure AI Foundry project with at least one tool or knowledge index
- A Foundry Toolbox endpoint URL (from the Foundry portal → **MCP** tab)
- A Bearer token or Custom Keys connection string for the endpoint

---

## `.vscode/mcp.json` Example

Add a second server block alongside your Plan Forge server:

```json
{
  "mcpServers": {
    "plan-forge": {
      "command": "node",
      "args": ["pforge-mcp/server.mjs"],
      "env": {
        "AZURE_OPENAI_API_KEY": "${env:AZURE_OPENAI_API_KEY}",
        "AZURE_OPENAI_ENDPOINT": "${env:AZURE_OPENAI_ENDPOINT}"
      }
    },
    "foundry-toolbox": {
      "url": "https://<your-project>.services.ai.azure.com/api/projects/<project-id>/mcp/sse",
      "headers": {
        "Authorization": "Bearer ${env:AZURE_FOUNDRY_TOOLBOX_TOKEN}"
      }
    }
  }
}
```

Replace `<your-project>` and `<project-id>` with values from your Foundry portal.

### Custom Keys (API Key) Connection

If your Foundry project uses Custom Keys authentication instead of a Bearer token:

```json
"foundry-toolbox": {
  "url": "https://<your-project>.services.ai.azure.com/api/projects/<project-id>/mcp/sse",
  "headers": {
    "api-key": "${env:AZURE_FOUNDRY_TOOLBOX_KEY}"
  }
}
```

---

## Per-Call Approval Friction

> **Known friction point** (§11.8 #4): Foundry Toolbox MCP tools surface a VS Code approval prompt on every call. This is a VS Code safety feature, not a Foundry limitation.

Mitigations:
- Use the **"Always allow"** option in the VS Code prompt to suppress future approvals for a specific tool
- Set `"approval": "never"` in the server block for trusted internal tools (VS Code Copilot Chat 1.102+):

```json
"foundry-toolbox": {
  "url": "...",
  "headers": { "api-key": "${env:AZURE_FOUNDRY_TOOLBOX_KEY}" },
  "approval": "never"
}
```

Only use `"approval": "never"` for internal, non-production tools. Keep the default for tools that perform writes or access sensitive data.

---

## What Foundry Toolbox Exposes

Typical Foundry Toolbox tools include:

| Tool | Description |
|---|---|
| `search_knowledge_base` | Vector + keyword search over your Foundry-indexed document corpus |
| `invoke_agent` | Call a Foundry Agent (Prompt Flow or AI Agent Service) by name |
| `list_tools` | List all tools registered in the Foundry project |
| `execute_tool` | Run a registered Foundry tool with arbitrary JSON args |

The exact tool list depends on your Foundry project configuration. Run `list_tools` first to discover available operations.

---

## Using Foundry Tools from Forge-Master

Once the Toolbox server is in `.vscode/mcp.json`, Forge-Master can call its tools via the standard `forge_master_ask` interface:

```
forge_master_ask({ message: "Search the knowledge base for 'RBAC patterns'" })
```

Forge-Master routes the intent to the appropriate MCP tool — no extra configuration needed.

---

## See Also

- [`docs/integrations/byo-azure-openai.md`](byo-azure-openai.md) — BYO Azure OpenAI provider setup
- [`docs/observability/foundry-app-insights.md`](../observability/foundry-app-insights.md) — Telemetry to App Insights

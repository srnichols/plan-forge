# Forge-Master Studio (`pforge-master`)

Standalone reasoning package for Plan Forge. Provides the Forge-Master reasoning loop, tool-use bridge, intent router, retrieval layer, provider adapters, approvals subsystem, and the M365-Copilot-style prompt gallery — all exposed via a stdio MCP server for IDE agents and a browser tab in the main Plan Forge dashboard.

## Configuration

- **Zero-key Copilot path** — Forge-Master first tries `githubCopilot`, now backed by `@github/copilot-sdk` from the sibling `pforge-mcp` package. A Copilot subscription plus `gh auth login`, Copilot CLI auth, or `GITHUB_TOKEN` / `GH_TOKEN` / `COPILOT_GITHUB_TOKEN` is enough; no vendor API key is required.
- **Provider fallback** — If the Copilot SDK is unavailable or session startup fails (for example, not signed in or no Copilot plan), Forge-Master falls back to direct API providers in this order: Anthropic, OpenAI, xAI. Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `XAI_API_KEY` to enable those fallbacks.
- **Model selection** — The Copilot SDK default is `claude-sonnet-5.5`. Direct-provider fallback defaults are `claude-sonnet-5.5` (Anthropic), `gpt-6-sol` (OpenAI), `grok-4.7` (xAI). Override via `.forge.json`:
  ```json
  { "forgeMaster": { "reasoningModel": "claude-opus-5.5" } }
  ```
- **Dashboard secrets UI** — Open `localhost:3100/dashboard` → Settings → API Keys to configure tokens without editing files.

See [`docs/COPILOT-VSCODE-GUIDE.md`](../docs/COPILOT-VSCODE-GUIDE.md) for full usage instructions.

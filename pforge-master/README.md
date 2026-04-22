# Forge-Master Studio (`pforge-master`)

Standalone reasoning package for Plan Forge. Provides the Forge-Master reasoning loop, tool-use bridge, intent router, retrieval layer, provider adapters, approvals subsystem, and the M365-Copilot-style prompt gallery — all exposed via a stdio MCP server for IDE agents and a browser tab in the main Plan Forge dashboard.

## Configuration

- **Zero-key setup (recommended)** — Run `gh auth login` once. Forge-Master auto-detects your GitHub token and routes through [GitHub Models](https://models.github.ai/inference) — no API key required for GitHub Copilot subscribers.
- **API key overrides (optional escape hatches)** — Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `XAI_API_KEY` to use premium models directly. These take precedence when `GITHUB_TOKEN` is unavailable.
- **Model selection** — Default model is `gpt-4o-mini` (fast, tool-calling capable). Override via `.forge.json`:
  ```json
  { "forgeMaster": { "providers": { "githubCopilot": { "model": "gpt-4o" } } } }
  ```
- **Dashboard secrets UI** — Open `localhost:3100/dashboard` → Settings → API Keys to configure tokens without editing files.

See [`docs/COPILOT-VSCODE-GUIDE.md`](../docs/COPILOT-VSCODE-GUIDE.md) for full usage instructions.

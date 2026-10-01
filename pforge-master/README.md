# Forge-Master Studio (`pforge-master`)

Standalone reasoning package for Plan Forge. Provides the Forge-Master reasoning loop, tool-use bridge, intent router, retrieval layer, provider adapters, approvals subsystem, and the M365-Copilot-style prompt gallery — all exposed via a stdio MCP server for IDE agents and a browser tab in the main Plan Forge dashboard.

## Configuration

- **Provider keys (required)** — Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `XAI_API_KEY` in the environment. Forge-Master tries them in that order.
- **No more zero-key mode** — The former zero-key path ran through GitHub Models (`models.github.ai`), which GitHub retired on 2026-07-30. A `GITHUB_TOKEN` alone no longer serves models; an explicit `reasoningProvider: "githubCopilot"` fails with a message naming the keys above.
- **Model selection** — Defaults follow the detected key: `claude-sonnet-5.5` (Anthropic), `gpt-6-sol` (OpenAI), `grok-4.7` (xAI). Claude IDs use Copilot's dotted form and are sent to the Anthropic API hyphenated (`claude-sonnet-5-5`). Override via `.forge.json`:
  ```json
  { "forgeMaster": { "reasoningModel": "claude-opus-5.5" } }
  ```
- **Dashboard secrets UI** — Open `localhost:3100/dashboard` → Settings → API Keys to configure tokens without editing files.

See [`docs/COPILOT-VSCODE-GUIDE.md`](../docs/COPILOT-VSCODE-GUIDE.md) for full usage instructions.

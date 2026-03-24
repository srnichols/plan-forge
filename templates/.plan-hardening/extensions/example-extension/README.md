# Example Extension

> This is a starter template for creating your own Plan Hardening extension.

## What This Extension Provides

- **Instructions**: (none yet — add `.instructions.md` files to `instructions/`)
- **Agents**: (none yet — add `.agent.md` files to `agents/`)
- **Prompts**: (none yet — add `.prompt.md` files to `prompts/`)

## How to Use This Template

1. Copy this entire folder and rename it to your extension name
2. Edit `extension.json` with your extension's metadata
3. Add your guardrail files to the appropriate subdirectories
4. Update this README with what your extension provides
5. Distribute to your team

## Installation

```bash
# Manual
cp -r .plan-hardening/extensions/example-extension .plan-hardening/extensions/my-extension

# Or via CLI
pforge ext install .plan-hardening/extensions/my-extension
```

## File Structure

```
example-extension/
├── extension.json    ← metadata (edit this)
├── instructions/     ← add .instructions.md files here
├── agents/           ← add .agent.md files here
├── prompts/          ← add .prompt.md files here
└── README.md         ← this file (update with your docs)
```

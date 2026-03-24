# Extensions

> **Optional**: Extensions let teams share custom reviewers, prompts,
> and instruction files as installable packages.

## Overview

An extension is a folder containing guardrail files that can be
installed into any project using the AI Plan Hardening Pipeline.
No runtime, no dependencies, no build step — just folders you copy.

## Structure

```
.plan-hardening/
└── extensions/
    ├── extensions.json              ← manifest of installed extensions
    └── <extension-name>/
        ├── extension.json           ← metadata (name, version, author)
        ├── instructions/            ← .instructions.md files
        ├── agents/                  ← .agent.md files
        ├── prompts/                 ← .prompt.md files
        └── README.md               ← usage documentation
```

## Extension Manifest (extension.json)

```json
{
  "name": "healthcare-compliance",
  "version": "1.0.0",
  "description": "HIPAA compliance guardrails and reviewer agent",
  "author": "your-org",
  "minTemplateVersion": "1.0.0",
  "files": {
    "instructions": ["hipaa.instructions.md"],
    "agents": ["hipaa-reviewer.agent.md"],
    "prompts": ["hipaa-checklist.prompt.md"]
  }
}
```

## Installing an Extension

### Manual (works everywhere)

1. Copy the extension folder to `.plan-hardening/extensions/<name>/`
2. Copy files from `instructions/` → `.github/instructions/`
3. Copy files from `agents/` → `.github/agents/`
4. Copy files from `prompts/` → `.github/prompts/`

### Using setup script

```powershell
.\setup.ps1 -InstallExtensions
```

### Using CLI (if installed)

```bash
pharden ext install .plan-hardening/extensions/healthcare-compliance
```

## Creating an Extension

1. Create a folder with the extension name
2. Add `extension.json` with metadata
3. Add your `.instructions.md`, `.agent.md`, and/or `.prompt.md` files
4. Add a `README.md` explaining what the extension provides
5. Distribute via GitHub repo, zip file, or any file-sharing method

See `templates/.plan-hardening/extensions/example-extension/` for a starter template.

## Distribution Channels

| Channel | How | Best For |
|---------|-----|----------|
| **GitHub repo** | Clone or download | Open source extensions |
| **Git submodule** | `git submodule add <url> .plan-hardening/extensions/<name>` | Team-shared |
| **Manual copy** | Download and paste | Air-gapped / enterprise |

## Installed Extensions Manifest (extensions.json)

The `extensions.json` file in `.plan-hardening/extensions/` tracks which
extensions are installed. It is updated automatically by the setup script
or CLI, or you can edit it manually.

```json
{
  "description": "Installed Plan Hardening extensions",
  "version": "1.0.0",
  "extensions": [
    {
      "name": "healthcare-compliance",
      "version": "1.0.0",
      "installedDate": "2026-03-23"
    }
  ]
}
```

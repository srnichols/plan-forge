# Extension Publishing Guide

> How to add your extension to the Plan Forge community catalog.

## Prerequisites

- A working Plan Forge extension with `extension.json`
- A public GitHub repository hosting the extension
- MIT license (or compatible open-source license)

## Steps

### 1. Create Your Extension

Follow the format in [docs/EXTENSIONS.md](docs/EXTENSIONS.md):

```
your-extension/
├── extension.json           ← Metadata (name, version, files)
├── instructions/            ← .instructions.md files
├── agents/                  ← .agent.md files
├── prompts/                 ← .prompt.md files
└── README.md                ← Usage documentation
```

### 2. Add a Catalog Entry

Fork `srnichols/plan-forge` and edit `extensions/catalog.json`. Add your extension to the `extensions` object:

```json
"your-extension-id": {
  "name": "Your Extension Name",
  "id": "your-extension-id",
  "description": "One-line description of what it does.",
  "author": "your-github-username",
  "version": "1.0.0",
  "download_url": "https://github.com/you/your-extension/archive/refs/tags/v1.0.0.zip",
  "repository": "https://github.com/you/your-extension",
  "license": "MIT",
  "category": "code",
  "effect": "Read+Write",
  "requires": {
    "planforge_version": ">=1.2.0"
  },
  "provides": {
    "instructions": 2,
    "agents": 1,
    "prompts": 0,
    "skills": 0
  },
  "tags": ["your", "tags", "here"],
  "speckit_compatible": false,
  "verified": false,
  "created_at": "2026-01-01T00:00:00Z",
  "updated_at": "2026-01-01T00:00:00Z"
}
```

### 3. Submit a Pull Request

Open a PR to `srnichols/plan-forge` with:
- Title: `feat(catalog): add <your-extension-name>`
- Only modify `extensions/catalog.json`
- Link to your extension's repo in the PR description

### Categories

| Category | When to Use |
|----------|------------|
| `code` | Reviews, validates, or modifies source code |
| `docs` | Reads, validates, or generates spec/plan artifacts |
| `process` | Orchestrates workflow across phases |
| `integration` | Syncs with external platforms (Jira, Azure DevOps, etc.) |
| `visibility` | Reports on project health or progress |

### Effect

| Effect | Meaning |
|--------|---------|
| `Read-only` | Produces reports without modifying files |
| `Read+Write` | Modifies files, creates artifacts, or updates specs |

### Spec Kit Compatibility

If your extension also works as a Spec Kit extension, set `"speckit_compatible": true`. This helps users who use both tools discover shared extensions.

When `speckit_compatible` is `true`, `pforge ext publish` also outputs a **Spec Kit Catalog Entry** you can add to your Spec Kit `extensions.json`:

```json
{
  "name": "your-extension-id",
  "version": "1.0.0",
  "description": "One-line description of what it does.",
  "files": {
    "rules": ["instructions/my-rules.instructions.md"],
    "agents": ["agents/my-agent.agent.md"]
  }
}
```

The `rules` array maps from your extension's `files.instructions` list, and `agents` maps from `files.agents`. Add this entry to the `extensions.json` in your Spec Kit project alongside the Plan Forge catalog entry.

### Verification

Extensions submitted by the Plan Forge maintainers are marked `"verified": true`. Community extensions start as `"verified": false` — maintainers may verify after review.

### Skill Contributions

If your extension includes skills (`"skills": N` in `provides`), each SKILL.md must follow the [Skill Blueprint](../docs/SKILL-BLUEPRINT.md) format. Required sections: Frontmatter, Trigger, Steps, Safety Rules, Temper Guards, Warning Signs, Exit Proof, Persistent Memory. Use the checklist at the bottom of the blueprint doc to validate before submitting.

---
description: "Initialize org-specific Azure rules file from the org-rules template."
agent: "agent"
tools: [read, edit, search]
---
# Initialize Org-Specific Azure Rules

Create a populated `org-rules.instructions.md` from the org-rules template, with your organisation's actual values.

## Steps

1. Read `.github/instructions/org-rules.instructions.md.template`
2. Read any existing project files that reveal org standards:
   - `README.md`, `CUSTOMIZATION.md`, existing Bicep/Terraform naming patterns
   - Pipeline YAML for region, subscription, environment hints
3. Ask the user for any values not found in existing files
4. Write the completed `.github/instructions/org-rules.instructions.md`

## Questions to Ask

Before generating, gather:

1. **Tenant ID and primary subscription ID?**
2. **Approved Azure regions?** (influences naming, data residency)
3. **Workload abbreviations?** (team code + workload short names)
4. **Compliance frameworks required?** (ISO 27001, SOC 2, GDPR, HIPAA, PCI-DSS)
5. **Monthly budget per subscription?** (for cost guardrail)
6. **Key contacts?** (platform team, security, finops emails)
7. **Data classification levels used?** (keep default or customise)
8. **Required extra tags?** (beyond CAF mandatory set)

## Rules

- REPLACE every `<!-- ... -->` placeholder — leave none behind
- Do NOT invent values for security-sensitive fields (tenant ID, subscription ID, CIDR ranges) — ask the user
- Keep the frontmatter `applyTo` pattern — it controls auto-load scope
- After writing, confirm with user that values are correct before committing

## Reference Files

- [Template](../instructions/org-rules.instructions.md.template)
- [CAF instructions](../instructions/caf.instructions.md)
- [Naming instructions](../instructions/naming.instructions.md)

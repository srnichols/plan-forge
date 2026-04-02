---
description: "Scaffold a new Terraform module for Azure with variables, locals, outputs, providers, and security defaults."
agent: "agent"
tools: [read, edit, search]
---
# Create New Terraform Module

Scaffold a reusable Terraform module targeting Azure following CAF naming, provider version locking, and security defaults.

## Required Information

Before generating, ask for:
1. **Module purpose** — what Azure resource(s) does this module manage?
2. **Parameters** — what `var` inputs should callers provide?
3. **Is this a root module or a child module?** — root gets `providers.tf` and `versions.tf`
4. **Is this production-bound?** — enables lifecycle protection and stricter networking defaults

## Root Module Template

```hcl
# versions.tf
terraform {
  required_version = ">= 1.7.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
  backend "azurerm" {
    resource_group_name  = "rg-tfstate-prod"
    storage_account_name = "sttfstateprod"
    container_name       = "tfstate"
    key                  = "myapp.{environment}.tfstate"
  }
}

# providers.tf
provider "azurerm" {
  features {}
  use_oidc = true
}
```

```hcl
# variables.tf
variable "environment_name" {
  description = "The environment name (dev, test, staging, prod)."
  type        = string
  validation {
    condition     = contains(["dev", "test", "staging", "prod"], var.environment_name)
    error_message = "environment_name must be dev, test, staging, or prod."
  }
}

variable "workload_name" {
  description = "Short workload name for resource naming (2–8 chars)."
  type        = string
  validation {
    condition     = length(var.workload_name) >= 2 && length(var.workload_name) <= 8
    error_message = "workload_name must be 2–8 characters."
  }
}

variable "location" {
  description = "Azure region for all resources."
  type        = string
  default     = "eastus"
}
```

```hcl
# locals.tf
locals {
  suffix = substr(sha256("${var.workload_name}${var.environment_name}${data.azurerm_subscription.current.id}"), 0, 8)

  resource_group_name = "rg-${var.workload_name}-${var.environment_name}"
  # Add resource-specific names here following CAF abbreviations

  common_tags = {
    Environment = var.environment_name
    Workload    = var.workload_name
    ManagedBy   = "Terraform"
    Repository  = var.repository_url
  }
}
```

```hcl
# main.tf
data "azurerm_subscription" "current" {}

resource "azurerm_resource_group" "this" {
  name     = local.resource_group_name
  location = var.location
  tags     = local.common_tags
}

# TODO: add resource definitions
```

```hcl
# outputs.tf
output "resource_group_name" {
  description = "Name of the resource group."
  value       = azurerm_resource_group.this.name
}
```

## Rules

- ALL variables have `description` fields
- `sensitive = true` on any variable or output containing secrets
- `validation` blocks on `environment_name` and length-constrained variables
- `tags = local.common_tags` (or `merge()`) on every resource
- `for_each` instead of `count` for resource sets
- `lifecycle.prevent_destroy = true` on critical production resources
- No `client_secret` in provider — use `use_oidc = true`
- No secrets or real passwords in `*.tfvars` files committed to source control

## Reference Files

- [Terraform instructions](../instructions/terraform.instructions.md)
- [Naming instructions](../instructions/naming.instructions.md)
- [Security instructions](../instructions/security.instructions.md)

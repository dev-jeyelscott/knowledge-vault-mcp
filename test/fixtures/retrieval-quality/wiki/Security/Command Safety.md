---
title: Command Safety Convention
tags:
  - security
  - commands
type: convention
status: active
---
# Command Safety Convention

## Prohibited Operations

Agents should avoid sudo, force push, destructive reset operations, broad filesystem deletion, and unrelated privileged system changes unless the user explicitly approves a narrowly justified operation.


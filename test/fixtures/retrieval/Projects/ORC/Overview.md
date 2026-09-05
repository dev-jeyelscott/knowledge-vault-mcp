---
title: ORC Orchestration Operations
aliases:
  - ORC Ops
project: ORC
tags:
  - orchestration
  - operations
type: reference
status: active
---
# ORC Orchestration Operations

The ORC knowledge base describes deterministic orchestration state, operator controls, and retrieval behavior.

## Retry Policy

Retry a failed execution only after inspecting the persisted execution result, terminal history, current repository state, and the reason the previous attempt failed. A retry must remain deliberate when the earlier execution may already have changed files or created a commit.

## Retrieval Guidance

Prefer a focused section over loading the entire note when only one operational rule is required.

See [[Runbook]] for recovery procedures.

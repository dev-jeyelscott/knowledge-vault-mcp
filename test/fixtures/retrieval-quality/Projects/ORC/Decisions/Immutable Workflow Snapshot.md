---
title: Immutable Workflow Snapshot Decision
project: ORC
tags:
  - architecture
  - workflow
type: decision
status: accepted
---
# Immutable Workflow Snapshot Decision

## Decision

At run start, load enabled agents in deterministic layer and execution order, then persist one immutable workflow snapshot for the run. Later configuration edits affect future runs only.

## Rationale

A frozen snapshot keeps retries, routing, and audit history explainable even when agent configuration changes after the run starts.


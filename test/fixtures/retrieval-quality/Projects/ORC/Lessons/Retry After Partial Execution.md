---
title: Retry After Partial Execution
project: ORC
tags:
  - retry
  - recovery
type: lesson
status: active
---
# Retry After Partial Execution

## Lesson

After a partial execution, inspect the persisted result, terminal history, and current repository state before retrying. A deliberate retry is required because the previous worker may already have changed files or created a commit.


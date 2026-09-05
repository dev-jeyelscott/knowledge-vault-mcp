#!/usr/bin/env node

import {
  serveStdio,
} from "@modelcontextprotocol/server/stdio";

import {
  createKnowledgeMcpServer,
} from "./mcp-server.js";

import {
  createKnowledgeRetrievalService,
} from "./retrieval.js";

import type {
  KnowledgeRetrievalService,
} from "./retrieval.js";

import type {
  AuthorityPathPolicyOptions,
  RetrievalBudgetOptions,
} from "./retrieval-policy.js";

/** Reads the one required vault root from process configuration. */
function readVaultRoot(): string {
  const value =
    process.env
      .KNOWLEDGE_VAULT_ROOT
      ?.trim();

  if (!value) {
    throw new Error(
      "KNOWLEDGE_VAULT_ROOT is required.",
    );
  }

  return value;
}

/** Parses one optional comma-separated environment list and preserves an explicit empty list as an override. */
function readCommaSeparatedList(
  name: string,
): string[] | undefined {
  const configured =
    process.env[name];

  if (configured === undefined) {
    return undefined;
  }

  return configured
    .split(",")
    .map(
      (value) =>
        value.trim(),
    )
    .filter(Boolean);
}

/** Parses one optional positive integer environment value and fails clearly on malformed configuration. */
function readPositiveInteger(
  name: string,
): number | undefined {
  const configured =
    process.env[name];

  if (configured === undefined) {
    return undefined;
  }

  const value =
    configured.trim();

  if (!/^\d+$/.test(value)) {
    throw new Error(
      `${name} must be a positive integer.`,
    );
  }

  return Number(value);
}

/** Reads permanent protected prefixes separately from authority-tier search rules. */
function readProtectedPrefixes():
  | string[]
  | undefined {
  return readCommaSeparatedList(
    "KNOWLEDGE_VAULT_PROTECTED_PREFIXES",
  );
}

/** Reads optional authority pattern overrides without checking whether their directories currently exist. */
function readAuthorityPolicy():
  AuthorityPathPolicyOptions {
  return {
    tier1Patterns:
      readCommaSeparatedList(
        "KNOWLEDGE_VAULT_AUTHORITY_TIER1_PATTERNS",
      ),

    tier2Patterns:
      readCommaSeparatedList(
        "KNOWLEDGE_VAULT_AUTHORITY_TIER2_PATTERNS",
      ),

    sourcePatterns:
      readCommaSeparatedList(
        "KNOWLEDGE_VAULT_AUTHORITY_SOURCE_PATTERNS",
      ),

    excludedPatterns:
      readCommaSeparatedList(
        "KNOWLEDGE_VAULT_AUTHORITY_EXCLUDED_PATTERNS",
      ),
  };
}

/** Reads optional bounded retrieval limits that are validated again against hard ceilings during service construction. */
function readRetrievalBudgets():
  RetrievalBudgetOptions {
  return {
    defaultSearchLimit:
      readPositiveInteger(
        "KNOWLEDGE_VAULT_DEFAULT_SEARCH_LIMIT",
      ),

    maxSearchResults:
      readPositiveInteger(
        "KNOWLEDGE_VAULT_MAX_SEARCH_RESULTS",
      ),

    searchExcerptChars:
      readPositiveInteger(
        "KNOWLEDGE_VAULT_SEARCH_EXCERPT_CHARS",
      ),

    maxSectionChars:
      readPositiveInteger(
        "KNOWLEDGE_VAULT_MAX_SECTION_CHARS",
      ),

    maxFullNoteChars:
      readPositiveInteger(
        "KNOWLEDGE_VAULT_MAX_FULL_NOTE_CHARS",
      ),

    maxAggregateBytes:
      readPositiveInteger(
        "KNOWLEDGE_VAULT_MAX_PAYLOAD_BYTES",
      ),
  };
}

/** Builds a connection-pinned MCP server factory around one immutable retrieval snapshot. */
function createServerFactory(
  retrieval:
    KnowledgeRetrievalService,
): () => ReturnType<
  typeof createKnowledgeMcpServer
> {
  return () =>
    createKnowledgeMcpServer(
      retrieval,
    );
}

/** Reports out-of-band MCP transport errors exclusively through stderr. */
function reportTransportError(
  error: Error,
): void {
  process.stderr.write(
    `MCP transport error: ${error.message}\n`,
  );
}

/** Reports a fatal startup error exclusively through stderr and sets a failing exit code. */
function reportFatalError(
  error: unknown,
): void {
  process.stderr.write(
    `${
      error instanceof Error
        ? error.message
        : String(error)
    }\n`,
  );

  process.exitCode = 1;
}

/** Loads one configured vault snapshot and exposes its authority-aware bounded read-only retrieval service over MCP stdio. */
async function main(): Promise<void> {
  const retrieval =
    await createKnowledgeRetrievalService({
      vaultRoot:
        readVaultRoot(),

      protectedPrefixes:
        readProtectedPrefixes(),

      authorityPolicy:
        readAuthorityPolicy(),

      budgets:
        readRetrievalBudgets(),
    });

  serveStdio(
    createServerFactory(
      retrieval,
    ),
    {
      onerror:
        reportTransportError,
    },
  );

  process.stderr.write(
    "knowledge-vault-mcp ready on stdio.\n",
  );
}

void main().catch(
  reportFatalError,
);


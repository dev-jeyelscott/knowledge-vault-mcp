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

/** Parses optional comma-separated protected vault-relative prefixes from process configuration. */
function readProtectedPrefixes():
  | string[]
  | undefined {
  const configured =
    process.env
      .KNOWLEDGE_VAULT_PROTECTED_PREFIXES;

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

/** Loads one configured vault snapshot and exposes its read-only retrieval service over MCP stdio. */
async function main(): Promise<void> {
  const retrieval =
    await createKnowledgeRetrievalService({
      vaultRoot:
        readVaultRoot(),

      protectedPrefixes:
        readProtectedPrefixes(),
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

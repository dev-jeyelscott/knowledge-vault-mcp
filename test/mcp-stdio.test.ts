import {
  spawnSync,
} from "node:child_process";

import {
  fileURLToPath,
} from "node:url";

import path from "node:path";

import {
  Client,
} from "@modelcontextprotocol/client";

import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/client/stdio";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  inventoryVault,
} from "../src/parser.js";

import type {
  VaultInventory,
} from "../src/types.js";

const fixtureRoot =
  path.join(
    path.dirname(
      fileURLToPath(
        import.meta.url,
      ),
    ),
    "fixtures",
    "retrieval",
  );

const tsxExecutable =
  path.join(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform ===
      "win32"
      ? "tsx.cmd"
      : "tsx",
  );

/** Converts a read-only inventory into stable path and content-hash evidence for mutation checks. */
function inventoryFingerprint(
  inventory: VaultInventory,
): object {
  return {
    notes:
      inventory.notes.map(
        (note) => ({
          path: note.path,
          hash: note.hash,
        }),
      ),

    assets:
      inventory.assets.map(
        (asset) => ({
          path: asset.path,
          hash: asset.hash,
        }),
      ),

    canvases:
      inventory.canvases.map(
        (canvas) => ({
          path: canvas.path,
          hash: canvas.hash,
        }),
      ),
  };
}

describe(
  "knowledge-vault MCP stdio",
  () => {
    // Verifies the real stdio process lists and calls the four required retrieval tools without modifying the vault.
    it(
      "lists and calls read-only tools over stdio",
      async () => {
        const before =
          await inventoryVault({
            vaultRoot:
              fixtureRoot,
          });

        const transport =
          new StdioClientTransport({
            command:
              tsxExecutable,

            args: [
              "src/mcp-stdio.ts",
            ],

            cwd:
              process.cwd(),

            env: {
              ...getDefaultEnvironment(),

              KNOWLEDGE_VAULT_ROOT:
                fixtureRoot,

              KNOWLEDGE_VAULT_PROTECTED_PREFIXES:
                "raw,evidence",
            },

            stderr: "pipe",
          });

        const client =
          new Client({
            name:
              "knowledge-vault-mcp-test",
            version: "0.1.0",
          });

        try {
          await client.connect(
            transport,
          );

          const {
            tools,
          } =
            await client
              .listTools();

          expect(
            tools
              .map(
                (tool) =>
                  tool.name,
              )
              .sort(),
          ).toEqual([
            "get_note_metadata",
            "get_note_section",
            "get_related_notes",
            "search_knowledge",
          ]);

          const searchResult =
            await client
              .callTool({
                name:
                  "search_knowledge",

                arguments: {
                  query:
                    "orchestration",
                  project:
                    "ORC",
                  limit: 5,
                },
              });

          expect(
            searchResult.isError,
          ).not.toBe(true);

          const searchText =
            searchResult
              .content
              .find(
                (block) =>
                  block.type ===
                  "text",
              );

          if (
            !searchText ||
            searchText.type !==
              "text"
          ) {
            throw new Error(
              "search_knowledge did not return a text content block.",
            );
          }

          const searchPayload =
            JSON.parse(
              searchText.text,
            ) as {
              results:
                Array<{
                  path: string;
                }>;
            };

          expect(
            searchPayload
              .results[0]
              ?.path,
          ).toBe(
            "Projects/ORC/Overview.md",
          );

          const sectionResult =
            await client
              .callTool({
                name:
                  "get_note_section",

                arguments: {
                  path:
                    "Projects/ORC/Overview.md",

                  heading:
                    "Retry Policy",

                  maxChars: 120,
                },
              });

          expect(
            sectionResult.isError,
          ).not.toBe(true);
        } finally {
          await client.close();
        }

        const after =
          await inventoryVault({
            vaultRoot:
              fixtureRoot,
          });

        expect(
          inventoryFingerprint(
            after,
          ),
        ).toEqual(
          inventoryFingerprint(
            before,
          ),
        );
      },
    );

    // Verifies a missing vault configuration fails before protocol startup and writes no stdout log data.
    it(
      "fails cleanly when KNOWLEDGE_VAULT_ROOT is missing",
      () => {
        const result =
          spawnSync(
            tsxExecutable,
            [
              "src/mcp-stdio.ts",
            ],
            {
              cwd:
                process.cwd(),

              env:
                getDefaultEnvironment(),

              encoding:
                "utf8",
            },
          );

        expect(
          result.status,
        ).toBe(1);

        expect(
          result.stdout,
        ).toBe("");

        expect(
          result.stderr,
        ).toContain(
          "KNOWLEDGE_VAULT_ROOT is required",
        );
      },
    );

    // Verifies an invalid configured root fails before serving MCP and keeps stdout protocol-clean.
    it(
      "fails cleanly when the configured vault root does not exist",
      () => {
        const result =
          spawnSync(
            tsxExecutable,
            [
              "src/mcp-stdio.ts",
            ],
            {
              cwd:
                process.cwd(),

              env: {
                ...getDefaultEnvironment(),

                KNOWLEDGE_VAULT_ROOT:
                  path.join(
                    fixtureRoot,
                    "does-not-exist",
                  ),
              },

              encoding:
                "utf8",
            },
          );

        expect(
          result.status,
        ).toBe(1);

        expect(
          result.stdout,
        ).toBe("");

        expect(
          result.stderr.length,
        ).toBeGreaterThan(0);
      },
    );
  },
);

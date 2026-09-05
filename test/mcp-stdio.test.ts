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

/** Builds the real stdio transport with stable defaults and caller-supplied environment overrides. */
function createTestTransport(
  overrides:
    Record<string, string> = {},
): StdioClientTransport {
  return new StdioClientTransport({
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
        "private",

      ...overrides,
    },

    stderr: "pipe",
  });
}

describe(
  "knowledge-vault MCP stdio",
  () => {
    // Verifies the real stdio process lists and calls the four required authority-aware retrieval tools without modifying the vault.
    it(
      "lists and calls read-only tools over stdio",
      async () => {
        const before =
          await inventoryVault({
            vaultRoot:
              fixtureRoot,
          });

        const transport =
          createTestTransport();

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
                  authority: {
                    tier: string;
                  };
                }>;
            };

          expect(
            searchPayload
              .results[0],
          ).toMatchObject({
            path:
              "Projects/ORC/Overview.md",
            authority: {
              tier: "tier1",
            },
          });

          const sourceResult =
            await client
              .callTool({
                name:
                  "search_knowledge",

                arguments: {
                  query:
                    "orchestration",
                  folder: "raw",
                  scope: "source",
                  limit: 5,
                },
              });

          expect(
            sourceResult.isError,
          ).not.toBe(true);

          const sourceText =
            sourceResult
              .content
              .find(
                (block) =>
                  block.type ===
                  "text",
              );

          if (
            !sourceText ||
            sourceText.type !==
              "text"
          ) {
            throw new Error(
              "source search did not return a text content block.",
            );
          }

          const sourcePayload =
            JSON.parse(
              sourceText.text,
            ) as {
              results:
                Array<{
                  path: string;
                  authority: {
                    class: string;
                  };
                }>;
            };

          expect(
            sourcePayload.results[0],
          ).toMatchObject({
            path: "raw/Private.md",
            authority: {
              class: "source",
            },
          });

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

          const sectionText =
            sectionResult
              .content
              .find(
                (block) =>
                  block.type ===
                  "text",
              );

          if (
            !sectionText ||
            sectionText.type !==
              "text"
          ) {
            throw new Error(
              "get_note_section did not return a text content block.",
            );
          }

          expect(
            JSON.parse(
              sectionText.text,
            ),
          ).not.toHaveProperty(
            "approximateTokens",
          );
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

    // Verifies configured search count and excerpt budgets are enforced identically through stdio.
    it(
      "enforces configured payload limits over stdio",
      async () => {
        const transport =
          createTestTransport({
            KNOWLEDGE_VAULT_DEFAULT_SEARCH_LIMIT:
              "1",
            KNOWLEDGE_VAULT_MAX_SEARCH_RESULTS:
              "1",
            KNOWLEDGE_VAULT_SEARCH_EXCERPT_CHARS:
              "40",
            KNOWLEDGE_VAULT_MAX_PAYLOAD_BYTES:
              "16384",
          });

        const client =
          new Client({
            name:
              "knowledge-vault-budget-test",
            version: "0.1.0",
          });

        try {
          await client.connect(
            transport,
          );

          const result =
            await client.callTool({
              name:
                "search_knowledge",
              arguments: {
                query:
                  "orchestration",
              },
            });

          expect(
            result.isError,
          ).not.toBe(true);

          const text =
            result.content.find(
              (block) =>
                block.type === "text",
            );

          if (
            !text ||
            text.type !== "text"
          ) {
            throw new Error(
              "bounded search did not return a text content block.",
            );
          }

          const payload =
            JSON.parse(
              text.text,
            ) as {
              results:
                Array<{
                  evidence:
                    Array<{
                      text: string;
                    }>;
                }>;
            };

          expect(
            payload.results,
          ).toHaveLength(1);

          const excerptChars =
            payload.results[0]
              ?.evidence.reduce(
                (total, item) =>
                  total +
                  item.text.length,
                0,
              ) ?? 0;

          expect(
            excerptChars,
          ).toBeLessThanOrEqual(40);

          expect(
            Buffer.byteLength(
              JSON.stringify(payload),
              "utf8",
            ),
          ).toBeLessThanOrEqual(
            16_384,
          );

          const tooMany =
            await client.callTool({
              name:
                "search_knowledge",
              arguments: {
                query:
                  "orchestration",
                limit: 2,
              },
            });

          expect(
            tooMany.isError,
          ).toBe(true);
        } finally {
          await client.close();
        }
      },
    );

    // Verifies unsafe numeric environment configuration fails before protocol startup and keeps stdout clean.
    it(
      "fails cleanly when a retrieval budget exceeds its hard ceiling",
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
                  fixtureRoot,

                KNOWLEDGE_VAULT_MAX_SEARCH_RESULTS:
                  "26",
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
          result.stderr,
        ).toContain(
          "maxSearchResults must be an integer between 1 and 25",
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


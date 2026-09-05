import {
  McpServer,
} from "@modelcontextprotocol/server";

import * as z from "zod/v4";

import type {
  KnowledgeRetrievalService,
} from "./retrieval.js";

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** Serializes one successful domain result as both MCP text content and structured content. */
function successResult(
  payload: object,
) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          payload,
          null,
          2,
        ),
      },
    ],

    structuredContent:
      payload as Record<
        string,
        unknown
      >,
  };
}

/** Converts a retrieval exception into a visible MCP tool error without writing to stdout directly. */
function errorResult(
  error: unknown,
) {
  return {
    content: [
      {
        type: "text" as const,
        text:
          error instanceof Error
            ? error.message
            : String(error),
      },
    ],
    isError: true,
  };
}

/** Creates one MCP server instance whose handlers only adapt validated protocol inputs to the retrieval service. */
export function createKnowledgeMcpServer(
  retrieval:
    KnowledgeRetrievalService,
): McpServer {
  const server =
    new McpServer({
      name:
        "knowledge-vault-mcp",
      version: "0.1.0",
    });

  server.registerTool(
    "search_knowledge",
    {
      title:
        "Search Knowledge",

      description:
        "Search visible vault notes using deterministic lexical ranking. Returns bounded path, title, score, and concise relevance evidence. Use filters to narrow project, folder scope, tags, type, or status.",

      annotations:
        READ_ONLY_ANNOTATIONS,

      inputSchema:
        z.object({
          query:
            z.string()
              .trim()
              .min(1)
              .max(500),

          project:
            z.string()
              .trim()
              .min(1)
              .max(240)
              .optional(),

          folder:
            z.string()
              .trim()
              .min(1)
              .max(1_024)
              .optional()
              .describe(
                "Vault-relative folder or scope prefix.",
              ),

          tags:
            z.array(
              z.string()
                .trim()
                .min(1)
                .max(240),
            )
              .max(20)
              .optional(),

          type:
            z.string()
              .trim()
              .min(1)
              .max(240)
              .optional(),

          status:
            z.string()
              .trim()
              .min(1)
              .max(240)
              .optional(),

          limit:
            z.number()
              .int()
              .min(1)
              .max(25)
              .optional(),
        }),
    },

    async (input) => {
      try {
        return successResult({
          results:
            retrieval
              .searchKnowledge(
                input,
              ),
        });
      } catch (error) {
        return errorResult(
          error,
        );
      }
    },
  );

  server.registerTool(
    "get_note_metadata",
    {
      title:
        "Get Note Metadata",

      description:
        "Get bounded metadata for one visible note using an exact vault-relative path. Does not return the note body.",

      annotations:
        READ_ONLY_ANNOTATIONS,

      inputSchema:
        z.object({
          path:
            z.string()
              .trim()
              .min(1)
              .max(1_024),
        }),
    },

    async ({ path }) => {
      try {
        return successResult({
          ...retrieval
            .getNoteMetadata(
              path,
            ),
        });
      } catch (error) {
        return errorResult(
          error,
        );
      }
    },
  );

  server.registerTool(
    "get_note_section",
    {
      title:
        "Get Note Section",

      description:
        "Read a bounded Markdown section from one visible note. Prefer a heading. Full-note body retrieval requires an explicit maxChars value.",

      annotations:
        READ_ONLY_ANNOTATIONS,

      inputSchema:
        z.object({
          path:
            z.string()
              .trim()
              .min(1)
              .max(1_024),

          heading:
            z.string()
              .trim()
              .min(1)
              .max(300)
              .optional(),

          maxChars:
            z.number()
              .int()
              .min(1)
              .max(16_000)
              .optional(),
        }).refine(
          (input) =>
            Boolean(
              input.heading,
            ) ||
            input.maxChars !==
              undefined,
          {
            message:
              "maxChars is required when heading is omitted.",
          },
        ),
    },

    async (input) => {
      try {
        return successResult({
          ...retrieval
            .getNoteSection(
              input,
            ),
        });
      } catch (error) {
        return errorResult(
          error,
        );
      }
    },
  );

  server.registerTool(
    "get_related_notes",
    {
      title:
        "Get Related Notes",

      description:
        "Find visible notes connected through resolved vault links. Mutual links rank before outgoing links and backlinks.",

      annotations:
        READ_ONLY_ANNOTATIONS,

      inputSchema:
        z.object({
          path:
            z.string()
              .trim()
              .min(1)
              .max(1_024),

          limit:
            z.number()
              .int()
              .min(1)
              .max(25)
              .optional(),
        }),
    },

    async (input) => {
      try {
        return successResult({
          results:
            retrieval
              .getRelatedNotes(
                input,
              ),
        });
      } catch (error) {
        return errorResult(
          error,
        );
      }
    },
  );

  return server;
}

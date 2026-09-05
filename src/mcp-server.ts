import {
  McpServer,
} from "@modelcontextprotocol/server";

import * as z from "zod/v4";

import {
  HARD_MAX_FULL_NOTE_CHARS,
  HARD_MAX_SEARCH_RESULTS,
} from "./retrieval-policy.js";

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
        "Search the bounded authority-aware vault index using deterministic lexical ranking. Default scope searches Tier 1 curated knowledge only. Use scope=tier2 for Tier 1 plus Tier 2 historical material, or scope=source for approved Tier 3 raw/source evidence. Folder and metadata filters never bypass authority eligibility.",

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
                "Vault-relative folder prefix composed with the requested authority scope.",
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

          scope:
            z.enum([
              "default",
              "tier2",
              "source",
            ])
              .optional()
              .describe(
                "Authority scope. default is Tier 1 only, tier2 is Tier 1 plus Tier 2, source is approved Tier 3 raw/source material only.",
              ),

          limit:
            z.number()
              .int()
              .min(1)
              .max(
                HARD_MAX_SEARCH_RESULTS,
              )
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
        "Get bounded body-free metadata for one exact unprotected vault-relative note path. Exact paths are deliberate reads, including Tier 2 or Tier 3 notes. Permanently protected prefixes remain inaccessible, and returned links are filtered so a lower-tier note cannot expose higher-tier related material.",

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
        "Read one bounded Markdown section from an exact unprotected note path. Prefer heading-addressable reads. Full-note body retrieval remains explicit and requires maxChars. Responses report actual returned characters and UTF-8 bytes, not estimated model tokens.",

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
              .max(
                HARD_MAX_FULL_NOTE_CHARS,
              )
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
        "Find authority-filtered notes connected through resolved vault links. Mutual links rank before outgoing links and backlinks. A Tier 1 note cannot surface Tier 2 or Tier 3 relations through this tool.",

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
              .max(
                HARD_MAX_SEARCH_RESULTS,
              )
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


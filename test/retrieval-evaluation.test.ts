import {
  fileURLToPath,
} from "node:url";

import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createKnowledgeRetrievalService,
} from "../src/retrieval.js";

import {
  DEFAULT_RETRIEVAL_BUDGETS,
} from "../src/retrieval-policy.js";

import type {
  SearchKnowledgeScope,
} from "../src/retrieval-policy.js";

const fixtureRoot =
  path.join(
    path.dirname(
      fileURLToPath(
        import.meta.url,
      ),
    ),
    "fixtures",
    "retrieval-quality",
  );

const retrieval =
  await createKnowledgeRetrievalService({
    vaultRoot:
      fixtureRoot,
  });

interface EvaluationCase {
  name: string;
  query: string;
  scope?: SearchKnowledgeScope;
  expectedPath: string;
  relevantPaths: string[];
  maxRank: number;
  maxIrrelevantResults: number;
  maxIrrelevantRate: number;
}

const evaluationCases:
  EvaluationCase[] = [
    {
      name:
        "architecture decision lookup",
      query:
        "immutable workflow snapshot enabled agents run start",
      expectedPath:
        "Projects/ORC/Decisions/Immutable Workflow Snapshot.md",
      relevantPaths: [
        "Projects/ORC/Decisions/Immutable Workflow Snapshot.md",
        "Projects/ORC/Project Overview.md",
      ],
      maxRank: 2,
      maxIrrelevantResults: 1,
      maxIrrelevantRate: 0.5,
    },
    {
      name:
        "prior implementation lesson",
      query:
        "partial execution retry repository state deliberate",
      expectedPath:
        "Projects/ORC/Lessons/Retry After Partial Execution.md",
      relevantPaths: [
        "Projects/ORC/Lessons/Retry After Partial Execution.md",
      ],
      maxRank: 2,
      maxIrrelevantResults: 2,
      maxIrrelevantRate: 2 / 3,
    },
    {
      name:
        "security convention",
      query:
        "sudo force push destructive reset",
      expectedPath:
        "wiki/Security/Command Safety.md",
      relevantPaths: [
        "wiki/Security/Command Safety.md",
      ],
      maxRank: 1,
      maxIrrelevantResults: 2,
      maxIrrelevantRate: 2 / 3,
    },
    {
      name:
        "debugging history",
      query:
        "stdio protocol malformed result child process regression",
      scope: "tier2",
      expectedPath:
        "Projects/ORC/Reviews/Runtime Debugging History.md",
      relevantPaths: [
        "Projects/ORC/Reviews/Runtime Debugging History.md",
        "wiki/Sources/MCP SDK Notes.md",
      ],
      maxRank: 2,
      maxIrrelevantResults: 1,
      maxIrrelevantRate: 0.5,
    },
    {
      name:
        "project-specific roadmap rationale",
      query:
        "authority tiers payload budgets phase 5 rationale",
      scope: "tier2",
      expectedPath:
        "Projects/ORC/Roadmaps/Phase 5 Retrieval Quality.md",
      relevantPaths: [
        "Projects/ORC/Roadmaps/Phase 5 Retrieval Quality.md",
      ],
      maxRank: 1,
      maxIrrelevantResults: 2,
      maxIrrelevantRate: 2 / 3,
    },
    {
      name:
        "generic framework pattern",
      query:
        "generic layered workflow sequential agents configured order",
      expectedPath:
        "wiki/Patterns/Layered Workflow.md",
      relevantPaths: [
        "wiki/Patterns/Layered Workflow.md",
      ],
      maxRank: 1,
      maxIrrelevantResults: 2,
      maxIrrelevantRate: 2 / 3,
    },
  ];

/** Calculates deterministic irrelevant-result metrics against the explicitly declared fixture expectation. */
function calculateIrrelevance(
  resultPaths: string[],
  relevantPaths: string[],
): {
  count: number;
  rate: number;
} {
  const relevant =
    new Set(relevantPaths);

  const count =
    resultPaths.filter(
      (resultPath) =>
        !relevant.has(
          resultPath,
        ),
    ).length;

  return {
    count,
    rate:
      resultPaths.length === 0
        ? 1
        : count /
          resultPaths.length,
  };
}

/** Measures the same JSON-shaped search payload that the MCP adapter receives from the service boundary. */
function measureSearchPayloadBytes(
  results: ReturnType<
    typeof retrieval.searchKnowledge
  >,
): number {
  return Buffer.byteLength(
    JSON.stringify({
      results,
    }),
    "utf8",
  );
}

describe(
  "retrieval quality evaluation",
  () => {
    for (
      const evaluationCase of
        evaluationCases
    ) {
      // Verifies each deterministic fixture query keeps its expected note within the declared small top-N threshold and payload bounds.
      it(
        evaluationCase.name,
        () => {
          const results =
            retrieval
              .searchKnowledge({
                query:
                  evaluationCase
                    .query,
                scope:
                  evaluationCase
                    .scope,
                limit: 3,
              });

          const resultPaths =
            results.map(
              (result) =>
                result.path,
            );

          const expectedIndex =
            resultPaths.indexOf(
              evaluationCase
                .expectedPath,
            );

          expect(
            expectedIndex,
          ).toBeGreaterThanOrEqual(0);

          expect(
            expectedIndex + 1,
          ).toBeLessThanOrEqual(
            evaluationCase
              .maxRank,
          );

          const irrelevance =
            calculateIrrelevance(
              resultPaths,
              evaluationCase
                .relevantPaths,
            );

          expect(
            irrelevance.count,
          ).toBeLessThanOrEqual(
            evaluationCase
              .maxIrrelevantResults,
          );

          expect(
            irrelevance.rate,
          ).toBeLessThanOrEqual(
            evaluationCase
              .maxIrrelevantRate,
          );

          expect(
            measureSearchPayloadBytes(
              results,
            ),
          ).toBeLessThanOrEqual(
            DEFAULT_RETRIEVAL_BUDGETS
              .maxAggregateBytes,
          );

          for (const result of results) {
            const excerptChars =
              result.evidence.reduce(
                (total, item) =>
                  total +
                  item.text.length,
                0,
              );

            expect(
              excerptChars,
            ).toBeLessThanOrEqual(
              DEFAULT_RETRIEVAL_BUDGETS
                .searchExcerptChars,
            );
          }
        },
      );
    }

    // Verifies roadmap and review history is excluded from default search but becomes eligible with explicit Tier 2 scope.
    it(
      "requires explicit Tier 2 scope for historical material",
      () => {
        const defaultResults =
          retrieval
            .searchKnowledge({
              query:
                "authority tiers payload budgets phase 5 rationale",
              limit: 5,
            });

        expect(
          defaultResults.some(
            (result) =>
              result.path.includes(
                "/Roadmaps/",
              ) ||
              result.path.includes(
                "/Reviews/",
              ),
          ),
        ).toBe(false);

        const tier2Results =
          retrieval
            .searchKnowledge({
              query:
                "authority tiers payload budgets phase 5 rationale",
              scope: "tier2",
              limit: 5,
            });

        expect(
          tier2Results.some(
            (result) =>
              result.path ===
                "Projects/ORC/Roadmaps/Phase 5 Retrieval Quality.md" &&
              result.authority.tier ===
                "tier2",
          ),
        ).toBe(true);
      },
    );

    // Verifies approved raw evidence requires source scope but remains available for an exact bounded section read afterward.
    it(
      "retrieves approved raw evidence only through explicit source intent",
      () => {
        const defaultResults =
          retrieval
            .searchKnowledge({
              query:
                "SIGTERM retry incident partial execution commit",
              limit: 5,
            });

        expect(
          defaultResults.some(
            (result) =>
              result.path.startsWith(
                "raw/",
              ),
          ),
        ).toBe(false);

        const sourceResults =
          retrieval
            .searchKnowledge({
              query:
                "SIGTERM retry incident partial execution commit",
              scope: "source",
              limit: 3,
            });

        expect(
          sourceResults[0],
        ).toMatchObject({
          path:
            "raw/ORC/retry-incident.md",
          authority: {
            tier: "tier3",
            class: "source",
            access:
              "source-searchable",
          },
        });

        const section =
          retrieval
            .getNoteSection({
              path:
                "raw/ORC/retry-incident.md",
              heading:
                "Incident Evidence",
              maxChars: 240,
            });

        expect(
          section.authority.class,
        ).toBe("source");

        expect(
          section.bytesReturned,
        ).toBe(
          Buffer.byteLength(
            section.content,
            "utf8",
          ),
        );
      },
    );

    // Verifies automatic-excluded inbox, generated, log, template, Tasks, and STATE material never enters ordinary or Tier 2 search.
    it(
      "keeps Tier 3 runtime and generated material out of automatic search",
      () => {
        const queries = [
          "immutable workflow snapshot enabled agents run start",
          "stdio protocol malformed result child process regression",
          "generic layered workflow sequential agents configured order",
          "authority tiers payload budgets phase 5 rationale",
        ];

        const forbiddenPrefixes = [
          "Inbox/",
          "generated/",
          "logs/",
          "Templates/",
        ];

        const forbiddenPaths =
          new Set([
            "Projects/ORC/Tasks.md",
            "Projects/ORC/STATE.md",
          ]);

        for (const query of queries) {
          for (
            const scope of [
              "default",
              "tier2",
            ] as const
          ) {
            const results =
              retrieval
                .searchKnowledge({
                  query,
                  scope,
                  limit: 10,
                });

            expect(
              results.some(
                (result) =>
                  forbiddenPrefixes.some(
                    (prefix) =>
                      result.path.startsWith(
                        prefix,
                      ),
                  ) ||
                  forbiddenPaths.has(
                    result.path,
                  ),
              ),
            ).toBe(false);
          }
        }
      },
    );

    // Verifies Tier 1 metadata and related-note responses cannot leak a linked Tier 2 roadmap path.
    it(
      "filters higher-tier backlinks and related notes from Tier 1 reads",
      () => {
        const metadata =
          retrieval
            .getNoteMetadata(
              "Projects/ORC/Project Overview.md",
            );

        expect(
          metadata.outgoingLinks,
        ).toEqual(
          expect.arrayContaining([
            "Projects/ORC/Decisions/Immutable Workflow Snapshot.md",
            "Projects/ORC/Lessons/Retry After Partial Execution.md",
          ]),
        );

        expect(
          metadata.outgoingLinks,
        ).not.toContain(
          "Projects/ORC/Roadmaps/Phase 5 Retrieval Quality.md",
        );

        const related =
          retrieval
            .getRelatedNotes({
              path:
                "Projects/ORC/Project Overview.md",
              limit: 10,
            });

        expect(
          related.some(
            (result) =>
              result.authority.tier !==
                "tier1",
          ),
        ).toBe(false);
      },
    );
  },
);


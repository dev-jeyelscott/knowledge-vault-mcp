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

const retrieval =
  await createKnowledgeRetrievalService({
    vaultRoot:
      fixtureRoot,
  });

const protectedRetrieval =
  await createKnowledgeRetrievalService({
    vaultRoot:
      fixtureRoot,
    protectedPrefixes: [
      "raw",
    ],
  });

describe(
  "KnowledgeRetrievalService",
  () => {
    // Verifies stable lexical ranking and default Tier 1 authority filtering.
    it(
      "returns deterministic Tier 1 ranked search results by default",
      () => {
        const first =
          retrieval
            .searchKnowledge({
              query:
                "orchestration",
              limit: 10,
            });

        const second =
          retrieval
            .searchKnowledge({
              query:
                "orchestration",
              limit: 10,
            });

        expect(
          second,
        ).toEqual(first);

        expect(
          first[0]?.path,
        ).toBe(
          "Projects/ORC/Overview.md",
        );

        expect(
          first.every(
            (result) =>
              result.authority.tier ===
                "tier1" &&
              !result.path.startsWith(
                "raw/",
              ) &&
              !result.path.startsWith(
                "evidence/",
              ),
          ),
        ).toBe(true);

        expect(
          first[0]?.evidence.length,
        ).toBeGreaterThan(0);

        expect(
          first[0]?.metadata,
        ).toMatchObject({
          project: [
            "ORC",
          ],
        });
      },
    );

    // Verifies explicit folder filters cannot bypass default authority eligibility.
    it(
      "does not let a broad folder filter bypass Tier 3 exclusion",
      () => {
        const defaultResults =
          retrieval
            .searchKnowledge({
              query:
                "orchestration",
              folder: "raw",
            });

        expect(
          defaultResults,
        ).toEqual([]);

        const sourceResults =
          retrieval
            .searchKnowledge({
              query:
                "orchestration",
              folder: "raw",
              scope: "source",
            });

        expect(
          sourceResults.map(
            (result) =>
              result.path,
          ),
        ).toEqual([
          "raw/Private.md",
        ]);

        expect(
          sourceResults[0]
            ?.authority,
        ).toEqual({
          tier: "tier3",
          class: "source",
          access:
            "source-searchable",
        });
      },
    );

    // Verifies combined project, folder, tag, type, and status filtering still composes after authority filtering.
    it(
      "applies all supported search filters",
      () => {
        const results =
          retrieval
            .searchKnowledge({
              query:
                "orchestration",
              project: "ORC",
              folder:
                "Projects/ORC",
              tags: [
                "operations",
              ],
              type:
                "reference",
              status:
                "active",
              limit: 5,
            });

        expect(
          results.map(
            (result) =>
              result.path,
          ),
        ).toEqual([
          "Projects/ORC/Overview.md",
        ]);
      },
    );

    // Verifies folder scoping remains vault-relative and deterministic.
    it(
      "supports folder scoped search",
      () => {
        const results =
          retrieval
            .searchKnowledge({
              query:
                "operations",
              folder:
                "Projects/MiseLedger",
            });

        expect(
          results.map(
            (result) =>
              result.path,
          ),
        ).toEqual([
          "Projects/MiseLedger/Overview.md",
        ]);
      },
    );

    // Verifies approved Tier 3 source material is available only through deliberate source search or exact reads.
    it(
      "allows approved raw and evidence notes through explicit source retrieval",
      () => {
        const results =
          retrieval
            .searchKnowledge({
              query:
                "orchestration",
              scope: "source",
            });

        expect(
          results.map(
            (result) =>
              result.path,
          ),
        ).toEqual(
          expect.arrayContaining([
            "evidence/Incident.md",
            "raw/Private.md",
          ]),
        );

        const metadata =
          retrieval
            .getNoteMetadata(
              "raw/Private.md",
            );

        expect(
          metadata.authority,
        ).toEqual({
          tier: "tier3",
          class: "source",
          access:
            "source-searchable",
        });
      },
    );

    // Verifies metadata returns useful relationships without returning note body content.
    it(
      "returns bounded metadata without the note body",
      () => {
        const metadata =
          retrieval
            .getNoteMetadata(
              "Projects/ORC/Overview.md",
            );

        expect(
          metadata.title,
        ).toBe(
          "ORC Orchestration Operations",
        );

        expect(
          metadata.authority.tier,
        ).toBe("tier1");

        expect(
          metadata.tags,
        ).toEqual([
          "operations",
          "orchestration",
        ]);

        expect(
          metadata.outgoingLinks,
        ).toContain(
          "Projects/ORC/Runbook.md",
        );

        expect(
          metadata.backlinks,
        ).toContain(
          "Projects/ORC/Runbook.md",
        );

        expect(
          metadata,
        ).not.toHaveProperty(
          "body",
        );
      },
    );

    // Verifies heading retrieval honors explicit character bounds and reports actual size without a token estimate.
    it(
      "returns bounded heading sections",
      () => {
        const section =
          retrieval
            .getNoteSection({
              path:
                "Projects/ORC/Overview.md",
              heading:
                "Retry Policy",
              maxChars: 100,
            });

        expect(
          section.heading,
        ).toBe(
          "Retry Policy",
        );

        expect(
          section.content.startsWith(
            "## Retry Policy",
          ),
        ).toBe(true);

        expect(
          section.charsReturned,
        ).toBeLessThanOrEqual(
          100,
        );

        expect(
          section.bytesReturned,
        ).toBeGreaterThan(0);

        expect(
          section.truncated,
        ).toBe(true);

        expect(
          section,
        ).not.toHaveProperty(
          "approximateTokens",
        );
      },
    );

    // Verifies full-note retrieval cannot occur without an explicit maximum size.
    it(
      "requires an explicit size limit for full note retrieval",
      () => {
        expect(
          () =>
            retrieval
              .getNoteSection({
                path:
                  "Projects/ORC/Overview.md",
              }),
        ).toThrow(
          "maxChars is required",
        );

        const bounded =
          retrieval
            .getNoteSection({
              path:
                "Projects/ORC/Overview.md",
              maxChars: 60,
            });

        expect(
          bounded.charsReturned,
        ).toBeLessThanOrEqual(
          60,
        );
      },
    );

    // Verifies mutual resolved Tier 1 note links rank before one-way relationships.
    it(
      "returns authority-filtered related notes from the resolved link graph",
      () => {
        const related =
          retrieval
            .getRelatedNotes({
              path:
                "Projects/ORC/Overview.md",
            });

        expect(
          related[0],
        ).toMatchObject({
          path:
            "Projects/ORC/Runbook.md",
          authority: {
            tier: "tier1",
          },
          relationship:
            "mutual",
        });
      },
    );

    // Verifies permanent protected prefixes remain inaccessible even though Tier 3 source paths are otherwise exact-readable.
    it(
      "does not disclose configured protected notes through search or direct reads",
      () => {
        expect(
          protectedRetrieval
            .searchKnowledge({
              query:
                "orchestration",
              scope: "source",
              folder: "raw",
            }),
        ).toEqual([]);

        expect(
          () =>
            protectedRetrieval
              .getNoteMetadata(
                "raw/Private.md",
              ),
        ).toThrow(
          "Note not found",
        );

        expect(
          protectedRetrieval
            .getNoteMetadata(
              "evidence/Incident.md",
            )
            .authority.class,
        ).toBe("source");
      },
    );

    // Verifies configurable count and excerpt budgets are enforced inside the retrieval boundary.
    it(
      "enforces configured search count and excerpt budgets",
      async () => {
        const boundedRetrieval =
          await createKnowledgeRetrievalService({
            vaultRoot:
              fixtureRoot,
            budgets: {
              defaultSearchLimit: 1,
              maxSearchResults: 1,
              searchExcerptChars: 40,
              maxAggregateBytes:
                16_384,
            },
          });

        const results =
          boundedRetrieval
            .searchKnowledge({
              query:
                "orchestration",
            });

        expect(results).toHaveLength(1);

        const excerptChars =
          results[0]
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
          () =>
            boundedRetrieval
              .searchKnowledge({
                query:
                  "orchestration",
                limit: 2,
              }),
        ).toThrow(
          "Limit must be an integer between 1 and 1",
        );
      },
    );

    // Verifies service construction rejects numeric configuration above hard safety ceilings.
    it(
      "rejects unsafe retrieval budget configuration",
      async () => {
        await expect(
          createKnowledgeRetrievalService({
            vaultRoot:
              fixtureRoot,
            budgets: {
              maxSearchResults: 26,
            },
          }),
        ).rejects.toThrow(
          "maxSearchResults must be an integer between 1 and 25",
        );
      },
    );

    // Verifies lexical path traversal is rejected before note lookup.
    it(
      "rejects vault traversal attempts",
      () => {
        expect(
          () =>
            retrieval
              .getNoteMetadata(
                "../outside.md",
              ),
        ).toThrow(
          "vault-relative path",
        );
      },
    );
  },
);


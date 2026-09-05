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

describe(
  "KnowledgeRetrievalService",
  () => {
    // Verifies stable lexical ranking and default protected-path exclusion.
    it(
      "returns deterministic ranked search results without protected notes",
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
      },
    );

    // Verifies combined project, folder, tag, type, and status filtering.
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

    // Verifies heading retrieval honors explicit character bounds and reports truncation.
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
          section.truncated,
        ).toBe(true);

        expect(
          section.approximateTokens,
        ).toBeGreaterThan(0);
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

    // Verifies mutual resolved note links rank before one-way relationships.
    it(
      "returns related notes from the resolved link graph",
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
          relationship:
            "mutual",
        });
      },
    );

    // Verifies protected notes cannot be directly retrieved even when their exact path is known.
    it(
      "does not disclose protected notes through direct reads",
      () => {
        expect(
          () =>
            retrieval
              .getNoteMetadata(
                "raw/Private.md",
              ),
        ).toThrow(
          "Note not found",
        );

        expect(
          () =>
            retrieval
              .getNoteSection({
                path:
                  "evidence/Incident.md",
                maxChars: 100,
              }),
        ).toThrow(
          "Note not found",
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

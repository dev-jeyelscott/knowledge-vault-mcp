import {
  stat,
} from "node:fs/promises";

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
  auditInventory,
} from "../src/audit.js";

import {
  buildCleanupManifest,
} from "../src/manifest.js";

import {
  inventoryVault,
} from "../src/parser.js";

const fixtureRoot = path.join(
  path.dirname(
    fileURLToPath(
      import.meta.url,
    ),
  ),
  "fixtures",
  "basic",
);

describe(
  "read-only vault audit",
  () => {
    it(
      "reports required finding classes with transparent evidence",
      async () => {
        const inventory =
          await inventoryVault({
            vaultRoot:
              fixtureRoot,
          });

        const stateStat =
          await stat(
            path.join(
              fixtureRoot,
              "STATE.md",
            ),
          );

        const now = new Date(
          stateStat.mtimeMs +
            100 *
              86_400_000,
        );

        const report =
          auditInventory(
            inventory,
            {
              now,
              oversizedBytes: 10,
            },
          );

        const kinds = new Set(
          report.findings.map(
            (item) =>
              item.kind,
          ),
        );

        for (const kind of [
          "exact-duplicate",
          "near-duplicate",
          "broken-reference",
          "reference-case-mismatch",
          "orphan-note",
          "orphan-asset",
          "duplicate-index-variant",
          "oversized-note",
          "generated-output-candidate",
          "stale-state-task-candidate",
          "authority-conflict",
        ] as const) {
          expect(
            kinds.has(kind),
          ).toBe(true);
        }

        expect(
          report.findings.some(
            (item) =>
              item.kind ===
                "exact-duplicate" &&
              item.paths.includes(
                "DuplicateA.md",
              ) &&
              item.paths.includes(
                "DuplicateB.md",
              ),
          ),
        ).toBe(true);

        expect(
          report.findings.some(
            (item) =>
              item.kind ===
                "broken-reference" &&
              item.reason.includes(
                "missing.md",
              ),
          ),
        ).toBe(true);

        expect(
          report.findings.some(
            (item) =>
              item.kind ===
                "orphan-asset" &&
              item.paths.includes(
                "assets/unused.bin",
              ),
          ),
        ).toBe(true);

        expect(
          report.heuristics
            .nearDuplicates
            .minimumJaccardSimilarity,
        ).toBe(0.88);
      },
    );

    it(
      "classifies cleanup candidates without authorizing vault mutation",
      async () => {
        const inventory =
          await inventoryVault({
            vaultRoot:
              fixtureRoot,
          });

        const report =
          auditInventory(
            inventory,
            {
              now: new Date(
                Date.now() +
                  100 *
                    86_400_000,
              ),
            },
          );

        const manifest =
          buildCleanupManifest(
            report,
            {
              protectedPrefixes: [
                "generated",
              ],
            },
          );

        expect(
          manifest.items.some(
            (item) =>
              item.category ===
                "protected_raw_evidence" &&
              item.paths.includes(
                "generated/generated-note.md",
              ),
          ),
        ).toBe(true);

        expect(
          manifest.items.some(
            (item) =>
              item.category ===
                "exact_duplicates" &&
              Boolean(
                item.recoveryPath,
              ),
          ),
        ).toBe(true);

        expect(
          manifest.items.some(
            (item) =>
              item.category ===
                "semantic_duplicates" &&
              item.actionConfidence ===
                "low",
          ),
        ).toBe(true);

        expect(
          manifest.items.some(
            (item) =>
              item.category ===
                "ambiguous_orphans" &&
              item.proposedAction.includes(
                "inspect-context",
              ),
          ),
        ).toBe(true);
      },
    );
  },
);

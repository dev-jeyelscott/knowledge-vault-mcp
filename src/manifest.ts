import type {
  AuditFinding,
  AuditReport,
  CleanupManifest,
  CleanupManifestItem,
  FindingConfidence,
  ManifestCategory,
} from "./types.js";

export interface ManifestOptions {
  protectedPrefixes?: string[];
  historicalPrefixes?: string[];
  now?: Date;
}

/** Normalizes a caller-provided vault-relative protection or history prefix. */
function normalizePrefix(
  value: string,
): string {
  return value
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/^\/+|\/+$/g, "");
}

/** Returns true when a finding path is equal to or below one configured vault-relative prefix. */
function matchesPrefix(
  paths: string[],
  prefixes: string[],
): boolean {
  return paths.some((itemPath) =>
    prefixes.some(
      (prefix) =>
        itemPath === prefix ||
        itemPath.startsWith(
          `${prefix}/`,
        ),
    ),
  );
}

/** Creates an explicit recovery instruction for any future destructive cleanup candidate. */
function recoveryFor(
  paths: string[],
): string {
  return (
    "Before any removal or merge, create or verify an external backup or " +
    "version-control recovery point. Restore using the original vault path(s): " +
    `${paths.join(", ")}.`
  );
}

/** Converts one audit finding into a conservative reviewed cleanup-manifest disposition. */
function classifyFinding(
  finding: AuditFinding,
  protectedPrefixes: string[],
  historicalPrefixes: string[],
): CleanupManifestItem {
  if (
    matchesPrefix(
      finding.paths,
      protectedPrefixes,
    )
  ) {
    return {
      findingId: finding.id,
      category:
        "protected_raw_evidence",
      actionConfidence: "high",
      paths: finding.paths,
      proposedAction: "preserve",
      reason:
        `Finding intersects a caller-declared protected path. ${finding.reason}`,
      recoveryPath: null,
    };
  }

  if (
    matchesPrefix(
      finding.paths,
      historicalPrefixes,
    )
  ) {
    return {
      findingId: finding.id,
      category:
        "historical_material",
      actionConfidence: "high",
      paths: finding.paths,
      proposedAction:
        "preserve-or-review-in-place",
      reason:
        `Finding intersects a caller-declared historical path. ${finding.reason}`,
      recoveryPath: null,
    };
  }

  const categoryByKind: Partial<
    Record<
      AuditFinding["kind"],
      ManifestCategory
    >
  > = {
    "reference-case-mismatch":
      "deterministic_repairs",
    "exact-duplicate":
      "exact_duplicates",
    "near-duplicate":
      "semantic_duplicates",
    "orphan-note":
      "ambiguous_orphans",
  };

  const category =
    categoryByKind[finding.kind] ??
    "manual_review";

  let actionConfidence:
    FindingConfidence =
    finding.confidence;

  let proposedAction =
    "review-only";

  let recoveryPath:
    string | null = null;

  switch (finding.kind) {
    case "reference-case-mismatch":
      actionConfidence = "high";
      proposedAction =
        "repair-reference-casing-only";
      recoveryPath = recoveryFor(
        finding.paths,
      );
      break;

    case "exact-duplicate":
      actionConfidence = "high";
      proposedAction =
        "select-canonical-copy-then-remove-redundant-exact-copy-after-review";
      recoveryPath = recoveryFor(
        finding.paths,
      );
      break;

    case "near-duplicate":
      actionConfidence = "low";
      proposedAction =
        "semantic-compare-then-merge-only-if-authority-is-clear";
      recoveryPath = recoveryFor(
        finding.paths,
      );
      break;

    case "orphan-note":
      actionConfidence = "low";
      proposedAction =
        "inspect-context-and-authority-before-any-removal";
      recoveryPath = recoveryFor(
        finding.paths,
      );
      break;

    case "orphan-asset":
      actionConfidence = "medium";
      proposedAction =
        "confirm-no-dynamic-or-external-use-before-removal";
      recoveryPath = recoveryFor(
        finding.paths,
      );
      break;

    case "generated-output-candidate":
      actionConfidence =
        finding.confidence;
      proposedAction =
        "remove-only-after-confirming-output-is-derived-and-reproducible";
      recoveryPath = recoveryFor(
        finding.paths,
      );
      break;

    case "duplicate-index-variant":
    case "authority-conflict":
      actionConfidence = "medium";
      proposedAction =
        "establish-canonical-authority-before-merge-or-link-repair";
      recoveryPath = recoveryFor(
        finding.paths,
      );
      break;

    case "broken-reference":
      actionConfidence = "medium";
      proposedAction =
        "repair-only-after-confirming-intended-target";
      recoveryPath = recoveryFor(
        finding.paths,
      );
      break;

    case "stale-state-task-candidate":
      actionConfidence = "low";
      proposedAction =
        "review-current-authority-then-archive-or-refresh-if-stale";
      recoveryPath = recoveryFor(
        finding.paths,
      );
      break;

    case "oversized-note":
      actionConfidence = "low";
      proposedAction =
        "review-structure-only-no-removal-implied";
      recoveryPath = null;
      break;
  }

  return {
    findingId: finding.id,
    category,
    actionConfidence,
    paths: finding.paths,
    proposedAction,
    reason: finding.reason,
    recoveryPath,
  };
}

/** Produces a non-mutating cleanup manifest that separates deterministic, semantic, historical, protected, and ambiguous findings. */
export function buildCleanupManifest(
  report: AuditReport,
  options: ManifestOptions = {},
): CleanupManifest {
  const protectedPrefixes =
    (
      options.protectedPrefixes ??
      []
    )
      .map(normalizePrefix)
      .filter(Boolean);

  const historicalPrefixes =
    (
      options.historicalPrefixes ??
      []
    )
      .map(normalizePrefix)
      .filter(Boolean);

  const now =
    options.now ?? new Date();

  const items =
    report.findings.map((item) =>
      classifyFinding(
        item,
        protectedPrefixes,
        historicalPrefixes,
      ),
    );

  items.sort(
    (left, right) =>
      left.category.localeCompare(
        right.category,
      ) ||
      left.paths
        .join("\n")
        .localeCompare(
          right.paths.join("\n"),
        ),
  );

  return {
    schemaVersion: 1,
    generatedAt:
      now.toISOString(),
    vaultRoot: report.vaultRoot,
    sourceReportGeneratedAt:
      report.generatedAt,
    protectedPrefixes,
    historicalPrefixes,
    items,
  };
}

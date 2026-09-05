/** Shared inventory and audit contracts for the read-only vault application. */
export type FrontmatterValue = unknown;

export interface FrontmatterData {
  raw: string | null;
  data: Record<string, FrontmatterValue>;
  parseError: string | null;
}

export type ReferenceKind =
  | "wikilink"
  | "embed"
  | "markdown"
  | "markdown-image"
  | "canvas";

export interface VaultReference {
  kind: ReferenceKind;
  sourcePath: string;
  raw: string;
  target: string;
  fragment: string | null;
  alias: string | null;
  line: number | null;
}

export interface HeadingRecord {
  level: number;
  text: string;
  line: number;
}

export interface BlockReferenceRecord {
  id: string;
  line: number;
}

export interface VaultFileBase {
  path: string;
  absolutePath: string;
  sizeBytes: number;
  mtimeMs: number;
  hash: string;
}

export interface VaultNote extends VaultFileBase {
  kind: "markdown";
  frontmatter: FrontmatterData;
  aliases: string[];
  headings: HeadingRecord[];
  blockReferences: BlockReferenceRecord[];
  references: VaultReference[];
  body: string;
  lineCount: number;
}

export interface VaultAsset extends VaultFileBase {
  kind: "asset";
}

export interface CanvasDocument extends VaultFileBase {
  kind: "canvas";
  references: VaultReference[];
  parseError: string | null;
}

export interface InventoryWarning {
  path: string;
  message: string;
}

export interface VaultInventory {
  vaultRoot: string;
  notes: VaultNote[];
  assets: VaultAsset[];
  canvases: CanvasDocument[];
  warnings: InventoryWarning[];
}

export type ReferenceResolutionStatus =
  | "resolved"
  | "broken"
  | "ambiguous"
  | "case-mismatch";

export interface ReferenceResolution {
  reference: VaultReference;
  status: ReferenceResolutionStatus;
  resolvedPath: string | null;
  candidates: string[];
  reason: string;
}

export type AuditFindingKind =
  | "exact-duplicate"
  | "near-duplicate"
  | "broken-reference"
  | "reference-case-mismatch"
  | "orphan-note"
  | "orphan-asset"
  | "duplicate-index-variant"
  | "oversized-note"
  | "generated-output-candidate"
  | "stale-state-task-candidate"
  | "authority-conflict";

export type FindingConfidence = "high" | "medium" | "low";
export type FindingSeverity = "info" | "warning" | "error";

export interface AuditFinding {
  id: string;
  kind: AuditFindingKind;
  confidence: FindingConfidence;
  severity: FindingSeverity;
  paths: string[];
  reason: string;
  details: Record<string, unknown>;
}

export interface AuditHeuristics {
  exactDuplicates: string;
  nearDuplicates: {
    minimumBodyCharacters: number;
    minimumLengthRatio: number;
    minimumJaccardSimilarity: number;
    shingleSize: number;
  };
  oversizedNotes: {
    maxBytes: number;
    maxLines: number;
  };
  staleStateTasks: {
    staleAfterDays: number;
    matchedBasenames: string[];
  };
  generatedOutputCandidates: string[];
  authorityConflicts: string;
}

export interface AuditReport {
  schemaVersion: 1;
  generatedAt: string;
  vaultRoot: string;
  heuristics: AuditHeuristics;
  summary: {
    notes: number;
    assets: number;
    canvases: number;
    warnings: number;
    findings: number;
    byKind: Partial<Record<AuditFindingKind, number>>;
  };
  findings: AuditFinding[];
}

export type ManifestCategory =
  | "deterministic_repairs"
  | "exact_duplicates"
  | "semantic_duplicates"
  | "historical_material"
  | "protected_raw_evidence"
  | "ambiguous_orphans"
  | "manual_review";

export interface CleanupManifestItem {
  findingId: string;
  category: ManifestCategory;
  actionConfidence: FindingConfidence;
  paths: string[];
  proposedAction: string;
  reason: string;
  recoveryPath: string | null;
}

export interface CleanupManifest {
  schemaVersion: 1;
  generatedAt: string;
  vaultRoot: string;
  sourceReportGeneratedAt: string;
  protectedPrefixes: string[];
  historicalPrefixes: string[];
  items: CleanupManifestItem[];
}

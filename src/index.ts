/** Public transport-independent exports for embedding the read-only vault parser, audit engine, and retrieval core. */
export {
  auditInventory,
} from "./audit.js";

export {
  buildCleanupManifest,
} from "./manifest.js";

export {
  inventoryVault,
} from "./parser.js";

export {
  resolveReferences,
} from "./reference-resolver.js";

export {
  VaultPathGuard,
  expandHome,
  isPathContained,
} from "./path-guard.js";

export {
  KnowledgeRetrievalService,
  createKnowledgeRetrievalService,
} from "./retrieval.js";

export {
  DEFAULT_AUTHORITY_PATH_POLICY,
  DEFAULT_PROTECTED_PREFIXES,
  DEFAULT_RETRIEVAL_BUDGETS,
  HARD_MAX_AGGREGATE_PAYLOAD_BYTES,
  HARD_MAX_FULL_NOTE_CHARS,
  HARD_MAX_SEARCH_EXCERPT_CHARS,
  HARD_MAX_SEARCH_RESULTS,
  HARD_MAX_SECTION_CHARS,
  MIN_AGGREGATE_PAYLOAD_BYTES,
  canSurfaceRelatedAuthority,
  classifyKnowledgeAuthority,
  isAuthoritySearchEligible,
  isProtectedPath,
  resolveAuthorityPathPolicy,
  resolveProtectedPrefixes,
  resolveRetrievalBudgets,
  resolveSearchKnowledgeScope,
} from "./retrieval-policy.js";

export type * from "./types.js";
export type * from "./retrieval.js";
export type * from "./retrieval-policy.js";


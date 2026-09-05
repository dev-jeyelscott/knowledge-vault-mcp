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
  DEFAULT_PROTECTED_PREFIXES,
  KnowledgeRetrievalService,
  createKnowledgeRetrievalService,
} from "./retrieval.js";

export type * from "./types.js";
export type * from "./retrieval.js";

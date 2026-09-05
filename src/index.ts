/** Public transport-independent exports for embedding the read-only vault parser and audit engine. */
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

export type * from "./types.js";

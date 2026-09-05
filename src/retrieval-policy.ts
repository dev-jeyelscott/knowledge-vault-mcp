import path from "node:path";

export const DEFAULT_PROTECTED_PREFIXES = [] as const;

export const DEFAULT_AUTHORITY_PATH_POLICY = {
  tier1Patterns: [
    "Projects/*/Project Overview.md",
    "Projects/*/Overview.md",
    "Projects/*/Decisions/**",
    "Projects/*/Lessons/**",
    "Projects/*/Runbook.md",
    "Projects/*/Runbooks/**",
    "wiki/**",
  ],
  tier2Patterns: [
    "Projects/*/Roadmaps/**",
    "Projects/*/Roadmap*.md",
    "Projects/*/Reviews/**",
    "Projects/*/Review*.md",
    "Projects/*/Phase Reviews/**",
    "Projects/*/Task Briefs/**",
    "Projects/*/Handoffs/**",
    "Projects/*/Phases/**",
    "wiki/Sources/**",
    "wiki/Source Material/**",
  ],
  sourcePatterns: [
    "raw/**",
    "evidence/**",
    "**/raw/**",
    "**/evidence/**",
  ],
  excludedPatterns: [
    "Inbox/**",
    "Generated/**",
    "Outputs/**",
    "Logs/**",
    "Templates/**",
    "**/Inbox/**",
    "**/Generated/**",
    "**/Outputs/**",
    "**/Logs/**",
    "**/Templates/**",
    "Tasks.md",
    "STATE.md",
    "Tasks/**",
    "STATE/**",
    "**/Tasks.md",
    "**/STATE.md",
    "**/Tasks/**",
    "**/STATE/**",
  ],
} as const;

export const DEFAULT_RETRIEVAL_BUDGETS = {
  defaultSearchLimit: 5,
  maxSearchResults: 10,
  searchExcerptChars: 360,
  maxSectionChars: 6_000,
  maxFullNoteChars: 8_000,
  maxAggregateBytes: 65_536,
} as const;

export const HARD_MAX_SEARCH_RESULTS = 25;
export const HARD_MAX_SEARCH_EXCERPT_CHARS = 1_000;
export const HARD_MAX_SECTION_CHARS = 16_000;
export const HARD_MAX_FULL_NOTE_CHARS = 16_000;
export const MIN_AGGREGATE_PAYLOAD_BYTES = 16_384;
export const HARD_MAX_AGGREGATE_PAYLOAD_BYTES = 131_072;

export type AuthorityTier =
  | "tier1"
  | "tier2"
  | "tier3";

export type AuthorityClass =
  | "curated"
  | "historical"
  | "source"
  | "excluded";

export type AuthorityAccess =
  | "default-searchable"
  | "explicit-searchable"
  | "source-searchable"
  | "exact-read-only";

export type SearchKnowledgeScope =
  | "default"
  | "tier2"
  | "source";

export interface KnowledgeAuthority {
  tier: AuthorityTier;
  class: AuthorityClass;
  access: AuthorityAccess;
}

export interface AuthorityPathPolicy {
  tier1Patterns: readonly string[];
  tier2Patterns: readonly string[];
  sourcePatterns: readonly string[];
  excludedPatterns: readonly string[];
}

export interface AuthorityPathPolicyOptions {
  tier1Patterns?: string[];
  tier2Patterns?: string[];
  sourcePatterns?: string[];
  excludedPatterns?: string[];
}

export interface RetrievalBudgets {
  defaultSearchLimit: number;
  maxSearchResults: number;
  searchExcerptChars: number;
  maxSectionChars: number;
  maxFullNoteChars: number;
  maxAggregateBytes: number;
}

export interface RetrievalBudgetOptions {
  defaultSearchLimit?: number;
  maxSearchResults?: number;
  searchExcerptChars?: number;
  maxSectionChars?: number;
  maxFullNoteChars?: number;
  maxAggregateBytes?: number;
}

/** Normalizes one configured authority pattern without requiring the referenced directory to exist. */
function normalizeAuthorityPattern(
  input: string,
): string {
  const value = input
    .trim()
    .replaceAll("\\", "/")
    .replace(/\/{2,}/g, "/");

  if (!value) {
    throw new Error(
      "Authority path patterns must not be empty.",
    );
  }

  if (path.posix.isAbsolute(value)) {
    throw new Error(
      `Authority path pattern must be vault-relative: ${input}`,
    );
  }

  const normalized = value
    .replace(/^\.\//, "")
    .replace(/\/+$/g, "");

  if (
    normalized
      .split("/")
      .some(
        (segment) =>
          segment === "." ||
          segment === "..",
      )
  ) {
    throw new Error(
      `Authority path pattern must not contain dot traversal segments: ${input}`,
    );
  }

  return normalized
    .normalize("NFKC")
    .toLowerCase();
}

/** Normalizes one parsed vault-relative note path for case-consistent authority matching. */
function normalizeAuthorityPath(
  input: string,
): string {
  return path.posix
    .normalize(
      input.replaceAll("\\", "/"),
    )
    .replace(/^\.\//, "")
    .replace(/^\/+|\/+$/g, "")
    .normalize("NFKC")
    .toLowerCase();
}

/** Converts the intentionally small `*` and `**` pattern language into one anchored regular expression. */
function authorityPatternToRegExp(
  pattern: string,
): RegExp {
  let source = "";

  for (
    let index = 0;
    index < pattern.length;
    index += 1
  ) {
    const character =
      pattern[index] ?? "";

    if (character === "*") {
      if (
        pattern[index + 1] ===
        "*"
      ) {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }

      continue;
    }

    source += character.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
  }

  return new RegExp(
    `^${source}$`,
    "u",
  );
}

/** Returns true when one normalized vault path matches one normalized authority pattern. */
function matchesAuthorityPattern(
  normalizedPath: string,
  pattern: string,
): boolean {
  return authorityPatternToRegExp(
    pattern,
  ).test(
    normalizedPath,
  );
}

/** Returns true when one path matches any configured pattern in deterministic declaration order. */
function matchesAnyAuthorityPattern(
  normalizedPath: string,
  patterns: readonly string[],
): boolean {
  return patterns.some(
    (pattern) =>
      matchesAuthorityPattern(
        normalizedPath,
        pattern,
      ),
  );
}

/** Resolves and validates the authority path policy while tolerating patterns for directories absent from the current vault. */
export function resolveAuthorityPathPolicy(
  options:
    AuthorityPathPolicyOptions = {},
): AuthorityPathPolicy {
  return {
    tier1Patterns:
      (
        options.tier1Patterns ??
        DEFAULT_AUTHORITY_PATH_POLICY
          .tier1Patterns
      ).map(
        normalizeAuthorityPattern,
      ),

    tier2Patterns:
      (
        options.tier2Patterns ??
        DEFAULT_AUTHORITY_PATH_POLICY
          .tier2Patterns
      ).map(
        normalizeAuthorityPattern,
      ),

    sourcePatterns:
      (
        options.sourcePatterns ??
        DEFAULT_AUTHORITY_PATH_POLICY
          .sourcePatterns
      ).map(
        normalizeAuthorityPattern,
      ),

    excludedPatterns:
      (
        options.excludedPatterns ??
        DEFAULT_AUTHORITY_PATH_POLICY
          .excludedPatterns
      ).map(
        normalizeAuthorityPattern,
      ),
  };
}

/** Classifies one unprotected note path, with restrictive and source-specific rules taking precedence over broad curated patterns. */
export function classifyKnowledgeAuthority(
  notePath: string,
  policy: AuthorityPathPolicy,
): KnowledgeAuthority {
  const normalizedPath =
    normalizeAuthorityPath(
      notePath,
    );

  if (
    matchesAnyAuthorityPattern(
      normalizedPath,
      policy.excludedPatterns,
    )
  ) {
    return {
      tier: "tier3",
      class: "excluded",
      access: "exact-read-only",
    };
  }

  if (
    matchesAnyAuthorityPattern(
      normalizedPath,
      policy.sourcePatterns,
    )
  ) {
    return {
      tier: "tier3",
      class: "source",
      access: "source-searchable",
    };
  }

  if (
    matchesAnyAuthorityPattern(
      normalizedPath,
      policy.tier2Patterns,
    )
  ) {
    return {
      tier: "tier2",
      class: "historical",
      access: "explicit-searchable",
    };
  }

  if (
    matchesAnyAuthorityPattern(
      normalizedPath,
      policy.tier1Patterns,
    )
  ) {
    return {
      tier: "tier1",
      class: "curated",
      access: "default-searchable",
    };
  }

  return {
    tier: "tier3",
    class: "excluded",
    access: "exact-read-only",
  };
}

/** Resolves one search scope and rejects unsupported runtime values from non-TypeScript callers. */
export function resolveSearchKnowledgeScope(
  value:
    SearchKnowledgeScope | undefined,
): SearchKnowledgeScope {
  const scope =
    value ?? "default";

  if (
    scope !== "default" &&
    scope !== "tier2" &&
    scope !== "source"
  ) {
    throw new Error(
      "Search scope must be one of: default, tier2, source.",
    );
  }

  return scope;
}

/** Returns whether one note authority is eligible for the explicitly requested search surface. */
export function isAuthoritySearchEligible(
  authority: KnowledgeAuthority,
  scope: SearchKnowledgeScope,
): boolean {
  if (scope === "default") {
    return authority.access ===
      "default-searchable";
  }

  if (scope === "tier2") {
    return (
      authority.access ===
        "default-searchable" ||
      authority.access ===
        "explicit-searchable"
    );
  }

  return authority.access ===
    "source-searchable";
}

/** Prevents a lower-authority exact read from expanding backlinks or related-note results into a higher authority surface. */
export function canSurfaceRelatedAuthority(
  source: KnowledgeAuthority,
  candidate: KnowledgeAuthority,
): boolean {
  if (
    source.access ===
    "default-searchable"
  ) {
    return candidate.access ===
      "default-searchable";
  }

  if (
    source.access ===
    "explicit-searchable"
  ) {
    return (
      candidate.access ===
        "default-searchable" ||
      candidate.access ===
        "explicit-searchable"
    );
  }

  if (
    source.access ===
    "source-searchable"
  ) {
    return candidate.access !==
      "exact-read-only";
  }

  return true;
}

/** Normalizes one permanent access-protection prefix and rejects traversal or wildcard semantics. */
function normalizeProtectedPrefix(
  input: string,
): string {
  const value = input
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\/+|\/+$/g, "");

  if (!value) {
    return "";
  }

  if (
    value.includes("*") ||
    value
      .split("/")
      .some(
        (segment) =>
          segment === "." ||
          segment === "..",
      )
  ) {
    throw new Error(
      `Protected prefix must be a literal vault-relative path: ${input}`,
    );
  }

  return value
    .replace(/\/{2,}/g, "/")
    .normalize("NFKC")
    .toLowerCase();
}

/** Resolves configured permanent protected prefixes separately from authority-tier search exclusion. */
export function resolveProtectedPrefixes(
  values:
    readonly string[] =
      DEFAULT_PROTECTED_PREFIXES,
): string[] {
  return values
    .map(
      normalizeProtectedPrefix,
    )
    .filter(Boolean);
}

/** Returns true when a parsed note path is permanently inaccessible because it is below a configured protected prefix. */
export function isProtectedPath(
  notePath: string,
  protectedPrefixes: readonly string[],
): boolean {
  const normalizedPath =
    normalizeAuthorityPath(
      notePath,
    );

  return protectedPrefixes.some(
    (prefix) =>
      normalizedPath === prefix ||
      normalizedPath.startsWith(
        `${prefix}/`,
      ),
  );
}

/** Resolves one positive integer configuration value against an explicit hard safety ceiling. */
function resolveBoundedInteger(
  value: number | undefined,
  fallback: number,
  label: string,
  hardMaximum: number,
  minimum = 1,
): number {
  const resolved =
    value ?? fallback;

  if (
    !Number.isInteger(resolved) ||
    resolved < minimum ||
    resolved > hardMaximum
  ) {
    throw new Error(
      `${label} must be an integer between ${minimum} and ${hardMaximum}.`,
    );
  }

  return resolved;
}

/** Resolves configurable retrieval budgets and enforces hard ceilings before any transport can be created. */
export function resolveRetrievalBudgets(
  options:
    RetrievalBudgetOptions = {},
): RetrievalBudgets {
  const maxSearchResults =
    resolveBoundedInteger(
      options.maxSearchResults,
      DEFAULT_RETRIEVAL_BUDGETS
        .maxSearchResults,
      "maxSearchResults",
      HARD_MAX_SEARCH_RESULTS,
    );

  const defaultSearchLimit =
    resolveBoundedInteger(
      options.defaultSearchLimit,
      DEFAULT_RETRIEVAL_BUDGETS
        .defaultSearchLimit,
      "defaultSearchLimit",
      maxSearchResults,
    );

  return {
    defaultSearchLimit,
    maxSearchResults,

    searchExcerptChars:
      resolveBoundedInteger(
        options.searchExcerptChars,
        DEFAULT_RETRIEVAL_BUDGETS
          .searchExcerptChars,
        "searchExcerptChars",
        HARD_MAX_SEARCH_EXCERPT_CHARS,
      ),

    maxSectionChars:
      resolveBoundedInteger(
        options.maxSectionChars,
        DEFAULT_RETRIEVAL_BUDGETS
          .maxSectionChars,
        "maxSectionChars",
        HARD_MAX_SECTION_CHARS,
      ),

    maxFullNoteChars:
      resolveBoundedInteger(
        options.maxFullNoteChars,
        DEFAULT_RETRIEVAL_BUDGETS
          .maxFullNoteChars,
        "maxFullNoteChars",
        HARD_MAX_FULL_NOTE_CHARS,
      ),

    maxAggregateBytes:
      resolveBoundedInteger(
        options.maxAggregateBytes,
        DEFAULT_RETRIEVAL_BUDGETS
          .maxAggregateBytes,
        "maxAggregateBytes",
        HARD_MAX_AGGREGATE_PAYLOAD_BYTES,
        MIN_AGGREGATE_PAYLOAD_BYTES,
      ),
  };
}


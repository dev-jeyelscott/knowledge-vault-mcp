import path from "node:path";

import {
  inventoryVault,
} from "./parser.js";

import {
  resolveReferences,
} from "./reference-resolver.js";

import {
  canSurfaceRelatedAuthority,
  classifyKnowledgeAuthority,
  isAuthoritySearchEligible,
  isProtectedPath,
  resolveAuthorityPathPolicy,
  resolveProtectedPrefixes,
  resolveRetrievalBudgets,
  resolveSearchKnowledgeScope,
} from "./retrieval-policy.js";

import type {
  AuthorityPathPolicyOptions,
  KnowledgeAuthority,
  RetrievalBudgetOptions,
  RetrievalBudgets,
  SearchKnowledgeScope,
} from "./retrieval-policy.js";

import type {
  ReferenceResolution,
  VaultInventory,
  VaultNote,
} from "./types.js";

export {
  DEFAULT_PROTECTED_PREFIXES,
} from "./retrieval-policy.js";

const MAX_EVIDENCE_ITEMS = 3;
const MAX_METADATA_VALUES = 50;
const MAX_METADATA_VALUE_CHARS = 240;
const MAX_METADATA_HEADINGS = 200;
const MAX_METADATA_LINKS = 200;
const MAX_SEARCH_METADATA_VALUES = 5;
const MAX_SEARCH_METADATA_VALUE_CHARS = 120;

export type RelevanceEvidenceKind =
  | "title"
  | "heading"
  | "alias"
  | "tag"
  | "frontmatter"
  | "body"
  | "path";

export interface KnowledgeRetrievalOptions {
  vaultRoot: string;
  protectedPrefixes?: string[];
  authorityPolicy?:
    AuthorityPathPolicyOptions;
  budgets?: RetrievalBudgetOptions;
}

export interface KnowledgeRetrievalServiceOptions {
  protectedPrefixes?: string[];
  authorityPolicy?:
    AuthorityPathPolicyOptions;
  budgets?: RetrievalBudgetOptions;
}

export interface SearchKnowledgeInput {
  query: string;
  project?: string;
  folder?: string;
  tags?: string[];
  type?: string;
  status?: string;
  scope?: SearchKnowledgeScope;
  limit?: number;
}

export interface RelevanceEvidence {
  kind: RelevanceEvidenceKind;
  text: string;
}

export interface SearchKnowledgeMetadata {
  project: string[];
  tags: string[];
  type: string[];
  status: string[];
}

export interface SearchKnowledgeResult {
  path: string;
  title: string;
  authority: KnowledgeAuthority;
  score: number;
  metadata: SearchKnowledgeMetadata;
  evidence: RelevanceEvidence[];
}

export interface NoteMetadata {
  path: string;
  title: string;
  authority: KnowledgeAuthority;
  aliases: string[];
  tags: string[];
  project: string[];
  type: string[];
  status: string[];
  headings: Array<{
    level: number;
    text: string;
  }>;
  outgoingLinks: string[];
  backlinks: string[];
  sizeBytes: number;
  lineCount: number;
  modifiedAt: string;
}

export interface GetNoteSectionInput {
  path: string;
  heading?: string;
  maxChars?: number;
}

export interface NoteSectionResult {
  path: string;
  title: string;
  authority: KnowledgeAuthority;
  heading: string | null;
  content: string;
  truncated: boolean;
  charsReturned: number;
  bytesReturned: number;
}

export interface GetRelatedNotesInput {
  path: string;
  limit?: number;
}

export type RelatedNoteRelationship =
  | "mutual"
  | "outgoing"
  | "backlink";

export interface RelatedNoteResult {
  path: string;
  title: string;
  authority: KnowledgeAuthority;
  relationship:
    RelatedNoteRelationship;
  evidence: string;
}

interface ParsedBodyHeading {
  level: number;
  text: string;
  lineIndex: number;
}

/** Compares strings using stable code-unit ordering instead of environment-dependent locale ordering. */
function compareStrings(
  left: string,
  right: string,
): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

/** Truncates externally returned text so one metadata or evidence value cannot dominate a tool result. */
function truncateText(
  value: string,
  maxChars: number,
): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(
    0,
    Math.max(0, maxChars - 1),
  )}…`;
}

/** Normalizes text for deterministic case-insensitive lexical matching. */
function normalizeText(
  value: string,
): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Produces unique lexical query terms using Unicode letters and numbers only. */
function tokenize(
  value: string,
): string[] {
  const matches =
    normalizeText(value).match(
      /[\p{L}\p{N}]+/gu,
    ) ?? [];

  return [...new Set(matches)];
}

/** Normalizes and validates one vault-relative request path without touching the filesystem. */
function normalizeVaultRelativePath(
  input: string,
  label: string,
): string {
  const value = input
    .trim()
    .replaceAll("\\", "/");

  if (!value) {
    throw new Error(
      `${label} must not be empty.`,
    );
  }

  if (
    path.posix.isAbsolute(value) ||
    value
      .split("/")
      .some(
        (segment) =>
          segment === "..",
      )
  ) {
    throw new Error(
      `${label} must be a vault-relative path.`,
    );
  }

  const normalized =
    path.posix
      .normalize(value)
      .replace(/^\.\//, "");

  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    path.posix.isAbsolute(normalized)
  ) {
    throw new Error(
      `${label} must remain inside the configured vault.`,
    );
  }

  return normalized;
}

/** Extracts string values from one frontmatter property while ignoring unsupported shapes. */
function getFrontmatterValues(
  note: VaultNote,
  key: string,
): string[] {
  const value =
    note.frontmatter.data[key];

  if (typeof value === "string") {
    const trimmed = value.trim();

    return trimmed ? [trimmed] : [];
  }

  if (Array.isArray(value)) {
    return value
      .filter(
        (item): item is string =>
          typeof item === "string",
      )
      .map(
        (item) =>
          item.trim(),
      )
      .filter(Boolean);
  }

  return [];
}

/** Normalizes common Obsidian frontmatter tag shapes into deterministic tag values. */
function getTags(
  note: VaultNote,
): string[] {
  const rawValues = [
    ...getFrontmatterValues(
      note,
      "tags",
    ),
    ...getFrontmatterValues(
      note,
      "tag",
    ),
  ];

  const tags = rawValues
    .flatMap(
      (value) =>
        value.split(","),
    )
    .map(
      (value) =>
        value
          .trim()
          .replace(/^#+/, ""),
    )
    .filter(Boolean);

  return [...new Set(tags)]
    .sort(compareStrings);
}

/** Resolves a concise note title from frontmatter, the first H1, or the Markdown filename. */
function getTitle(
  note: VaultNote,
): string {
  const frontmatterTitle =
    getFrontmatterValues(
      note,
      "title",
    )[0];

  if (frontmatterTitle) {
    return truncateText(
      frontmatterTitle,
      MAX_METADATA_VALUE_CHARS,
    );
  }

  const firstHeading =
    note.headings.find(
      (heading) =>
        heading.level === 1,
    );

  if (firstHeading) {
    return truncateText(
      firstHeading.text,
      MAX_METADATA_VALUE_CHARS,
    );
  }

  return truncateText(
    path.posix.basename(
      note.path,
      path.posix.extname(
        note.path,
      ),
    ),
    MAX_METADATA_VALUE_CHARS,
  );
}

/** Returns bounded metadata values suitable for metadata responses. */
function presentMetadataValues(
  values: string[],
): string[] {
  return values
    .slice(
      0,
      MAX_METADATA_VALUES,
    )
    .map(
      (value) =>
        truncateText(
          value,
          MAX_METADATA_VALUE_CHARS,
        ),
    );
}

/** Returns smaller bounded metadata values suitable for search-result selection context. */
function presentSearchMetadataValues(
  values: string[],
): string[] {
  return values
    .slice(
      0,
      MAX_SEARCH_METADATA_VALUES,
    )
    .map(
      (value) =>
        truncateText(
          value,
          MAX_SEARCH_METADATA_VALUE_CHARS,
        ),
    );
}

/** Builds compact deterministic metadata that helps callers select a search result without returning note content. */
function getSearchMetadata(
  note: VaultNote,
): SearchKnowledgeMetadata {
  return {
    project:
      presentSearchMetadataValues(
        getFrontmatterValues(
          note,
          "project",
        ),
      ),

    tags:
      presentSearchMetadataValues(
        getTags(note),
      ),

    type:
      presentSearchMetadataValues(
        getFrontmatterValues(
          note,
          "type",
        ),
      ),

    status:
      presentSearchMetadataValues(
        getFrontmatterValues(
          note,
          "status",
        ),
      ),
  };
}

/** Tests a frontmatter filter using normalized exact matching against all string values. */
function matchesFrontmatterFilter(
  note: VaultNote,
  key: string,
  expected: string | undefined,
): boolean {
  if (!expected) {
    return true;
  }

  const wanted =
    normalizeText(expected);

  return getFrontmatterValues(
    note,
    key,
  ).some(
    (value) =>
      normalizeText(value) ===
      wanted,
  );
}

/** Applies AND semantics to requested tags using normalized exact tag matching. */
function matchesTags(
  note: VaultNote,
  requestedTags: string[] | undefined,
): boolean {
  if (
    !requestedTags ||
    requestedTags.length === 0
  ) {
    return true;
  }

  const actual = new Set(
    getTags(note).map(
      normalizeText,
    ),
  );

  return requestedTags.every(
    (tag) =>
      actual.has(
        normalizeText(tag),
      ),
  );
}

/** Applies one normalized folder or scope prefix to a vault-relative note path. */
function matchesFolder(
  notePath: string,
  folder: string | undefined,
): boolean {
  if (!folder) {
    return true;
  }

  const normalized =
    normalizeVaultRelativePath(
      folder,
      "Folder",
    ).replace(/\/+$/g, "");

  return (
    notePath === normalized ||
    notePath.startsWith(
      `${normalized}/`,
    )
  );
}

/** Validates one caller-supplied result limit against the configured retrieval maximum. */
function resolveResultLimit(
  value: number | undefined,
  budgets: RetrievalBudgets,
): number {
  const limit =
    value ??
    budgets.defaultSearchLimit;

  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > budgets.maxSearchResults
  ) {
    throw new Error(
      `Limit must be an integer between 1 and ${budgets.maxSearchResults}.`,
    );
  }

  return limit;
}

/** Validates one requested content character limit against the operation-specific configured maximum. */
function resolveContentLimit(
  value: number,
  configuredMaximum: number,
  label: string,
): number {
  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > configuredMaximum
  ) {
    throw new Error(
      `${label} must be an integer between 1 and ${configuredMaximum}.`,
    );
  }

  return value;
}

/** Adds one concise relevance evidence item while respecting one total per-result excerpt character budget. */
function addEvidence(
  evidence: RelevanceEvidence[],
  kind: RelevanceEvidenceKind,
  text: string,
  maxExcerptChars: number,
): void {
  if (
    evidence.length >=
    MAX_EVIDENCE_ITEMS
  ) {
    return;
  }

  const usedChars =
    evidence.reduce(
      (total, item) =>
        total + item.text.length,
      0,
    );

  const remainingChars =
    maxExcerptChars - usedChars;

  if (remainingChars <= 0) {
    return;
  }

  const presented =
    truncateText(
      text.trim(),
      remainingChars,
    );

  if (!presented) {
    return;
  }

  const duplicate =
    evidence.some(
      (item) =>
        item.kind === kind &&
        item.text === presented,
    );

  if (!duplicate) {
    evidence.push({
      kind,
      text: presented,
    });
  }
}

/** Finds the first body line that contains the normalized query phrase or one query term. */
function findBodyEvidence(
  body: string,
  query: string,
  terms: string[],
): string | null {
  const queryPhrase =
    normalizeText(query);

  for (
    const line of
      body.split(/\r?\n/)
  ) {
    const normalized =
      normalizeText(line);

    if (
      queryPhrase &&
      normalized.includes(
        queryPhrase,
      )
    ) {
      return line.trim();
    }
  }

  for (
    const line of
      body.split(/\r?\n/)
  ) {
    const normalized =
      normalizeText(line);

    if (
      terms.some(
        (term) =>
          normalized.includes(term),
      )
    ) {
      return line.trim();
    }
  }

  return null;
}

/** Calculates the existing deterministic weighted lexical score and bounded concise evidence for one note. */
function scoreNote(
  note: VaultNote,
  query: string,
  maxExcerptChars: number,
): {
  score: number;
  evidence: RelevanceEvidence[];
} {
  const phrase =
    normalizeText(query);

  const terms =
    tokenize(query);

  const title =
    getTitle(note);

  const headings =
    note.headings.map(
      (heading) =>
        heading.text,
    );

  const aliases =
    note.aliases;

  const tags =
    getTags(note);

  const metadata = [
    ...getFrontmatterValues(
      note,
      "project",
    ),
    ...getFrontmatterValues(
      note,
      "type",
    ),
    ...getFrontmatterValues(
      note,
      "status",
    ),
  ];

  const normalizedTitle =
    normalizeText(title);

  const normalizedHeadings =
    headings.map(
      normalizeText,
    );

  const normalizedAliases =
    aliases.map(
      normalizeText,
    );

  const normalizedTags =
    tags.map(
      normalizeText,
    );

  const normalizedMetadata =
    metadata.map(
      normalizeText,
    );

  const normalizedBody =
    normalizeText(note.body);

  const normalizedPath =
    normalizeText(note.path);

  const evidence:
    RelevanceEvidence[] = [];

  let score = 0;

  if (
    phrase &&
    normalizedTitle === phrase
  ) {
    score += 120;
    addEvidence(
      evidence,
      "title",
      title,
      maxExcerptChars,
    );
  } else if (
    phrase &&
    normalizedTitle.includes(
      phrase,
    )
  ) {
    score += 80;
    addEvidence(
      evidence,
      "title",
      title,
      maxExcerptChars,
    );
  }

  for (const term of terms) {
    if (
      normalizedTitle.includes(
        term,
      )
    ) {
      score += 20;
      addEvidence(
        evidence,
        "title",
        title,
        maxExcerptChars,
      );
    }
  }

  const matchingHeading =
    headings.find(
      (_heading, index) =>
        (
          phrase &&
          normalizedHeadings[
            index
          ]?.includes(phrase)
        ) ||
        terms.some(
          (term) =>
            normalizedHeadings[
              index
            ]?.includes(term),
        ),
    );

  if (matchingHeading) {
    score +=
      phrase &&
      normalizeText(
        matchingHeading,
      ).includes(phrase)
        ? 40
        : 20;

    addEvidence(
      evidence,
      "heading",
      matchingHeading,
      maxExcerptChars,
    );
  }

  for (const term of terms) {
    if (
      normalizedHeadings.some(
        (heading) =>
          heading.includes(term),
      )
    ) {
      score += 8;
    }
  }

  const matchingAlias =
    aliases.find(
      (_alias, index) =>
        (
          phrase &&
          normalizedAliases[
            index
          ]?.includes(phrase)
        ) ||
        terms.some(
          (term) =>
            normalizedAliases[
              index
            ]?.includes(term),
        ),
    );

  if (matchingAlias) {
    score += 24;
    addEvidence(
      evidence,
      "alias",
      matchingAlias,
      maxExcerptChars,
    );
  }

  const matchingTag =
    tags.find(
      (_tag, index) =>
        (
          phrase &&
          normalizedTags[
            index
          ]?.includes(phrase)
        ) ||
        terms.some(
          (term) =>
            normalizedTags[
              index
            ]?.includes(term),
        ),
    );

  if (matchingTag) {
    score += 18;
    addEvidence(
      evidence,
      "tag",
      matchingTag,
      maxExcerptChars,
    );
  }

  const matchingMetadata =
    metadata.find(
      (_value, index) =>
        (
          phrase &&
          normalizedMetadata[
            index
          ]?.includes(phrase)
        ) ||
        terms.some(
          (term) =>
            normalizedMetadata[
              index
            ]?.includes(term),
        ),
    );

  if (matchingMetadata) {
    score += 12;
    addEvidence(
      evidence,
      "frontmatter",
      matchingMetadata,
      maxExcerptChars,
    );
  }

  if (
    phrase &&
    normalizedBody.includes(
      phrase,
    )
  ) {
    score += 15;
  }

  for (const term of terms) {
    if (
      normalizedBody.includes(
        term,
      )
    ) {
      score += 2;
    }

    if (
      normalizedPath.includes(
        term,
      )
    ) {
      score += 4;
    }
  }

  const bodyEvidence =
    findBodyEvidence(
      note.body,
      query,
      terms,
    );

  if (bodyEvidence) {
    addEvidence(
      evidence,
      "body",
      bodyEvidence,
      maxExcerptChars,
    );
  }

  if (
    score > 0 &&
    evidence.length === 0
  ) {
    addEvidence(
      evidence,
      "path",
      note.path,
      maxExcerptChars,
    );
  }

  return {
    score,
    evidence,
  };
}

/** Produces a conservative Markdown heading slug for section lookup. */
function slugHeading(
  input: string,
): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(
      /[^\p{L}\p{N}\s-]/gu,
      "",
    )
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

/** Scans one already-parsed note body for section boundaries without performing any filesystem reads. */
function parseBodyHeadings(
  body: string,
): ParsedBodyHeading[] {
  const lines =
    body.split(/\r?\n/);

  const headings:
    ParsedBodyHeading[] = [];

  let fenceCharacter:
    "`" | "~" | null = null;

  let fenceLength = 0;

  for (
    let index = 0;
    index < lines.length;
    index += 1
  ) {
    const line =
      lines[index] ?? "";

    const trimmed =
      line.trimStart();

    const fenceMatch =
      trimmed.match(
        /^(`{3,}|~{3,})/,
      );

    if (fenceCharacter) {
      if (
        fenceMatch &&
        fenceMatch[1]?.[0] ===
          fenceCharacter &&
        fenceMatch[1].length >=
          fenceLength
      ) {
        fenceCharacter = null;
        fenceLength = 0;
      }

      continue;
    }

    if (fenceMatch) {
      fenceCharacter =
        fenceMatch[1]?.[0] as
          | "`"
          | "~";

      fenceLength =
        fenceMatch[1]?.length ?? 0;

      continue;
    }

    const headingMatch =
      line.match(
        /^(#{1,6})\s+(.+?)\s*$/,
      );

    if (!headingMatch) {
      continue;
    }

    headings.push({
      level:
        headingMatch[1]?.length ??
        1,

      text:
        headingMatch[2]?.trim() ??
        "",

      lineIndex: index,
    });
  }

  return headings;
}

/** Extracts one complete Markdown section from an in-memory note body. */
function extractSection(
  note: VaultNote,
  requestedHeading: string,
): {
  heading: string;
  content: string;
} {
  const wanted =
    requestedHeading
      .trim()
      .replace(/^#+\s*/, "");

  if (!wanted) {
    throw new Error(
      "Heading must not be empty.",
    );
  }

  const normalizedWanted =
    normalizeText(wanted);

  const slugWanted =
    slugHeading(wanted);

  const headings =
    parseBodyHeadings(
      note.body,
    );

  const selectedIndex =
    headings.findIndex(
      (heading) =>
        normalizeText(
          heading.text,
        ) === normalizedWanted ||
        slugHeading(
          heading.text,
        ) === slugWanted,
    );

  if (selectedIndex === -1) {
    throw new Error(
      `Heading not found in ${note.path}: ${requestedHeading}`,
    );
  }

  const selected =
    headings[selectedIndex];

  if (!selected) {
    throw new Error(
      `Heading not found in ${note.path}: ${requestedHeading}`,
    );
  }

  const nextBoundary =
    headings
      .slice(
        selectedIndex + 1,
      )
      .find(
        (heading) =>
          heading.level <=
          selected.level,
      );

  const lines =
    note.body.split(/\r?\n/);

  const endIndex =
    nextBoundary?.lineIndex ??
    lines.length;

  return {
    heading: selected.text,
    content:
      lines
        .slice(
          selected.lineIndex,
          endIndex,
        )
        .join("\n")
        .trimEnd(),
  };
}

/** Applies one explicit character bound and reports actual returned characters and UTF-8 bytes. */
function boundContent(
  content: string,
  maxChars: number,
): {
  content: string;
  truncated: boolean;
  charsReturned: number;
  bytesReturned: number;
} {
  const truncated =
    content.length > maxChars;

  const bounded =
    truncated
      ? content.slice(
          0,
          maxChars,
        )
      : content;

  return {
    content: bounded,
    truncated,
    charsReturned:
      bounded.length,
    bytesReturned:
      Buffer.byteLength(
        bounded,
        "utf8",
      ),
  };
}

/** Measures the UTF-8 size of one transport-neutral knowledge payload using its JSON representation. */
function measurePayloadBytes(
  payload: unknown,
): number {
  return Buffer.byteLength(
    JSON.stringify(payload),
    "utf8",
  );
}

/** Rejects a bounded non-content payload when it still exceeds the configured aggregate response ceiling. */
function assertPayloadWithinBudget(
  payload: unknown,
  maxAggregateBytes: number,
  label: string,
): void {
  const bytes =
    measurePayloadBytes(
      payload,
    );

  if (bytes > maxAggregateBytes) {
    throw new Error(
      `${label} exceeds the configured aggregate payload budget of ${maxAggregateBytes} UTF-8 bytes.`,
    );
  }
}

/** Selects a deterministic prefix of ranked results that respects both count and aggregate UTF-8 payload budgets. */
function boundResultCollection<
  Result,
>(
  results: Result[],
  limit: number,
  maxAggregateBytes: number,
  label: string,
): Result[] {
  const selected: Result[] = [];

  for (const result of results) {
    if (selected.length >= limit) {
      break;
    }

    const candidate = [
      ...selected,
      result,
    ];

    if (
      measurePayloadBytes({
        results: candidate,
      }) > maxAggregateBytes
    ) {
      if (selected.length === 0) {
        throw new Error(
          `${label} cannot fit one result inside the configured aggregate payload budget of ${maxAggregateBytes} UTF-8 bytes.`,
        );
      }

      break;
    }

    selected.push(result);
  }

  return selected;
}

/** Shrinks only the returned section content when aggregate JSON size is tighter than its character limit. */
function fitSectionToAggregateBudget(
  result: NoteSectionResult,
  maxAggregateBytes: number,
): NoteSectionResult {
  if (
    measurePayloadBytes(result) <=
    maxAggregateBytes
  ) {
    return result;
  }

  const characters =
    Array.from(result.content);

  let low = 0;
  let high = characters.length;
  let bestContent = "";

  while (low <= high) {
    const middle =
      Math.floor(
        (low + high) / 2,
      );

    const content =
      characters
        .slice(0, middle)
        .join("");

    const candidate:
      NoteSectionResult = {
        ...result,
        content,
        truncated: true,
        charsReturned:
          content.length,
        bytesReturned:
          Buffer.byteLength(
            content,
            "utf8",
          ),
      };

    if (
      measurePayloadBytes(candidate) <=
      maxAggregateBytes
    ) {
      bestContent = content;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  const fitted:
    NoteSectionResult = {
      ...result,
      content: bestContent,
      truncated: true,
      charsReturned:
        bestContent.length,
      bytesReturned:
        Buffer.byteLength(
          bestContent,
          "utf8",
        ),
    };

  assertPayloadWithinBudget(
    fitted,
    maxAggregateBytes,
    "get_note_section response",
  );

  return fitted;
}

/** Creates a stable unique path list while preserving no duplicate resolved link targets. */
function uniqueSortedPaths(
  values: string[],
): string[] {
  return [...new Set(values)]
    .sort(compareStrings);
}

/** Provides deterministic bounded read-only retrieval over one immutable vault inventory snapshot. */
export class KnowledgeRetrievalService {
  private readonly notes:
    VaultNote[];

  private readonly noteByPath:
    Map<string, VaultNote>;

  private readonly authorityByPath:
    Map<string, KnowledgeAuthority>;

  private readonly resolutions:
    ReferenceResolution[];

  private readonly budgets:
    RetrievalBudgets;

  /** Builds retrieval indexes from an existing read-only inventory without modifying or rereading vault files. */
  constructor(
    inventory: VaultInventory,
    options:
      KnowledgeRetrievalServiceOptions =
        {},
  ) {
    const protectedPrefixes =
      resolveProtectedPrefixes(
        options.protectedPrefixes,
      );

    const authorityPolicy =
      resolveAuthorityPathPolicy(
        options.authorityPolicy,
      );

    this.budgets =
      resolveRetrievalBudgets(
        options.budgets,
      );

    this.notes =
      inventory.notes.filter(
        (note) =>
          !isProtectedPath(
            note.path,
            protectedPrefixes,
          ),
      );

    this.noteByPath =
      new Map(
        this.notes.map(
          (note) => [
            note.path,
            note,
          ],
        ),
      );

    this.authorityByPath =
      new Map(
        this.notes.map(
          (note) => [
            note.path,
            classifyKnowledgeAuthority(
              note.path,
              authorityPolicy,
            ),
          ],
        ),
      );

    const readablePaths =
      new Set(
        this.notes.map(
          (note) =>
            note.path,
        ),
      );

    this.resolutions =
      resolveReferences(
        inventory,
      ).filter(
        (resolution) =>
          readablePaths.has(
            resolution.reference
              .sourcePath,
          ) &&
          (
            resolution.resolvedPath ===
              null ||
            readablePaths.has(
              resolution.resolvedPath,
            )
          ),
      );
  }

  /** Searches only the requested authority surface using the existing lexical weighting, exact filters, and deterministic path tie breaking. */
  searchKnowledge(
    input: SearchKnowledgeInput,
  ): SearchKnowledgeResult[] {
    const query =
      input.query.trim();

    if (
      query.length < 1 ||
      query.length > 500
    ) {
      throw new Error(
        "Query must contain between 1 and 500 characters.",
      );
    }

    if (
      input.tags &&
      input.tags.length > 20
    ) {
      throw new Error(
        "At most 20 tags may be requested.",
      );
    }

    const scope =
      resolveSearchKnowledgeScope(
        input.scope,
      );

    const limit =
      resolveResultLimit(
        input.limit,
        this.budgets,
      );

    const results:
      SearchKnowledgeResult[] = [];

    for (const note of this.notes) {
      const authority =
        this.getAuthority(
          note.path,
        );

      if (
        !isAuthoritySearchEligible(
          authority,
          scope,
        ) ||
        !matchesFolder(
          note.path,
          input.folder,
        ) ||
        !matchesTags(
          note,
          input.tags,
        ) ||
        !matchesFrontmatterFilter(
          note,
          "project",
          input.project,
        ) ||
        !matchesFrontmatterFilter(
          note,
          "type",
          input.type,
        ) ||
        !matchesFrontmatterFilter(
          note,
          "status",
          input.status,
        )
      ) {
        continue;
      }

      const ranked =
        scoreNote(
          note,
          query,
          this.budgets
            .searchExcerptChars,
        );

      if (ranked.score <= 0) {
        continue;
      }

      results.push({
        path: note.path,
        title:
          getTitle(note),
        authority,
        score:
          ranked.score,
        metadata:
          getSearchMetadata(note),
        evidence:
          ranked.evidence,
      });
    }

    results.sort(
      (left, right) =>
        right.score -
          left.score ||
        compareStrings(
          left.path,
          right.path,
        ),
    );

    return boundResultCollection(
      results,
      limit,
      this.budgets
        .maxAggregateBytes,
      "search_knowledge response",
    );
  }

  /** Returns bounded body-free metadata for one exact unprotected note while filtering relationships by the selected note's authority surface. */
  getNoteMetadata(
    notePathInput: string,
  ): NoteMetadata {
    const note =
      this.getReadableNote(
        notePathInput,
      );

    const authority =
      this.getAuthority(
        note.path,
      );

    const outgoingLinks =
      uniqueSortedPaths(
        this.resolutions
          .filter(
            (resolution) =>
              resolution.reference
                .sourcePath ===
                note.path &&
              (
                resolution.status ===
                  "resolved" ||
                resolution.status ===
                  "case-mismatch"
              ) &&
              resolution.resolvedPath !==
                null &&
              this.canSurfaceRelatedPath(
                authority,
                resolution.resolvedPath,
              ),
          )
          .map(
            (resolution) =>
              resolution.resolvedPath as string,
          ),
      ).slice(
        0,
        MAX_METADATA_LINKS,
      );

    const backlinks =
      uniqueSortedPaths(
        this.resolutions
          .filter(
            (resolution) =>
              (
                resolution.status ===
                  "resolved" ||
                resolution.status ===
                  "case-mismatch"
              ) &&
              resolution.resolvedPath ===
                note.path &&
              this.canSurfaceRelatedPath(
                authority,
                resolution.reference
                  .sourcePath,
              ),
          )
          .map(
            (resolution) =>
              resolution.reference
                .sourcePath,
          ),
      ).slice(
        0,
        MAX_METADATA_LINKS,
      );

    const metadata:
      NoteMetadata = {
        path: note.path,
        title:
          getTitle(note),
        authority,

        aliases:
          presentMetadataValues(
            note.aliases,
          ),

        tags:
          presentMetadataValues(
            getTags(note),
          ),

        project:
          presentMetadataValues(
            getFrontmatterValues(
              note,
              "project",
            ),
          ),

        type:
          presentMetadataValues(
            getFrontmatterValues(
              note,
              "type",
            ),
          ),

        status:
          presentMetadataValues(
            getFrontmatterValues(
              note,
              "status",
            ),
          ),

        headings:
          note.headings
            .slice(
              0,
              MAX_METADATA_HEADINGS,
            )
            .map(
              (heading) => ({
                level:
                  heading.level,

                text:
                  truncateText(
                    heading.text,
                    MAX_METADATA_VALUE_CHARS,
                  ),
              }),
            ),

        outgoingLinks,
        backlinks,
        sizeBytes:
          note.sizeBytes,
        lineCount:
          note.lineCount,
        modifiedAt:
          new Date(
            note.mtimeMs,
          ).toISOString(),
      };

    assertPayloadWithinBudget(
      metadata,
      this.budgets
        .maxAggregateBytes,
      "get_note_metadata response",
    );

    return metadata;
  }

  /** Returns one bounded heading section, or a bounded full body only when maxChars is explicitly supplied. */
  getNoteSection(
    input: GetNoteSectionInput,
  ): NoteSectionResult {
    const note =
      this.getReadableNote(
        input.path,
      );

    const isFullNote =
      !input.heading;

    if (
      isFullNote &&
      input.maxChars === undefined
    ) {
      throw new Error(
        "maxChars is required when heading is omitted for full-note retrieval.",
      );
    }

    const extracted =
      input.heading
        ? extractSection(
            note,
            input.heading,
          )
        : {
            heading: null,
            content: note.body,
          };

    const configuredMaximum =
      isFullNote
        ? this.budgets
            .maxFullNoteChars
        : this.budgets
            .maxSectionChars;

    const requestedMaximum =
      input.maxChars ??
      configuredMaximum;

    const maxChars =
      resolveContentLimit(
        requestedMaximum,
        configuredMaximum,
        "maxChars",
      );

    const bounded =
      boundContent(
        extracted.content,
        maxChars,
      );

    const result:
      NoteSectionResult = {
        path: note.path,
        title:
          getTitle(note),
        authority:
          this.getAuthority(
            note.path,
          ),
        heading:
          extracted.heading,
        ...bounded,
      };

    return fitSectionToAggregateBudget(
      result,
      this.budgets
        .maxAggregateBytes,
    );
  }

  /** Returns authority-filtered related notes from resolved outgoing links and backlinks with mutual links ranked first. */
  getRelatedNotes(
    input: GetRelatedNotesInput,
  ): RelatedNoteResult[] {
    const note =
      this.getReadableNote(
        input.path,
      );

    const authority =
      this.getAuthority(
        note.path,
      );

    const limit =
      resolveResultLimit(
        input.limit,
        this.budgets,
      );

    const outgoing =
      new Set<string>();

    const incoming =
      new Set<string>();

    for (
      const resolution of
        this.resolutions
    ) {
      if (
        (
          resolution.status !==
            "resolved" &&
          resolution.status !==
            "case-mismatch"
        ) ||
        !resolution.resolvedPath
      ) {
        continue;
      }

      if (
        resolution.reference
          .sourcePath ===
          note.path &&
        resolution.resolvedPath !==
          note.path &&
        this.canSurfaceRelatedPath(
          authority,
          resolution.resolvedPath,
        )
      ) {
        outgoing.add(
          resolution.resolvedPath,
        );
      }

      if (
        resolution.resolvedPath ===
          note.path &&
        resolution.reference
          .sourcePath !==
          note.path &&
        this.canSurfaceRelatedPath(
          authority,
          resolution.reference
            .sourcePath,
        )
      ) {
        incoming.add(
          resolution.reference
            .sourcePath,
        );
      }
    }

    const candidatePaths =
      uniqueSortedPaths([
        ...outgoing,
        ...incoming,
      ]);

    const results =
      candidatePaths.map(
        (
          relatedPath,
        ): RelatedNoteResult => {
          const related =
            this.noteByPath.get(
              relatedPath,
            );

          if (!related) {
            throw new Error(
              `Related note disappeared from retrieval snapshot: ${relatedPath}`,
            );
          }

          const isOutgoing =
            outgoing.has(
              relatedPath,
            );

          const isIncoming =
            incoming.has(
              relatedPath,
            );

          const relatedAuthority =
            this.getAuthority(
              relatedPath,
            );

          if (
            isOutgoing &&
            isIncoming
          ) {
            return {
              path:
                related.path,
              title:
                getTitle(
                  related,
                ),
              authority:
                relatedAuthority,
              relationship:
                "mutual",
              evidence:
                "Both notes contain resolved links to each other.",
            };
          }

          if (isOutgoing) {
            return {
              path:
                related.path,
              title:
                getTitle(
                  related,
                ),
              authority:
                relatedAuthority,
              relationship:
                "outgoing",
              evidence:
                "The requested note contains a resolved link to this note.",
            };
          }

          return {
            path:
              related.path,
            title:
              getTitle(
                related,
              ),
            authority:
              relatedAuthority,
            relationship:
              "backlink",
            evidence:
              "This note contains a resolved link to the requested note.",
          };
        },
      );

    const rank:
      Record<
        RelatedNoteRelationship,
        number
      > = {
        mutual: 0,
        outgoing: 1,
        backlink: 2,
      };

    results.sort(
      (left, right) =>
        rank[
          left.relationship
        ] -
          rank[
            right.relationship
          ] ||
        compareStrings(
          left.path,
          right.path,
        ),
    );

    return boundResultCollection(
      results,
      limit,
      this.budgets
        .maxAggregateBytes,
      "get_related_notes response",
    );
  }

  /** Returns true when one related path is readable and does not expand beyond the source note's authority surface. */
  private canSurfaceRelatedPath(
    sourceAuthority:
      KnowledgeAuthority,
    candidatePath: string,
  ): boolean {
    const candidateAuthority =
      this.authorityByPath.get(
        candidatePath,
      );

    if (!candidateAuthority) {
      return false;
    }

    return canSurfaceRelatedAuthority(
      sourceAuthority,
      candidateAuthority,
    );
  }

  /** Returns the immutable authority classification for one unprotected note in the retrieval snapshot. */
  private getAuthority(
    notePath: string,
  ): KnowledgeAuthority {
    const authority =
      this.authorityByPath.get(
        notePath,
      );

    if (!authority) {
      throw new Error(
        `Authority classification missing from retrieval snapshot: ${notePath}`,
      );
    }

    return authority;
  }

  /** Resolves one exact unprotected vault-relative Markdown path without exposing permanently protected-note existence. */
  private getReadableNote(
    notePathInput: string,
  ): VaultNote {
    const notePath =
      normalizeVaultRelativePath(
        notePathInput,
        "Note path",
      );

    const note =
      this.noteByPath.get(
        notePath,
      );

    if (!note) {
      throw new Error(
        `Note not found: ${notePath}`,
      );
    }

    return note;
  }
}

/** Inventories one configured vault once and constructs the reusable transport-independent retrieval service. */
export async function createKnowledgeRetrievalService(
  options: KnowledgeRetrievalOptions,
): Promise<KnowledgeRetrievalService> {
  const inventory =
    await inventoryVault({
      vaultRoot:
        options.vaultRoot,
    });

  return new KnowledgeRetrievalService(
    inventory,
    {
      protectedPrefixes:
        options.protectedPrefixes,
      authorityPolicy:
        options.authorityPolicy,
      budgets:
        options.budgets,
    },
  );
}


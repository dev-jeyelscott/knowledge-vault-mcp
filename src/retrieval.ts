import path from "node:path";

import {
  inventoryVault,
} from "./parser.js";

import {
  resolveReferences,
} from "./reference-resolver.js";

import type {
  ReferenceResolution,
  VaultInventory,
  VaultNote,
} from "./types.js";

export const DEFAULT_PROTECTED_PREFIXES = [
  "raw",
  "evidence",
] as const;

const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 25;
const DEFAULT_SECTION_MAX_CHARS = 6_000;
const MAX_SECTION_MAX_CHARS = 16_000;
const MAX_EVIDENCE_CHARS = 180;
const MAX_METADATA_VALUES = 50;
const MAX_METADATA_VALUE_CHARS = 240;
const MAX_METADATA_HEADINGS = 200;
const MAX_METADATA_LINKS = 200;

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
}

export interface KnowledgeRetrievalServiceOptions {
  protectedPrefixes?: string[];
}

export interface SearchKnowledgeInput {
  query: string;
  project?: string;
  folder?: string;
  tags?: string[];
  type?: string;
  status?: string;
  limit?: number;
}

export interface RelevanceEvidence {
  kind: RelevanceEvidenceKind;
  text: string;
}

export interface SearchKnowledgeResult {
  path: string;
  title: string;
  score: number;
  evidence: RelevanceEvidence[];
}

export interface NoteMetadata {
  path: string;
  title: string;
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
  heading: string | null;
  content: string;
  truncated: boolean;
  charsReturned: number;
  bytesReturned: number;
  approximateTokens: number;
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
  relationship: RelatedNoteRelationship;
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

  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
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
      .some((segment) => segment === "..")
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

/** Normalizes one configured protected prefix and rejects path traversal components. */
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

  return normalizeVaultRelativePath(
    value,
    "Protected prefix",
  );
}

/** Returns true when a note is equal to or below a configured protected prefix. */
function isProtectedPath(
  notePath: string,
  protectedPrefixes: string[],
): boolean {
  const normalizedPath =
    notePath.toLowerCase();

  return protectedPrefixes.some(
    (prefix) => {
      const normalizedPrefix =
        prefix.toLowerCase();

      return (
        normalizedPath ===
          normalizedPrefix ||
        normalizedPath.startsWith(
          `${normalizedPrefix}/`,
        )
      );
    },
  );
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
      .map((item) => item.trim())
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
    .flatMap((value) =>
      value.split(","),
    )
    .map((value) =>
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

/** Returns bounded metadata values suitable for MCP responses. */
function presentMetadataValues(
  values: string[],
): string[] {
  return values
    .slice(
      0,
      MAX_METADATA_VALUES,
    )
    .map((value) =>
      truncateText(
        value,
        MAX_METADATA_VALUE_CHARS,
      ),
    );
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

/** Validates and normalizes a bounded result limit. */
function resolveLimit(
  value: number | undefined,
): number {
  const limit =
    value ?? DEFAULT_SEARCH_LIMIT;

  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_SEARCH_LIMIT
  ) {
    throw new Error(
      `Limit must be an integer between 1 and ${MAX_SEARCH_LIMIT}.`,
    );
  }

  return limit;
}

/** Adds one concise relevance evidence item while avoiding duplicate evidence. */
function addEvidence(
  evidence: RelevanceEvidence[],
  kind: RelevanceEvidenceKind,
  text: string,
): void {
  if (evidence.length >= 3) {
    return;
  }

  const presented =
    truncateText(
      text.trim(),
      MAX_EVIDENCE_CHARS,
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

/** Calculates a deterministic weighted lexical score and concise evidence for one note. */
function scoreNote(
  note: VaultNote,
  query: string,
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
    score += phrase &&
      normalizeText(
        matchingHeading,
      ).includes(phrase)
      ? 40
      : 20;

    addEvidence(
      evidence,
      "heading",
      matchingHeading,
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

/** Applies the requested character bound and reports transparent size and token-proxy metadata. */
function boundContent(
  content: string,
  maxChars: number,
): {
  content: string;
  truncated: boolean;
  charsReturned: number;
  bytesReturned: number;
  approximateTokens: number;
} {
  if (
    !Number.isInteger(maxChars) ||
    maxChars < 1 ||
    maxChars >
      MAX_SECTION_MAX_CHARS
  ) {
    throw new Error(
      `maxChars must be an integer between 1 and ${MAX_SECTION_MAX_CHARS}.`,
    );
  }

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
    approximateTokens:
      Math.ceil(
        bounded.length / 4,
      ),
  };
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

  private readonly resolutions:
    ReferenceResolution[];

  private readonly protectedPrefixes:
    string[];

  /** Builds retrieval indexes from an existing read-only inventory without modifying or rereading vault files. */
  constructor(
    inventory: VaultInventory,
    options:
      KnowledgeRetrievalServiceOptions =
        {},
  ) {
    const configuredPrefixes =
      options.protectedPrefixes ??
      [...DEFAULT_PROTECTED_PREFIXES];

    this.protectedPrefixes =
      configuredPrefixes
        .map(
          normalizeProtectedPrefix,
        )
        .filter(Boolean);

    this.notes =
      inventory.notes.filter(
        (note) =>
          !isProtectedPath(
            note.path,
            this.protectedPrefixes,
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

    const visiblePaths =
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
          visiblePaths.has(
            resolution.reference
              .sourcePath,
          ) &&
          (
            resolution.resolvedPath ===
              null ||
            visiblePaths.has(
              resolution.resolvedPath,
            )
          ),
      );
  }

  /** Searches visible notes using weighted lexical ranking, exact filters, and deterministic path tie breaking. */
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

    const limit =
      resolveLimit(
        input.limit,
      );

    const results:
      SearchKnowledgeResult[] = [];

    for (
      const note of this.notes
    ) {
      if (
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
        );

      if (ranked.score <= 0) {
        continue;
      }

      results.push({
        path: note.path,
        title:
          getTitle(note),
        score:
          ranked.score,
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

    return results.slice(
      0,
      limit,
    );
  }

  /** Returns bounded note metadata and visible resolved note-link relationships without returning the note body. */
  getNoteMetadata(
    notePathInput: string,
  ): NoteMetadata {
    const note =
      this.getVisibleNote(
        notePathInput,
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
              this.noteByPath.has(
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
              this.noteByPath.has(
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

    return {
      path: note.path,
      title:
        getTitle(note),

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
  }

  /** Returns one bounded heading section, or a bounded full body only when maxChars is explicitly supplied. */
  getNoteSection(
    input: GetNoteSectionInput,
  ): NoteSectionResult {
    const note =
      this.getVisibleNote(
        input.path,
      );

    if (
      !input.heading &&
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

    const maxChars =
      input.maxChars ??
      DEFAULT_SECTION_MAX_CHARS;

    const bounded =
      boundContent(
        extracted.content,
        maxChars,
      );

    return {
      path: note.path,
      title:
        getTitle(note),

      heading:
        extracted.heading,

      ...bounded,
    };
  }

  /** Returns related visible notes from resolved outgoing links and backlinks with mutual links ranked first. */
  getRelatedNotes(
    input: GetRelatedNotesInput,
  ): RelatedNoteResult[] {
    const note =
      this.getVisibleNote(
        input.path,
      );

    const limit =
      resolveLimit(
        input.limit,
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
        this.noteByPath.has(
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
        this.noteByPath.has(
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
              relationship:
                "outgoing",
              evidence:
                `${note.path} contains a resolved link to this note.`,
            };
          }

          return {
            path:
              related.path,
            title:
              getTitle(
                related,
              ),
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

    return results.slice(
      0,
      limit,
    );
  }

  /** Resolves one exact visible vault-relative Markdown path without exposing protected-note existence. */
  private getVisibleNote(
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
    },
  );
}

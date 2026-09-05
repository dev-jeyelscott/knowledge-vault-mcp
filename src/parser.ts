import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { VaultPathGuard } from "./path-guard.js";
import type {
  BlockReferenceRecord,
  CanvasDocument,
  FrontmatterData,
  HeadingRecord,
  VaultAsset,
  VaultInventory,
  VaultNote,
  VaultReference,
} from "./types.js";

export interface VaultParserOptions {
  vaultRoot: string;
  ignoredDirectories?: string[];
}

interface FrontmatterExtraction {
  frontmatter: FrontmatterData;
  body: string;
  bodyStartLine: number;
}

const DEFAULT_IGNORED_DIRECTORIES = [
  ".git",
  ".obsidian",
  "node_modules",
];

/** Computes a deterministic SHA-256 content hash from raw file bytes. */
function hashContent(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Extracts YAML frontmatter without altering the source file or requiring Obsidian-specific write behavior. */
function extractFrontmatter(
  content: string,
): FrontmatterExtraction {
  if (
    !content.startsWith("---\n") &&
    !content.startsWith("---\r\n")
  ) {
    return {
      frontmatter: {
        raw: null,
        data: {},
        parseError: null,
      },
      body: content,
      bodyStartLine: 1,
    };
  }

  const lines = content.split(/\r?\n/);
  let closingIndex = -1;

  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === "---" || lines[index] === "...") {
      closingIndex = index;
      break;
    }
  }

  if (closingIndex === -1) {
    return {
      frontmatter: {
        raw: null,
        data: {},
        parseError:
          "Opening frontmatter delimiter has no closing delimiter.",
      },
      body: content,
      bodyStartLine: 1,
    };
  }

  const raw = lines.slice(1, closingIndex).join("\n");
  const body = lines.slice(closingIndex + 1).join("\n");

  try {
    const parsed = YAML.parse(raw);

    const data =
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
        ? parsed
        : {};

    return {
      frontmatter: {
        raw,
        data: data as Record<string, unknown>,
        parseError: null,
      },
      body,
      bodyStartLine: closingIndex + 2,
    };
  } catch (error) {
    return {
      frontmatter: {
        raw,
        data: {},
        parseError:
          error instanceof Error
            ? error.message
            : String(error),
      },
      body,
      bodyStartLine: closingIndex + 2,
    };
  }
}

/** Normalizes alias values from common Obsidian frontmatter shapes. */
function extractAliases(
  frontmatter: Record<string, unknown>,
): string[] {
  const value =
    frontmatter.aliases ?? frontmatter.alias;

  if (typeof value === "string") {
    return [value.trim()].filter(Boolean);
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

/** Splits a local reference target from its optional heading or block fragment. */
function splitTargetFragment(
  input: string,
): {
  target: string;
  fragment: string | null;
} {
  const hashIndex = input.indexOf("#");

  if (hashIndex === -1) {
    return {
      target: input.trim(),
      fragment: null,
    };
  }

  return {
    target: input.slice(0, hashIndex).trim(),
    fragment:
      input.slice(hashIndex + 1).trim() || null,
  };
}

/** Returns false for URL-like targets because the vault audit only resolves local vault references. */
function isLocalTarget(target: string): boolean {
  const normalized = target.trim().toLowerCase();

  return !(
    normalized.startsWith("http://") ||
    normalized.startsWith("https://") ||
    normalized.startsWith("mailto:") ||
    normalized.startsWith("tel:") ||
    normalized.startsWith("data:")
  );
}

/** Decodes a Markdown link destination while leaving malformed escapes visible instead of failing the parser. */
function decodeTarget(target: string): string {
  const trimmed = target.trim();

  const withoutAngles =
    trimmed.startsWith("<") &&
    trimmed.endsWith(">")
      ? trimmed.slice(1, -1)
      : trimmed;

  const withoutTitle =
    withoutAngles.match(
      /^(\S+)(?:\s+["'(].*)?$/,
    )?.[1] ?? withoutAngles;

  try {
    return decodeURIComponent(withoutTitle);
  } catch {
    return withoutTitle;
  }
}

/** Inventories headings, block references, wikilinks, embeds, and Markdown links from one Markdown body. */
function parseMarkdownBody(
  sourcePath: string,
  body: string,
  bodyStartLine: number,
): {
  headings: HeadingRecord[];
  blockReferences: BlockReferenceRecord[];
  references: VaultReference[];
} {
  const headings: HeadingRecord[] = [];
  const blockReferences: BlockReferenceRecord[] = [];
  const references: VaultReference[] = [];
  const lines = body.split(/\r?\n/);

  let fenceCharacter: "`" | "~" | null = null;
  let fenceLength = 0;

  for (
    let index = 0;
    index < lines.length;
    index += 1
  ) {
    const line = lines[index] ?? "";
    const lineNumber = bodyStartLine + index;
    const trimmed = line.trimStart();
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);

    if (fenceCharacter) {
      if (
        fenceMatch &&
        fenceMatch[1][0] === fenceCharacter &&
        fenceMatch[1].length >= fenceLength
      ) {
        fenceCharacter = null;
        fenceLength = 0;
      }

      continue;
    }

    if (fenceMatch) {
      fenceCharacter = fenceMatch[1][0] as "`" | "~";
      fenceLength = fenceMatch[1].length;
      continue;
    }

    const headingMatch = line.match(
      /^(#{1,6})\s+(.+?)\s*$/,
    );

    if (headingMatch) {
      headings.push({
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
        line: lineNumber,
      });
    }

    const blockMatch = line.match(
      /(?:^|\s)\^([A-Za-z0-9][A-Za-z0-9_-]*)\s*$/,
    );

    if (blockMatch) {
      blockReferences.push({
        id: blockMatch[1],
        line: lineNumber,
      });
    }

    const scanLine = line.replace(
      /`[^`]*`/g,
      "",
    );

    const wikiPattern =
      /(!)?\[\[([^\]]+)\]\]/g;

    for (const match of scanLine.matchAll(wikiPattern)) {
      const rawInside = match[2] ?? "";
      const pipeIndex = rawInside.indexOf("|");

      const targetPart =
        pipeIndex === -1
          ? rawInside
          : rawInside.slice(0, pipeIndex);

      const alias =
        pipeIndex === -1
          ? null
          : rawInside
                .slice(pipeIndex + 1)
                .trim() || null;

      const { target, fragment } =
        splitTargetFragment(targetPart);

      references.push({
        kind: match[1]
          ? "embed"
          : "wikilink",
        sourcePath,
        raw: match[0],
        target,
        fragment,
        alias,
        line: lineNumber,
      });
    }

    const markdownPattern =
      /(!)?\[[^\]]*\]\(([^)]+)\)/g;

    for (const match of scanLine.matchAll(
      markdownPattern,
    )) {
      const decoded = decodeTarget(match[2] ?? "");

      const { target, fragment } =
        splitTargetFragment(decoded);

      if (!isLocalTarget(target)) {
        continue;
      }

      references.push({
        kind: match[1]
          ? "markdown-image"
          : "markdown",
        sourcePath,
        raw: match[0],
        target,
        fragment,
        alias: null,
        line: lineNumber,
      });
    }
  }

  return {
    headings,
    blockReferences,
    references,
  };
}

/** Extracts file-node references from an Obsidian Canvas document when a .canvas file is present. */
function parseCanvasReferences(
  sourcePath: string,
  content: string,
): {
  references: VaultReference[];
  parseError: string | null;
} {
  try {
    const parsed = JSON.parse(content) as {
      nodes?: unknown;
    };

    const nodes = Array.isArray(parsed.nodes)
      ? parsed.nodes
      : [];

    const references: VaultReference[] = [];

    for (const node of nodes) {
      if (
        !node ||
        typeof node !== "object"
      ) {
        continue;
      }

      const candidate = node as {
        type?: unknown;
        file?: unknown;
      };

      if (
        candidate.type === "file" &&
        typeof candidate.file === "string"
      ) {
        references.push({
          kind: "canvas",
          sourcePath,
          raw: candidate.file,
          target: candidate.file,
          fragment: null,
          alias: null,
          line: null,
        });
      }
    }

    return {
      references,
      parseError: null,
    };
  } catch (error) {
    return {
      references: [],
      parseError:
        error instanceof Error
          ? error.message
          : String(error),
    };
  }
}

/** Recursively discovers regular files without following symbolic links outside or inside the vault. */
async function walkFiles(
  guard: VaultPathGuard,
  directory: string,
  ignoredDirectories: Set<string>,
): Promise<string[]> {
  const entries = await readdir(directory, {
    withFileTypes: true,
  });

  const files: string[] = [];

  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }

    if (
      entry.isDirectory() &&
      ignoredDirectories.has(entry.name)
    ) {
      continue;
    }

    const candidate = await guard.resolveInside(
      path.join(directory, entry.name),
    );

    const candidateStat = await lstat(candidate);

    if (candidateStat.isDirectory()) {
      files.push(
        ...(await walkFiles(
          guard,
          candidate,
          ignoredDirectories,
        )),
      );
    } else if (candidateStat.isFile()) {
      files.push(candidate);
    }
  }

  return files;
}

/** Builds a transport-independent, read-only inventory of one configured vault root. */
export async function inventoryVault(
  options: VaultParserOptions,
): Promise<VaultInventory> {
  const guard = await VaultPathGuard.create(
    options.vaultRoot,
  );

  const ignoredDirectories = new Set(
    options.ignoredDirectories ??
      DEFAULT_IGNORED_DIRECTORIES,
  );

  const absoluteFiles = await walkFiles(
    guard,
    guard.root,
    ignoredDirectories,
  );

  const notes: VaultNote[] = [];
  const assets: VaultAsset[] = [];
  const canvases: CanvasDocument[] = [];
  const warnings: VaultInventory["warnings"] = [];

  for (const absolutePath of absoluteFiles) {
    const fileStat = await lstat(absolutePath);
    const relativePath =
      guard.toRelative(absolutePath);

    const extension = path
      .extname(relativePath)
      .toLowerCase();

    const bytes = await readFile(absolutePath);
    const hash = hashContent(bytes);

    if (extension === ".md") {
      const content = bytes.toString("utf8");
      const extracted =
        extractFrontmatter(content);

      const parsed = parseMarkdownBody(
        relativePath,
        extracted.body,
        extracted.bodyStartLine,
      );

      if (extracted.frontmatter.parseError) {
        warnings.push({
          path: relativePath,
          message: `Frontmatter parse error: ${extracted.frontmatter.parseError}`,
        });
      }

      notes.push({
        kind: "markdown",
        path: relativePath,
        absolutePath,
        sizeBytes: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        hash,
        frontmatter: extracted.frontmatter,
        aliases: extractAliases(
          extracted.frontmatter.data,
        ),
        headings: parsed.headings,
        blockReferences:
          parsed.blockReferences,
        references: parsed.references,
        body: extracted.body,
        lineCount:
          content.split(/\r?\n/).length,
      });

      continue;
    }

    if (extension === ".canvas") {
      const content = bytes.toString("utf8");

      const parsed = parseCanvasReferences(
        relativePath,
        content,
      );

      if (parsed.parseError) {
        warnings.push({
          path: relativePath,
          message: `Canvas parse error: ${parsed.parseError}`,
        });
      }

      canvases.push({
        kind: "canvas",
        path: relativePath,
        absolutePath,
        sizeBytes: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        hash,
        references: parsed.references,
        parseError: parsed.parseError,
      });

      continue;
    }

    assets.push({
      kind: "asset",
      path: relativePath,
      absolutePath,
      sizeBytes: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
      hash,
    });
  }

  notes.sort((left, right) =>
    left.path.localeCompare(right.path),
  );

  assets.sort((left, right) =>
    left.path.localeCompare(right.path),
  );

  canvases.sort((left, right) =>
    left.path.localeCompare(right.path),
  );

  return {
    vaultRoot: guard.root,
    notes,
    assets,
    canvases,
    warnings,
  };
}

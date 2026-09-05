import path from "node:path";
import type {
  ReferenceResolution,
  VaultInventory,
  VaultNote,
  VaultReference,
} from "./types.js";

/** Normalizes vault paths to forward slashes and removes unsafe dot segments without touching the filesystem. */
function normalizeVaultPath(input: string): string {
  const normalized = path.posix.normalize(
    input.replaceAll("\\", "/"),
  );

  return normalized
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
}

/** Produces the common heading slug shape used by Markdown links for conservative fragment validation. */
function slugHeading(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

/** Checks a resolved Markdown note for a requested heading or block fragment. */
function validateFragment(
  note: VaultNote | undefined,
  fragment: string | null,
): {
  valid: boolean;
  reason: string;
} {
  if (!fragment || !note) {
    return {
      valid: true,
      reason:
        "No Markdown fragment validation required.",
    };
  }

  if (fragment.startsWith("^")) {
    const blockId = fragment.slice(1);

    const found = note.blockReferences.some(
      (block) => block.id === blockId,
    );

    return found
      ? {
          valid: true,
          reason: `Resolved block reference ^${blockId}.`,
        }
      : {
          valid: false,
          reason: `Missing block reference ^${blockId} in ${note.path}.`,
        };
  }

  const wanted = fragment
    .trim()
    .toLowerCase();

  const found = note.headings.some(
    (heading) => {
      const text = heading.text
        .trim()
        .toLowerCase();

      return (
        text === wanted ||
        slugHeading(heading.text) === wanted
      );
    },
  );

  return found
    ? {
        valid: true,
        reason: `Resolved heading fragment #${fragment}.`,
      }
    : {
        valid: false,
        reason: `Missing heading fragment #${fragment} in ${note.path}.`,
      };
}

/** Creates exact, case-insensitive, and basename indexes for conservative Obsidian-style reference resolution. */
function buildIndexes(
  inventory: VaultInventory,
) {
  const allPaths = [
    ...inventory.notes.map(
      (item) => item.path,
    ),
    ...inventory.assets.map(
      (item) => item.path,
    ),
    ...inventory.canvases.map(
      (item) => item.path,
    ),
  ];

  const exact = new Set(allPaths);
  const lower = new Map<string, string[]>();
  const basenames =
    new Map<string, string[]>();

  for (const itemPath of allPaths) {
    const lowerKey =
      itemPath.toLowerCase();

    lower.set(lowerKey, [
      ...(lower.get(lowerKey) ?? []),
      itemPath,
    ]);

    const basename = path.posix
      .basename(
        itemPath,
        path.posix.extname(itemPath),
      )
      .toLowerCase();

    basenames.set(basename, [
      ...(basenames.get(basename) ?? []),
      itemPath,
    ]);
  }

  return {
    exact,
    lower,
    basenames,
  };
}

/** Builds ordered candidate paths using Markdown-relative and Obsidian vault-root/basename semantics. */
function buildCandidates(
  reference: VaultReference,
): string[] {
  if (!reference.target) {
    return reference.fragment
      ? [reference.sourcePath]
      : [];
  }

  const target = normalizeVaultPath(
    reference.target,
  );

  const sourceDirectory =
    path.posix.dirname(
      reference.sourcePath,
    );

  const hasExtension =
    path.posix.extname(target) !== "";

  const candidates: string[] = [];

  if (reference.kind === "canvas") {
    candidates.push(target);
  } else if (
    reference.kind === "markdown" ||
    reference.kind === "markdown-image"
  ) {
    const relative = normalizeVaultPath(
      path.posix.join(
        sourceDirectory,
        target,
      ),
    );

    candidates.push(relative);

    if (!hasExtension) {
      candidates.push(`${relative}.md`);
    }

    candidates.push(target);

    if (!hasExtension) {
      candidates.push(`${target}.md`);
    }
  } else {
    const relative = normalizeVaultPath(
      path.posix.join(
        sourceDirectory,
        target,
      ),
    );

    candidates.push(relative, target);

    if (!hasExtension) {
      candidates.push(
        `${relative}.md`,
        `${target}.md`,
      );
    }
  }

  return [...new Set(candidates)];
}

/** Resolves every local vault reference without reading or modifying any target file. */
export function resolveReferences(
  inventory: VaultInventory,
): ReferenceResolution[] {
  const indexes = buildIndexes(inventory);

  const noteByPath = new Map(
    inventory.notes.map((note) => [
      note.path,
      note,
    ]),
  );

  const references = [
    ...inventory.notes.flatMap(
      (note) => note.references,
    ),
    ...inventory.canvases.flatMap(
      (canvas) => canvas.references,
    ),
  ];

  const resolutions:
    ReferenceResolution[] = [];

  for (const reference of references) {
    const candidates =
      buildCandidates(reference);

    const exactMatches =
      candidates.filter((candidate) =>
        indexes.exact.has(candidate),
      );

    if (exactMatches.length === 1) {
      const resolvedPath =
        exactMatches[0];

      const fragment = validateFragment(
        noteByPath.get(resolvedPath),
        reference.fragment,
      );

      resolutions.push({
        reference,
        status: fragment.valid
          ? "resolved"
          : "broken",
        resolvedPath,
        candidates: exactMatches,
        reason: fragment.reason,
      });

      continue;
    }

    if (exactMatches.length > 1) {
      resolutions.push({
        reference,
        status: "ambiguous",
        resolvedPath: null,
        candidates: exactMatches,
        reason:
          `Reference has multiple exact resolution candidates: ` +
          exactMatches.join(", "),
      });

      continue;
    }

    const caseMatches = [
      ...new Set(
        candidates.flatMap(
          (candidate) =>
            indexes.lower.get(
              candidate.toLowerCase(),
            ) ?? [],
        ),
      ),
    ];

    if (caseMatches.length === 1) {
      const resolvedPath =
        caseMatches[0];

      const fragment = validateFragment(
        noteByPath.get(resolvedPath),
        reference.fragment,
      );

      resolutions.push({
        reference,
        status: fragment.valid
          ? "case-mismatch"
          : "broken",
        resolvedPath,
        candidates: caseMatches,
        reason: fragment.valid
          ? `Reference casing differs from the actual path ${resolvedPath}.`
          : fragment.reason,
      });

      continue;
    }

    if (caseMatches.length > 1) {
      resolutions.push({
        reference,
        status: "ambiguous",
        resolvedPath: null,
        candidates: caseMatches,
        reason:
          `Case-insensitive reference matches multiple paths: ` +
          caseMatches.join(", "),
      });

      continue;
    }

    if (
      reference.kind === "wikilink" ||
      reference.kind === "embed"
    ) {
      const basenameKey = path.posix
        .basename(
          reference.target,
          path.posix.extname(
            reference.target,
          ),
        )
        .toLowerCase();

      const basenameMatches =
        basenameKey
          ? indexes.basenames.get(
              basenameKey,
            ) ?? []
          : [];

      if (basenameMatches.length === 1) {
        const resolvedPath =
          basenameMatches[0];

        const fragment =
          validateFragment(
            noteByPath.get(resolvedPath),
            reference.fragment,
          );

        resolutions.push({
          reference,
          status: fragment.valid
            ? "resolved"
            : "broken",
          resolvedPath,
          candidates: basenameMatches,
          reason: fragment.valid
            ? `Resolved unique vault basename ${basenameKey}.`
            : fragment.reason,
        });

        continue;
      }

      if (basenameMatches.length > 1) {
        resolutions.push({
          reference,
          status: "ambiguous",
          resolvedPath: null,
          candidates: basenameMatches,
          reason:
            `Wikilink basename ${basenameKey} is ambiguous across ` +
            `${basenameMatches.length} files.`,
        });

        continue;
      }
    }

    resolutions.push({
      reference,
      status: "broken",
      resolvedPath: null,
      candidates,
      reason:
        `No local vault target resolves for ${reference.raw}.`,
    });
  }

  return resolutions;
}

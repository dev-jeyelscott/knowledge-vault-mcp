import { access, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** Expands a leading tilde so CLI paths behave predictably on Ubuntu and WSL. */
export function expandHome(input: string): string {
  if (input === "~") {
    return homedir();
  }

  if (input.startsWith(`~${path.sep}`) || input.startsWith("~/")) {
    return path.join(homedir(), input.slice(2));
  }

  return input;
}

/** Returns true when the candidate path is the vault root or a descendant of it. */
export function isPathContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);

  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

/** Finds the nearest existing ancestor so output paths can be checked through symlinked parent directories. */
async function nearestExistingAncestor(input: string): Promise<string> {
  let current = input;

  while (true) {
    try {
      await access(current, constants.F_OK);
      return current;
    } catch {
      const parent = path.dirname(current);

      if (parent === current) {
        return current;
      }

      current = parent;
    }
  }
}

/** Enforces resolved-path containment for every path used by the read-only vault parser. */
export class VaultPathGuard {
  private constructor(public readonly root: string) {}

  /** Creates a guard from an existing directory and canonicalizes the root with realpath. */
  static async create(rootInput: string): Promise<VaultPathGuard> {
    const expanded = path.resolve(expandHome(rootInput));
    const root = await realpath(expanded);
    const rootStat = await stat(root);

    if (!rootStat.isDirectory()) {
      throw new Error(`Vault root is not a directory: ${rootInput}`);
    }

    return new VaultPathGuard(root);
  }

  /** Resolves a vault-relative path and rejects lexical or symlink escapes outside the configured root. */
  async resolveInside(relativeOrAbsolute: string): Promise<string> {
    const expanded = expandHome(relativeOrAbsolute);
    const lexical = path.isAbsolute(expanded)
      ? path.resolve(expanded)
      : path.resolve(this.root, expanded);

    if (!isPathContained(this.root, lexical)) {
      throw new Error(
        `Path escapes configured vault root: ${relativeOrAbsolute}`,
      );
    }

    try {
      await access(lexical, constants.F_OK);

      const canonical = await realpath(lexical);

      if (!isPathContained(this.root, canonical)) {
        throw new Error(
          `Resolved path escapes configured vault root: ${relativeOrAbsolute}`,
        );
      }

      return canonical;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("Resolved path escapes")
      ) {
        throw error;
      }

      return lexical;
    }
  }

  /** Converts an already-contained absolute path to a normalized slash-separated vault-relative path. */
  toRelative(absolutePath: string): string {
    if (!isPathContained(this.root, absolutePath)) {
      throw new Error(
        `Path is outside configured vault root: ${absolutePath}`,
      );
    }

    return path
      .relative(this.root, absolutePath)
      .split(path.sep)
      .join("/");
  }

  /** Resolves an external report path and rejects lexical or symlink-mediated destinations inside the vault. */
  async resolveOutsideVault(outputPath: string): Promise<string> {
    const absolute = path.resolve(expandHome(outputPath));

    if (isPathContained(this.root, absolute)) {
      throw new Error(
        `Output path must be outside the vault: ${outputPath}`,
      );
    }

    const ancestor = await nearestExistingAncestor(absolute);
    const canonicalAncestor = await realpath(ancestor);
    const suffix = path.relative(ancestor, absolute);
    const canonicalDestination = path.resolve(
      canonicalAncestor,
      suffix,
    );

    if (isPathContained(this.root, canonicalDestination)) {
      throw new Error(
        `Resolved output path must be outside the vault: ${outputPath}`,
      );
    }

    return absolute;
  }
}

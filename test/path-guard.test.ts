import {
  mkdtemp,
  mkdir,
  symlink,
  writeFile,
} from "node:fs/promises";

import { tmpdir } from "node:os";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  VaultPathGuard,
} from "../src/path-guard.js";

describe(
  "VaultPathGuard",
  () => {
    it(
      "allows contained paths and rejects lexical and symlink escapes",
      async () => {
        const base =
          await mkdtemp(
            path.join(
              tmpdir(),
              "vault-guard-",
            ),
          );

        const vault =
          path.join(
            base,
            "vault",
          );

        const outside =
          path.join(
            base,
            "outside.txt",
          );

        await mkdir(vault);

        await writeFile(
          path.join(
            vault,
            "note.md",
          ),
          "# Note\n",
          "utf8",
        );

        await writeFile(
          outside,
          "outside\n",
          "utf8",
        );

        await symlink(
          outside,
          path.join(
            vault,
            "escape-link",
          ),
        );

        const guard =
          await VaultPathGuard.create(
            vault,
          );

        await expect(
          guard.resolveInside(
            "note.md",
          ),
        ).resolves.toBe(
          path.join(
            vault,
            "note.md",
          ),
        );

        await expect(
          guard.resolveInside(
            "../outside.txt",
          ),
        ).rejects.toThrow(
          "escapes configured vault root",
        );

        await expect(
          guard.resolveInside(
            "escape-link",
          ),
        ).rejects.toThrow(
          "Resolved path escapes configured vault root",
        );
      },
    );

    it(
      "rejects external-looking report paths whose symlinked parent resolves back into the vault",
      async () => {
        const base =
          await mkdtemp(
            path.join(
              tmpdir(),
              "vault-output-",
            ),
          );

        const vault =
          path.join(
            base,
            "vault",
          );

        const externalAlias =
          path.join(
            base,
            "reports",
          );

        await mkdir(vault);

        await symlink(
          vault,
          externalAlias,
        );

        const guard =
          await VaultPathGuard.create(
            vault,
          );

        await expect(
          guard.resolveOutsideVault(
            path.join(
              externalAlias,
              "audit.json",
            ),
          ),
        ).rejects.toThrow(
          "Resolved output path must be outside the vault",
        );

        await expect(
          guard.resolveOutsideVault(
            path.join(
              base,
              "safe",
              "audit.json",
            ),
          ),
        ).resolves.toBe(
          path.join(
            base,
            "safe",
            "audit.json",
          ),
        );
      },
    );
  },
);

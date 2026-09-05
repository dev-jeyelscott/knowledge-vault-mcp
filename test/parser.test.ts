import {
  fileURLToPath,
} from "node:url";

import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  inventoryVault,
} from "../src/parser.js";

const fixtureRoot = path.join(
  path.dirname(
    fileURLToPath(
      import.meta.url,
    ),
  ),
  "fixtures",
  "basic",
);

describe(
  "inventoryVault",
  () => {
    it(
      "inventories Markdown metadata, local references, assets, and Canvas references without internal Obsidian files",
      async () => {
        const inventory =
          await inventoryVault({
            vaultRoot:
              fixtureRoot,
          });

        expect(
          inventory.notes,
        ).toHaveLength(11);

        expect(
          inventory.assets.map(
            (asset) =>
              asset.path,
          ),
        ).toEqual([
          "assets/pic.png",
          "assets/unused.bin",
        ]);

        expect(
          inventory.canvases,
        ).toHaveLength(1);

        expect(
          inventory.notes.some(
            (note) =>
              note.path.startsWith(
                ".obsidian/",
              ),
          ),
        ).toBe(false);

        const index =
          inventory.notes.find(
            (note) =>
              note.path ===
              "Index.md",
          );

        expect(
          index?.frontmatter
            .data.title,
        ).toBe("Vault Home");

        expect(
          index?.aliases,
        ).toContain("Home");

        expect(
          index?.headings,
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              level: 1,
              text: "Vault Home",
            }),
          ]),
        );

        expect(
          index?.references,
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              kind: "wikilink",
              target: "Note",
              fragment:
                "Heading One",
              alias:
                "primary note",
            }),

            expect.objectContaining({
              kind: "embed",
              target:
                "assets/pic.png",
            }),

            expect.objectContaining({
              kind: "markdown",
              target:
                "missing.md",
            }),
          ]),
        );

        const note =
          inventory.notes.find(
            (item) =>
              item.path ===
              "Note.md",
          );

        expect(
          note?.blockReferences,
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "block-one",
            }),
          ]),
        );

        expect(
          inventory.canvases[0]
            ?.references,
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              kind: "canvas",
              target:
                "Note.md",
            }),

            expect.objectContaining({
              kind: "canvas",
              target:
                "assets/pic.png",
            }),
          ]),
        );
      },
    );
  },
);

# knowledge-vault-mcp

Small TypeScript/Node application for read-only Obsidian-style vault inventory, auditing, and cleanup-review manifests.

## Boundaries

- One configured vault root.
- Read-only vault access.
- Resolved-path containment with symlink escape rejection.
- No write operations inside the vault.
- No vector search.
- No HTTP transport.
- No ORC-specific workflow or data model.
- `.git`, `.obsidian`, and `node_modules` directories are ignored by default.

## Commands

```bash
pnpm dev -- inventory --vault "$HOME/workspace/my-vault"

pnpm dev -- audit \
  --vault "$HOME/workspace/my-vault"

pnpm dev -- audit \
  --vault "$HOME/workspace/my-vault" \
  --output /tmp/knowledge-vault-audit.json

pnpm dev -- review \
  --report /tmp/knowledge-vault-audit.json \
  --output /tmp/knowledge-vault-cleanup-manifest.json \
  --protected-prefix raw \
  --protected-prefix evidence \
  --historical-prefix archive \
  --historical-prefix history

audit --output and review --output reject destinations inside the configured vault.
```

## Audit heuristics

- Exact duplicates require identical raw SHA-256 hashes.
- Near duplicates require at least 500 body characters, at least 0.80 length ratio, and at least 0.88 Jaccard similarity across normalized 5-token shingles.
- Broken references are unresolved local Markdown, wikilink, embed, Canvas, heading, or block references.
- Orphans have no resolved inbound vault references and remain review candidates, not deletion instructions.
- Duplicate index variants are multiple index.md, _index.md, home.md, or readme.md files in one directory.
- Oversized notes exceed 64 KiB or 1,200 lines by default.
- Generated-output candidates require explicit generated markers in frontmatter, path, filename, or opening content.
- STATE.md, Tasks.md, Task.md, and TODO.md become stale candidates after 45 days without modification by default.
- Authority conflicts are collisions among normalized note basenames, frontmatter titles, or aliases, plus ambiguous references.

The cleanup manifest never applies changes. Every future removal or merge candidate includes a reason and an external backup or version-control recovery instruction.

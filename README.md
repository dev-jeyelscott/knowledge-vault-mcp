# knowledge-vault-mcp

Small TypeScript/Node application for read-only Obsidian-style vault inventory, auditing, cleanup-review manifests, bounded knowledge retrieval, and MCP stdio access.

## Boundaries

- One configured vault root per process.
- Read-only vault access.
- Resolved-path containment with symlink escape rejection.
- No write operations inside the vault.
- No vector search.
- No HTTP transport.
- No ORC-specific workflow or data model.
- `.git`, `.obsidian`, and `node_modules` directories are ignored by the parser by default.
- `raw` and `evidence` are excluded from retrieval by default.
- Protected retrieval prefixes can be configured at process startup.
- MCP tool calls cannot change the configured vault root or protected prefixes.

## Install

```bash
pnpm install
pnpm build
```

The built package exposes:

```text
knowledge-vault
knowledge-vault-mcp
```

`knowledge-vault` provides the existing inventory, audit, and review CLI.

`knowledge-vault-mcp` provides the read-only MCP stdio server.

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
```

`audit --output` and `review --output` reject destinations inside the configured vault.

## MCP stdio

Configure the vault root through process configuration rather than MCP tool input.

```bash
export KNOWLEDGE_VAULT_ROOT="<configured-vault-root>"
export KNOWLEDGE_VAULT_PROTECTED_PREFIXES="raw,evidence"

pnpm mcp
```

The server indexes the vault once at process startup. Restart the MCP process when the underlying vault should be reloaded.

Operational logs and startup failures are written to stderr. Stdout is reserved for MCP protocol traffic.

## MCP tools

### `search_knowledge`

Lexically searches visible notes.

Supported input:

- `query`
- `project`
- `folder`
- `tags`
- `type`
- `status`
- `limit`

Search ordering is deterministic for an unchanged vault. Results include a vault-relative path, title, numeric score, and up to three concise relevance evidence items.

### `get_note_metadata`

Returns bounded metadata for one exact vault-relative note path.

The response can include:

- title
- aliases
- tags
- project
- type
- status
- headings
- resolved outgoing note links
- backlinks
- size
- line count
- modified timestamp

The note body is not returned.

### `get_note_section`

Returns one bounded Markdown section by heading.

Prefer:

```json
{
  "path": "Projects/Example/Overview.md",
  "heading": "Architecture"
}
```

A section defaults to a 6,000-character maximum and can never exceed 16,000 characters.

Full-note body retrieval is supported only when the caller supplies an explicit `maxChars` value:

```json
{
  "path": "Projects/Example/Overview.md",
  "maxChars": 4000
}
```

Responses report returned characters, UTF-8 bytes, a transparent approximate token proxy, and whether truncation occurred.

### `get_related_notes`

Uses the resolved vault link graph.

Ordering is:

1. mutual links
2. outgoing links
3. backlinks
4. vault-relative path as the deterministic tie breaker

Protected notes are never returned.

## Protected retrieval areas

The default protected prefixes are:

```text
raw
evidence
```

Override them only through process configuration:

```bash
export KNOWLEDGE_VAULT_PROTECTED_PREFIXES="raw,evidence,private"
```

The MCP tools intentionally provide no `includeProtected`, `vaultRoot`, or similar override.

## Claude Code configuration

Build the package and make `knowledge-vault-mcp` available on `PATH`, for example through your local package-management workflow.

Configure the vault through environment variables:

```bash
export KNOWLEDGE_VAULT_ROOT="<configured-vault-root>"
export KNOWLEDGE_VAULT_PROTECTED_PREFIXES="raw,evidence"
```

A project `.mcp.json` can then use the standalone command:

```json
{
  "mcpServers": {
    "knowledge-vault": {
      "type": "stdio",
      "command": "knowledge-vault-mcp",
      "args": [],
      "env": {
        "KNOWLEDGE_VAULT_ROOT": "${KNOWLEDGE_VAULT_ROOT}",
        "KNOWLEDGE_VAULT_PROTECTED_PREFIXES": "${KNOWLEDGE_VAULT_PROTECTED_PREFIXES}"
      }
    }
  }
}
```

Do not commit a user-specific absolute vault path.

After starting Claude Code, use `/mcp` to confirm the server is connected and the four tools are visible.

## Codex configuration

Keep the values in the process environment:

```bash
export KNOWLEDGE_VAULT_ROOT="<configured-vault-root>"
export KNOWLEDGE_VAULT_PROTECTED_PREFIXES="raw,evidence"
```

Configure Codex to launch the standalone command and inherit those values:

```toml
[mcp_servers.knowledge_vault]
command = "knowledge-vault-mcp"
env_vars = [
  "KNOWLEDGE_VAULT_ROOT",
  "KNOWLEDGE_VAULT_PROTECTED_PREFIXES"
]
```

Use Codex MCP inspection commands or `/mcp` to verify the four tools are available.

## Future ORC configuration

ORC should consume this standalone MCP through configuration. It should not implement its own vault parser, search engine, link resolver, or retrieval service.

Its existing MCP configuration can eventually include an additional entry similar to:

```json
{
  "mcpServers": {
    "shadcn": {
      "command": "npx",
      "args": [
        "shadcn@latest",
        "mcp"
      ]
    },
    "knowledge-vault": {
      "type": "stdio",
      "command": "knowledge-vault-mcp",
      "args": [],
      "env": {
        "KNOWLEDGE_VAULT_ROOT": "${KNOWLEDGE_VAULT_ROOT}",
        "KNOWLEDGE_VAULT_PROTECTED_PREFIXES": "${KNOWLEDGE_VAULT_PROTECTED_PREFIXES}"
      }
    }
  }
}
```

This is a future consumer configuration example only. No ORC-specific implementation belongs in this repository.

## Generic Node client

A Node consumer only needs MCP process configuration and the MCP tool contracts.

```ts
import {
  Client,
} from "@modelcontextprotocol/client";

import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/client/stdio";

const vaultRoot =
  process.env
    .KNOWLEDGE_VAULT_ROOT;

if (!vaultRoot) {
  throw new Error(
    "KNOWLEDGE_VAULT_ROOT is required.",
  );
}

const transport =
  new StdioClientTransport({
    command:
      "knowledge-vault-mcp",

    env: {
      ...getDefaultEnvironment(),

      KNOWLEDGE_VAULT_ROOT:
        vaultRoot,

      KNOWLEDGE_VAULT_PROTECTED_PREFIXES:
        process.env
          .KNOWLEDGE_VAULT_PROTECTED_PREFIXES ??
        "raw,evidence",
    },
  });

const client =
  new Client({
    name:
      "knowledge-consumer",
    version: "1.0.0",
  });

await client.connect(
  transport,
);

const {
  tools,
} =
  await client.listTools();

console.log(
  tools.map(
    (tool) =>
      tool.name,
  ),
);

const result =
  await client.callTool({
    name:
      "search_knowledge",

    arguments: {
      query:
        "orchestration",
      limit: 5,
    },
  });

console.log(result);

await client.close();
```

The consumer does not need to know how Markdown, frontmatter, Obsidian links, aliases, protected paths, or vault containment are implemented.

## Laravel integration boundary

Laravel should treat this application as an external MCP capability.

For stdio integration, configuration should provide:

```text
command=knowledge-vault-mcp
KNOWLEDGE_VAULT_ROOT=<configured externally>
KNOWLEDGE_VAULT_PROTECTED_PREFIXES=raw,evidence
```

A PHP-side MCP client may spawn that configured process and call its MCP tools.

Do not duplicate the TypeScript vault parser, lexical ranking, section extraction, protection policy, or link-graph logic in Laravel.

If a future HTTP transport is required, add an HTTP adapter around the same transport-neutral retrieval service instead of implementing a Laravel-specific knowledge service.

## MCP Inspector

The official MCP Inspector can exercise the stdio server interactively:

```bash
export KNOWLEDGE_VAULT_ROOT="<configured-vault-root>"
export KNOWLEDGE_VAULT_PROTECTED_PREFIXES="raw,evidence"

npx @modelcontextprotocol/inspector node dist/mcp-stdio.js
```

The Inspector should list exactly:

```text
search_knowledge
get_note_metadata
get_note_section
get_related_notes
```

## Audit heuristics

- Exact duplicates require identical raw SHA-256 hashes.
- Near duplicates require at least 500 body characters, at least 0.80 length ratio, and at least 0.88 Jaccard similarity across normalized 5-token shingles.
- Broken references are unresolved local Markdown, wikilink, embed, Canvas, heading, or block references.
- Orphans have no resolved inbound vault references and remain review candidates, not deletion instructions.
- Duplicate index variants are multiple `index.md`, `_index.md`, `home.md`, or `readme.md` files in one directory.
- Oversized notes exceed 64 KiB or 1,200 lines by default.
- Generated-output candidates require explicit generated markers in frontmatter, path, filename, or opening content.
- `STATE.md`, `Tasks.md`, `Task.md`, and `TODO.md` become stale candidates after 45 days without modification by default.
- Authority conflicts are collisions among normalized note basenames, frontmatter titles, or aliases, plus ambiguous references.

The cleanup manifest never applies changes. Every future removal or merge candidate includes a reason and an external backup or version-control recovery instruction.

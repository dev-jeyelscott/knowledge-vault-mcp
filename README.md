# knowledge-vault-mcp

Small TypeScript/Node application for read-only Obsidian-style vault inventory, auditing, cleanup-review manifests, authority-aware bounded knowledge retrieval, and MCP stdio access.

## Boundaries

- One configured vault root per process.
- Read-only vault access.
- Resolved-path containment with symlink escape rejection.
- No write operations inside the vault.
- No vector search or embeddings.
- No HTTP transport.
- No ORC-specific workflow or data model.
- `.git`, `.obsidian`, and `node_modules` directories are ignored by the parser by default.
- Retrieval uses an immutable vault inventory snapshot created at process startup.
- Normal automatic search is limited to Tier 1 curated knowledge.
- Tier 2 historical material requires an explicit `tier2` search scope.
- Approved Tier 3 raw/source evidence requires an explicit `source` search scope or a deliberate exact-note read.
- Tier 3 excluded material never enters automatic search. An exact path can still be read unless the path is permanently protected.
- Permanent protected prefixes are a separate access-control mechanism and cannot be bypassed through any MCP input.
- MCP tool calls cannot change the configured vault root, authority policy, budgets, or protected prefixes.
- Every returned knowledge payload is bounded inside the retrieval service before MCP serialization.

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
  --protected-prefix private \
  --historical-prefix archive \
  --historical-prefix history
```

`audit --output` and `review --output` reject destinations inside the configured vault.

## MCP stdio

Configure the vault root through process configuration rather than MCP tool input.

```bash
export KNOWLEDGE_VAULT_ROOT="<configured-vault-root>"

pnpm mcp
```

The server indexes the vault once at process startup. Restart the MCP process when the underlying vault or retrieval configuration should be reloaded.

Operational logs and startup failures are written to stderr. Stdout is reserved for MCP protocol traffic.

## Recommended retrieval flow

Use progressive retrieval instead of loading full notes by default:

1. Call `search_knowledge` without a scope. This searches Tier 1 only.
2. Call `get_note_metadata` for one selected exact path.
3. Call `get_note_section` with a heading for the specific detail needed.
4. Use `scope: "tier2"` only when historical rationale, reviews, roadmaps, handoffs, or phase material is required.
5. Use `scope: "source"` only when raw/source evidence is intentionally required.
6. Use full-note retrieval only when a section is insufficient and always provide an explicit `maxChars`.

## Authority model

Authority is path-based, deterministic, case-consistent, configuration-driven, and does not require configured directories to exist.

### Tier 1, default searchable

Default patterns include:

```text
Projects/*/Project Overview.md
Projects/*/Overview.md
Projects/*/Decisions/**
Projects/*/Lessons/**
Projects/*/Runbook.md
Projects/*/Runbooks/**
wiki/**
```

`Projects/*/Overview.md` and project runbooks remain Tier 1 for compatibility with the current cleaned fixture and existing related-note behavior. Override the policy if a vault uses stricter curated paths.

### Tier 2, explicit historical search

Default patterns include:

```text
Projects/*/Roadmaps/**
Projects/*/Roadmap*.md
Projects/*/Reviews/**
Projects/*/Review*.md
Projects/*/Phase Reviews/**
Projects/*/Task Briefs/**
Projects/*/Handoffs/**
Projects/*/Phases/**
wiki/Sources/**
wiki/Source Material/**
```

Tier 2 is returned only when `search_knowledge` receives `scope: "tier2"`. Tier 1 remains eligible in that scope so historical retrieval can still rank curated context alongside history.

### Tier 3 source, explicit source search

Default source patterns are:

```text
raw/**
evidence/**
**/raw/**
**/evidence/**
```

Tier 3 source notes never enter default or Tier 2 search. They are searchable only with `scope: "source"`, and an exact unprotected path can also be read deliberately through metadata or section tools.

### Tier 3 excluded, automatic-search excluded

Default excluded patterns include:

```text
Inbox/**
Generated/**
Outputs/**
Logs/**
Templates/**
**/Inbox/**
**/Generated/**
**/Outputs/**
**/Logs/**
**/Templates/**
Tasks.md
STATE.md
Tasks/**
STATE/**
**/Tasks.md
**/STATE.md
**/Tasks/**
**/STATE/**
```

Unmatched paths also fall back to Tier 3 `exact-read-only`. This prevents a newly added or unknown folder from entering automatic search accidentally.

Excluded does not mean permanently inaccessible. An exact unprotected path may still be read intentionally. Use protected prefixes for permanent access denial.

### Authority precedence

When patterns overlap, the classification order is deliberately restrictive:

1. excluded Tier 3
2. source Tier 3
3. Tier 2
4. Tier 1
5. unmatched fallback to excluded Tier 3

This lets `wiki/**` remain broadly curated while `wiki/Sources/**` is still classified as Tier 2.

## MCP tools

### `search_knowledge`

Lexically searches notes that are eligible for the requested authority scope.

Supported input:

- `query`
- `project`
- `folder`
- `tags`
- `type`
- `status`
- `scope`
- `limit`

Supported scopes:

```text
default   Tier 1 only
tier2     Tier 1 plus Tier 2
source    approved Tier 3 source material only
```

Authority filtering is applied before folder, project, tag, type, or status filters. A broad folder cannot bypass the requested authority scope.

Search ordering remains deterministic for an unchanged vault and keeps the existing lexical weighting for title, headings, aliases, tags, frontmatter metadata, body, and path. Results include only:

- vault-relative path
- title
- authority metadata
- numeric lexical score
- compact project/tag/type/status metadata
- up to three small bounded evidence excerpts

Default result count is intentionally small and all result count, excerpt, and aggregate response sizes are service-bounded.

### `get_note_metadata`

Returns bounded metadata for one exact unprotected vault-relative note path.

The response can include:

- title
- authority metadata
- aliases
- tags
- project
- type
- status
- headings
- authority-safe resolved outgoing note links
- authority-safe backlinks
- size
- line count
- modified timestamp

The note body is not returned. Tier 1 metadata cannot surface Tier 2 or Tier 3 paths through outgoing links or backlinks.

### `get_note_section`

Returns one bounded Markdown section by heading from an exact unprotected path.

Prefer:

```json
{
  "path": "Projects/Example/Project Overview.md",
  "heading": "Architecture"
}
```

The default section maximum is configurable and defaults to 6,000 characters. The hard safety ceiling is 16,000 characters.

Full-note body retrieval is supported only when the caller supplies an explicit `maxChars` value:

```json
{
  "path": "Projects/Example/Project Overview.md",
  "maxChars": 4000
}
```

Full-note reads use a separate configurable limit that defaults to 8,000 characters and has a 16,000-character hard ceiling.

Responses report actual `charsReturned`, actual UTF-8 `bytesReturned`, and whether truncation occurred. No token estimate is exposed because token accounting is model-specific and belongs to the consuming system.

### `get_related_notes`

Uses the resolved vault link graph for one exact unprotected note.

Ordering is:

1. mutual links
2. outgoing links
3. backlinks
4. vault-relative path as the deterministic tie breaker

Related-note visibility is authority-aware. A Tier 1 note can surface only Tier 1 related notes. A Tier 2 note can surface Tier 1 and Tier 2 related notes. A source note cannot surface exact-read-only excluded material. Protected notes are never returned.

## Retrieval budgets

Defaults work without configuration:

```text
default search results: 5
maximum requested search results: 10
maximum evidence text per search result: 360 characters
maximum section content: 6000 characters
maximum full-note content: 8000 characters
maximum aggregate knowledge payload: 65536 UTF-8 bytes
```

Hard safety ceilings prevent environment configuration from making MCP responses effectively unbounded:

```text
search results: 25
search evidence text per result: 1000 characters
section content: 16000 characters
full-note content: 16000 characters
aggregate knowledge payload: 131072 UTF-8 bytes
```

The aggregate payload minimum is 16,384 bytes so metadata envelopes can remain useful. Invalid values fail during service construction or MCP startup.

Optional environment overrides:

```bash
export KNOWLEDGE_VAULT_DEFAULT_SEARCH_LIMIT=5
export KNOWLEDGE_VAULT_MAX_SEARCH_RESULTS=10
export KNOWLEDGE_VAULT_SEARCH_EXCERPT_CHARS=360
export KNOWLEDGE_VAULT_MAX_SECTION_CHARS=6000
export KNOWLEDGE_VAULT_MAX_FULL_NOTE_CHARS=8000
export KNOWLEDGE_VAULT_MAX_PAYLOAD_BYTES=65536
```

Character limits are used where text must be sliced. Aggregate transport knowledge size uses UTF-8 byte accounting.

## Authority path configuration

The default authority patterns can be replaced per process with comma-separated vault-relative patterns:

```bash
export KNOWLEDGE_VAULT_AUTHORITY_TIER1_PATTERNS="Projects/*/Project Overview.md,Projects/*/Decisions/**,Projects/*/Lessons/**,wiki/**"
export KNOWLEDGE_VAULT_AUTHORITY_TIER2_PATTERNS="Projects/*/Roadmaps/**,Projects/*/Reviews/**,Projects/*/Handoffs/**,Projects/*/Phases/**,wiki/Sources/**"
export KNOWLEDGE_VAULT_AUTHORITY_SOURCE_PATTERNS="raw/**,evidence/**"
export KNOWLEDGE_VAULT_AUTHORITY_EXCLUDED_PATTERNS="Inbox/**,Generated/**,Outputs/**,Logs/**,Templates/**,**/Tasks.md,**/STATE.md"
```

The pattern language intentionally supports only:

```text
*   zero or more characters within one path segment
**  zero or more characters across path segments
```

Patterns are normalized using Unicode NFKC and compared case-insensitively. They are configuration rules only, so startup does not require every configured directory to exist.

## Protected retrieval areas

Protected prefixes are separate from authority tiers. They represent true access denial and cannot be bypassed by default search, `tier2`, `source`, exact metadata reads, section reads, or related-note traversal.

There are no protected prefixes by default because `raw` and `evidence` are classified as explicit Tier 3 source material. Configure permanent private areas explicitly when the vault has them:

```bash
export KNOWLEDGE_VAULT_PROTECTED_PREFIXES="private,secrets"
```

If an operator intentionally sets:

```bash
export KNOWLEDGE_VAULT_PROTECTED_PREFIXES="raw,evidence"
```

then those areas become permanently inaccessible, including through `scope: "source"`. The MCP tools provide no `includeProtected`, `vaultRoot`, or similar override.

## Claude Code configuration

Build the package and make `knowledge-vault-mcp` available on `PATH`, for example through your local package-management workflow.

Configure the vault through environment variables:

```bash
export KNOWLEDGE_VAULT_ROOT="<configured-vault-root>"
export KNOWLEDGE_VAULT_PROTECTED_PREFIXES="private,secrets"
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
export KNOWLEDGE_VAULT_PROTECTED_PREFIXES="private,secrets"
```

Configure Codex to launch the standalone command and inherit those values:

```toml
[mcp_servers.knowledge_vault]
command = "knowledge-vault-mcp"
env_vars = [
  "KNOWLEDGE_VAULT_ROOT",
  "KNOWLEDGE_VAULT_PROTECTED_PREFIXES",
  "KNOWLEDGE_VAULT_DEFAULT_SEARCH_LIMIT",
  "KNOWLEDGE_VAULT_MAX_SEARCH_RESULTS",
  "KNOWLEDGE_VAULT_SEARCH_EXCERPT_CHARS",
  "KNOWLEDGE_VAULT_MAX_SECTION_CHARS",
  "KNOWLEDGE_VAULT_MAX_FULL_NOTE_CHARS",
  "KNOWLEDGE_VAULT_MAX_PAYLOAD_BYTES"
]
```

Add authority-pattern environment variables to `env_vars` only when the defaults are overridden.

Use Codex MCP inspection commands or `/mcp` to verify the four tools are available.

## Future ORC configuration

ORC should consume this standalone MCP through configuration. It should not implement its own vault parser, search engine, link resolver, authority policy, or retrieval service.

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
        "KNOWLEDGE_VAULT_ROOT": "${KNOWLEDGE_VAULT_ROOT}"
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
        "",
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

The consumer does not need to know how Markdown, frontmatter, Obsidian links, aliases, authority patterns, protected paths, budgets, or vault containment are implemented.

## Laravel integration boundary

Laravel should treat this application as an external MCP capability.

For stdio integration, configuration should provide:

```text
command=knowledge-vault-mcp
KNOWLEDGE_VAULT_ROOT=<configured externally>
```

A PHP-side MCP client may spawn that configured process and call its MCP tools.

Do not duplicate the TypeScript vault parser, lexical ranking, section extraction, authority policy, protection policy, or link-graph logic in Laravel.

If a future HTTP transport is required, add an HTTP adapter around the same transport-neutral retrieval service instead of implementing a Laravel-specific knowledge service.

## MCP Inspector

The official MCP Inspector can exercise the stdio server interactively:

```bash
export KNOWLEDGE_VAULT_ROOT="<configured-vault-root>"

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


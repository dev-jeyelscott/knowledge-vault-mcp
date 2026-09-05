#!/usr/bin/env node

import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";

import path from "node:path";

import {
  auditInventory,
} from "./audit.js";

import {
  buildCleanupManifest,
} from "./manifest.js";

import {
  inventoryVault,
} from "./parser.js";

import {
  VaultPathGuard,
  expandHome,
} from "./path-guard.js";

import type {
  AuditReport,
  VaultInventory,
} from "./types.js";

interface ParsedArguments {
  command: string | null;
  values: Map<string, string[]>;
}

/** Parses simple repeated --key value arguments without adding a CLI framework dependency. */
function parseArguments(
  argv: string[],
): ParsedArguments {
  const [command = null, ...rest] =
    argv;

  const values =
    new Map<string, string[]>();

  for (
    let index = 0;
    index < rest.length;
    index += 1
  ) {
    const token = rest[index];

    if (!token?.startsWith("--")) {
      throw new Error(
        `Unexpected argument: ${token}`,
      );
    }

    const key = token.slice(2);
    const value = rest[index + 1];

    if (
      !value ||
      value.startsWith("--")
    ) {
      throw new Error(
        `Missing value for --${key}`,
      );
    }

    values.set(key, [
      ...(values.get(key) ?? []),
      value,
    ]);

    index += 1;
  }

  return {
    command,
    values,
  };
}

/** Returns one required CLI argument value and rejects missing or duplicate single-value arguments. */
function requiredSingle(
  args: ParsedArguments,
  key: string,
): string {
  const values =
    args.values.get(key) ?? [];

  if (values.length !== 1) {
    throw new Error(
      `Expected exactly one --${key} value.`,
    );
  }

  return values[0];
}

/** Returns one optional numeric argument after strict finite-number validation. */
function optionalNumber(
  args: ParsedArguments,
  key: string,
): number | undefined {
  const values =
    args.values.get(key) ?? [];

  if (values.length === 0) {
    return undefined;
  }

  if (values.length !== 1) {
    throw new Error(
      `Expected at most one --${key} value.`,
    );
  }

  const parsed =
    Number(values[0]);

  if (!Number.isFinite(parsed)) {
    throw new Error(
      `--${key} must be a finite number.`,
    );
  }

  return parsed;
}

/** Produces a safe inventory representation without dumping note bodies or internal absolute file paths. */
function presentInventory(
  inventory: VaultInventory,
): Record<string, unknown> {
  return {
    vaultRoot:
      inventory.vaultRoot,

    notes:
      inventory.notes.map(
        ({
          absolutePath:
            _absolutePath,
          body: _body,
          ...note
        }) => note,
      ),

    assets:
      inventory.assets.map(
        ({
          absolutePath:
            _absolutePath,
          ...asset
        }) => asset,
      ),

    canvases:
      inventory.canvases.map(
        ({
          absolutePath:
            _absolutePath,
          ...canvas
        }) => canvas,
      ),

    warnings:
      inventory.warnings,
  };
}

/** Writes structured JSON only to a caller-selected path that is already validated as outside the vault. */
async function writeJson(
  outputPath: string,
  payload: unknown,
): Promise<void> {
  await mkdir(
    path.dirname(outputPath),
    {
      recursive: true,
    },
  );

  await writeFile(
    outputPath,
    `${JSON.stringify(
      payload,
      null,
      2,
    )}\n`,
    "utf8",
  );
}

/** Reads a previously generated audit report with the minimum schema checks needed by the review command. */
async function readAuditReport(
  reportPathInput: string,
): Promise<AuditReport> {
  const reportPath =
    path.resolve(
      expandHome(reportPathInput),
    );

  const parsed = JSON.parse(
    await readFile(
      reportPath,
      "utf8",
    ),
  ) as Partial<AuditReport>;

  if (
    parsed.schemaVersion !== 1 ||
    typeof parsed.vaultRoot !==
      "string" ||
    !Array.isArray(parsed.findings)
  ) {
    throw new Error(
      `Unsupported or invalid audit report: ${reportPathInput}`,
    );
  }

  return parsed as AuditReport;
}

/** Runs the inventory command and prints structured JSON to stdout without writing any vault file. */
async function runInventory(
  args: ParsedArguments,
): Promise<void> {
  const vaultRoot =
    requiredSingle(
      args,
      "vault",
    );

  const inventory =
    await inventoryVault({
      vaultRoot,
    });

  process.stdout.write(
    `${JSON.stringify(
      presentInventory(inventory),
      null,
      2,
    )}\n`,
  );
}

/** Runs the audit command and either prints JSON or writes one explicit external JSON report. */
async function runAudit(
  args: ParsedArguments,
): Promise<void> {
  const vaultRoot =
    requiredSingle(
      args,
      "vault",
    );

  const inventory =
    await inventoryVault({
      vaultRoot,
    });

  const report = auditInventory(
    inventory,
    {
      staleAfterDays:
        optionalNumber(
          args,
          "stale-days",
        ),

      oversizedBytes:
        optionalNumber(
          args,
          "max-bytes",
        ),

      oversizedLines:
        optionalNumber(
          args,
          "max-lines",
        ),

      nearDuplicateThreshold:
        optionalNumber(
          args,
          "near-threshold",
        ),
    },
  );

  const outputValues =
    args.values.get("output") ?? [];

  if (outputValues.length === 0) {
    process.stdout.write(
      `${JSON.stringify(
        report,
        null,
        2,
      )}\n`,
    );

    return;
  }

  if (outputValues.length !== 1) {
    throw new Error(
      "Expected at most one --output value.",
    );
  }

  const guard =
    await VaultPathGuard.create(
      report.vaultRoot,
    );

  const outputPath =
    await guard.resolveOutsideVault(
      outputValues[0],
    );

  await writeJson(
    outputPath,
    report,
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        reportPath:
          outputPath,
        summary:
          report.summary,
      },
      null,
      2,
    )}\n`,
  );
}

/** Builds a reviewed cleanup manifest outside the vault and never applies any repair, removal, merge, or archive action. */
async function runReview(
  args: ParsedArguments,
): Promise<void> {
  const reportPath =
    requiredSingle(
      args,
      "report",
    );

  const outputInput =
    requiredSingle(
      args,
      "output",
    );

  const report =
    await readAuditReport(
      reportPath,
    );

  const guard =
    await VaultPathGuard.create(
      report.vaultRoot,
    );

  const outputPath =
    await guard.resolveOutsideVault(
      outputInput,
    );

  const manifest =
    buildCleanupManifest(
      report,
      {
        protectedPrefixes:
          args.values.get(
            "protected-prefix",
          ) ?? [],

        historicalPrefixes:
          args.values.get(
            "historical-prefix",
          ) ?? [],
      },
    );

  await writeJson(
    outputPath,
    manifest,
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        manifestPath:
          outputPath,
        items:
          manifest.items.length,
      },
      null,
      2,
    )}\n`,
  );
}

/** Prints concise CLI usage for the three read-only application operations. */
function printUsage(): void {
  process.stdout.write(
    "knowledge-vault commands:\n\n",
  );

  process.stdout.write(
    "  inventory --vault <path>\n",
  );

  process.stdout.write(
    "  audit --vault <path> [--output <external.json>] " +
      "[--stale-days <n>] [--max-bytes <n>] " +
      "[--max-lines <n>] [--near-threshold <0..1>]\n",
  );

  process.stdout.write(
    "  review --report <external-audit.json> " +
      "--output <external-manifest.json> " +
      "[--protected-prefix <vault-relative-path>]... " +
      "[--historical-prefix <vault-relative-path>]...\n",
  );
}

/** Dispatches the requested CLI command while keeping all vault operations read-only. */
async function main(): Promise<void> {
  const args = parseArguments(
    process.argv.slice(2),
  );

  switch (args.command) {
    case "inventory":
      await runInventory(args);
      return;

    case "audit":
      await runAudit(args);
      return;

    case "review":
      await runReview(args);
      return;

    case "help":
    case "--help":
    case "-h":
    case null:
      printUsage();
      return;

    default:
      throw new Error(
        `Unknown command: ${args.command}`,
      );
  }
}

main().catch(
  (error: unknown) => {
    process.stderr.write(
      `${
        error instanceof Error
          ? error.message
          : String(error)
      }\n`,
    );

    process.exitCode = 1;
  },
);

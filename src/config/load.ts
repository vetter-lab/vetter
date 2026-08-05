import YAML from "yaml";
import type { RuntimeMode } from "../core/types.js";
import { deepMerge } from "./merge.js";
import { assertNoSecretKeys, reviewConfigSchema, type ReviewConfig } from "./schema.js";

export interface ConfigInput {
  repositoryText?: string;
  external?: unknown;
  runtime?: RuntimeMode;
}

/**
 * Built-in defaults applied before any repository or external override.
 * `events.push.requireOpenPullRequest` is fixed to `true` here and is
 * re-checked explicitly below so no configuration layer can turn it off.
 */
export const builtInDefaults = {
  version: 1,
  review: {
    enabled: true,
    incremental: true,
    model: "gpt-4o-mini",
    maxDiffBytes: 200_000
  },
  events: {
    push: {
      enabled: true,
      requireOpenPullRequest: true,
      branchPatterns: ["**"]
    }
  },
  severity: {
    critical: { blockMerge: false },
    major: { blockMerge: false },
    minor: { blockMerge: false }
  },
  analyzers: [] as string[],
  limits: {
    modelRetries: 2,
    analyzerTimeoutMs: 30_000,
    maxAnalyzerOutputBytes: 1_000_000
  }
};

const ALLOWED_ANALYZERS = new Set(["semgrep", "eslint", "ruff", "golangci-lint"]);

/**
 * Parses repository-supplied `.vetter.yml` text into a plain object,
 * rejecting non-object YAML roots and any secret-shaped keys.
 */
export function parseRepositoryYaml(text: string): Record<string, unknown> {
  if (text.trim().length === 0) {
    return {};
  }

  const parsed = YAML.parse(text);

  if (parsed === null || parsed === undefined) {
    return {};
  }

  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("repository configuration YAML must parse to a mapping (object) at the root");
  }

  assertNoSecretKeys(parsed);

  return parsed as Record<string, unknown>;
}

export function loadConfig(input: ConfigInput): ReviewConfig {
  const defaults = builtInDefaults;
  const repository = parseRepositoryYaml(input.repositoryText ?? "");
  const merged = deepMerge(defaults, repository, input.external ?? {}) as Record<string, unknown>;

  const events = merged.events as { push?: { requireOpenPullRequest?: unknown } } | undefined;
  if (events?.push?.requireOpenPullRequest !== true) {
    throw new Error(
      "events.push.requireOpenPullRequest cannot be disabled by configuration; it must remain true"
    );
  }

  const analyzers = merged.analyzers;
  if (Array.isArray(analyzers)) {
    for (const analyzer of analyzers) {
      if (!ALLOWED_ANALYZERS.has(analyzer as string)) {
        throw new Error(
          `configuration lists an analyzer that is not in the allowed analyzer set: ${String(analyzer)}`
        );
      }
    }
  }

  const parsed = reviewConfigSchema.parse(merged);

  if (parsed.runtime && parsed.runtime !== input.runtime) {
    throw new Error(`runtime ${input.runtime} is disabled by configuration`);
  }

  return parsed;
}

import YAML from "yaml";
import type { RuntimeMode } from "./types.js";
import { deepMerge } from "./merge.js";
import { migrateSeverityConfigLayer } from "./migrate.js";
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
    language: "en",
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
    P0: { blockMerge: false },
    P1: { blockMerge: false },
    P2: { blockMerge: false },
    P3: { blockMerge: false }
  },
  limits: {
    modelRetries: 2
  }
};

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
  const repository = migrateSeverityConfigLayer(parseRepositoryYaml(input.repositoryText ?? ""));
  const external = migrateSeverityConfigLayer(input.external ?? {});
  const merged = deepMerge(defaults, repository, external) as Record<string, unknown>;

  const events = merged.events as { push?: { requireOpenPullRequest?: unknown } } | undefined;
  if (events?.push?.requireOpenPullRequest !== true) {
    throw new Error(
      "events.push.requireOpenPullRequest cannot be disabled by configuration; it must remain true"
    );
  }

  if (Object.prototype.hasOwnProperty.call(merged, "analyzers")) {
    throw new Error("static analyzers are no longer supported; remove the analyzers configuration");
  }

  const parsed = reviewConfigSchema.parse(merged);

  if (parsed.runtime && parsed.runtime !== input.runtime) {
    throw new Error(`runtime ${input.runtime} is disabled by configuration`);
  }

  return parsed;
}

import YAML from "yaml";
import type { RuntimeMode } from "./types.js";
import { builtInDefaults, defaultConfig } from "./defaults.js";
import { deepMerge } from "./merge.js";
import { migrateSeverityConfigLayer } from "./migrate.js";
import { assertNoSecretKeys, reviewConfigSchema, type ReviewConfig } from "./schema.js";

export interface ConfigInput {
  repositoryText?: string;
  external?: unknown;
  runtime?: RuntimeMode;
}

/**
 * Parses user-supplied YAML text into a plain object, rejecting non-object
 * roots and any secret-shaped keys.
 */
export function parseConfigYaml(text: string): Record<string, unknown> {
  if (text.trim().length === 0) {
    return {};
  }

  const parsed = YAML.parse(text);

  if (parsed === null || parsed === undefined) {
    return {};
  }

  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("configuration YAML must parse to a mapping (object) at the root");
  }

  assertNoSecretKeys(parsed);

  return parsed as Record<string, unknown>;
}

export function loadConfig(input: ConfigInput): ReviewConfig {
  const repository = migrateSeverityConfigLayer(parseConfigYaml(input.repositoryText ?? ""));
  const external = migrateSeverityConfigLayer(input.external ?? {});
  const merged = deepMerge(defaultConfig, repository, external) as Record<string, unknown>;

  const events = merged.events as { push?: { requireOpenPullRequest?: unknown } } | undefined;
  if (events?.push?.requireOpenPullRequest !== true) {
    throw new Error(
      "events.push.requireOpenPullRequest cannot be disabled by configuration; it must remain true"
    );
  }

  const parsed = reviewConfigSchema.parse(merged);

  if (parsed.runtime && parsed.runtime !== input.runtime) {
    throw new Error(`runtime ${input.runtime} is disabled by configuration`);
  }

  return parsed;
}

/** @deprecated Use parseConfigYaml for repository and workflow configuration. */
export const parseRepositoryYaml = parseConfigYaml;

export { builtInDefaults };

import type { ReviewConfig } from "./schema.js";

/**
 * Built-in configuration shared by the App and Action runtimes.
 * Provider credentials are intentionally not part of this object.
 */
export const defaultConfig = {
  version: 1,
  review: {
    enabled: true,
    incremental: true,
    model: "gpt-4o-mini",
    baseUrl: "https://api.openai.com/v1",
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
} satisfies Omit<ReviewConfig, "runtime">;

// Keep the old name available to callers that imported it from load.ts.
export const builtInDefaults = defaultConfig;

import { z } from "zod";

const severityRule = z.object({ blockMerge: z.boolean() });

export const reviewConfigSchema = z.object({
  version: z.literal(1),
  runtime: z.enum(["app", "action"]).optional(),
  review: z.object({
    enabled: z.boolean(),
    incremental: z.literal(true),
    model: z.string().min(1),
    maxDiffBytes: z.number().int().positive()
  }),
  events: z.object({
    push: z.object({
      enabled: z.boolean(),
      requireOpenPullRequest: z.literal(true),
      branchPatterns: z.array(z.string().min(1))
    })
  }),
  severity: z.object({
    critical: severityRule,
    major: severityRule,
    minor: severityRule
  }),
  analyzers: z.array(z.enum(["semgrep", "eslint", "ruff", "golangci-lint"])),
  limits: z.object({
    modelRetries: z.number().int().min(0).max(3),
    analyzerTimeoutMs: z.number().int().positive(),
    maxAnalyzerOutputBytes: z.number().int().positive()
  })
});

export type ReviewConfig = z.infer<typeof reviewConfigSchema>;

/**
 * Repository-supplied `.vetter.yml` must never carry provider secrets.
 * Any key that looks like it holds a credential is rejected outright so
 * that secrets stay in runtime environment variables instead.
 */
const SECRET_KEY_PATTERN = /^(api[-_]?key|private[-_]?key|token|secret)$/i;

export function assertNoSecretKeys(value: unknown, path: string[] = []): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretKeys(item, [...path, String(index)]));
    return;
  }

  if (value !== null && typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        throw new Error(
          `repository configuration contains a disallowed secret-shaped key: ${[...path, key].join(".")}`
        );
      }
      assertNoSecretKeys(nested, [...path, key]);
    }
  }
}

import type { ReviewConfig } from "../config/schema.js";
import type { SummaryRow } from "./reconcile.js";

export interface CheckRunEvaluation {
  conclusion: "success" | "failure";
  title: string;
  summary: string;
}

export interface EvaluateCheckRunInput {
  rows: SummaryRow[];
  config: ReviewConfig;
  failures: Array<{ provider: string; message: string }>;
}

const SEVERITIES = ["critical", "major", "minor"] as const;

/**
 * A provider failure always fails the Check Run: since `reconcileFindings`
 * never closes findings for an incomplete scope, a `success` conclusion
 * must mean every configured provider actually finished.
 */
export function evaluateCheckRun(input: EvaluateCheckRunInput): CheckRunEvaluation {
  if (input.failures.length > 0) {
    return {
      conclusion: "failure",
      title: "Vetter review failed",
      summary: [
        "One or more review providers failed to complete. No findings were closed for the affected scope.",
        "",
        ...input.failures.map((failure) => `- **${failure.provider}**: ${failure.message}`)
      ].join("\n")
    };
  }

  const openFindings = input.rows.filter((row) => row.state === "open");
  const blocking = openFindings.some((finding) => input.config.severity[finding.severity].blockMerge);

  const title = blocking
    ? `Vetter found ${String(openFindings.length)} open finding(s) blocking merge`
    : openFindings.length > 0
      ? `Vetter found ${String(openFindings.length)} open finding(s)`
      : "Vetter found no open findings";

  const summary = [
    `Open findings: ${String(openFindings.length)}`,
    "",
    ...SEVERITIES.map((severity) => {
      const count = openFindings.filter((finding) => finding.severity === severity).length;
      const blocks = input.config.severity[severity].blockMerge;
      return `- **${severity}**: ${String(count)} open (blocks merge: ${String(blocks)})`;
    })
  ].join("\n");

  return { conclusion: blocking ? "failure" : "success", title, summary };
}

import type { SummaryRow } from "../reconciliation/reconcile.js";
import { SEVERITIES } from "../severity.js";
import type { Severity } from "../types.js";
import { getReviewOutputLabels } from "../language.js";

export interface CheckRunEvaluation {
  conclusion: "success" | "failure";
  title: string;
  summary: string;
}

export type SeverityPolicy = Readonly<Record<Severity, { blockMerge: boolean }>>;

export interface EvaluateCheckRunInput {
  rows: SummaryRow[];
  severity: SeverityPolicy;
  failures: Array<{ provider: string; message: string }>;
  language?: string;
}

/**
 * An LLM failure always fails the Check Run: since `reconcileFindings` never
 * closes findings for an incomplete scope, a `success` conclusion means the
 * configured LLM review finished.
 */
export function evaluateCheckRun(input: EvaluateCheckRunInput): CheckRunEvaluation {
  const labels = getReviewOutputLabels(input.language);
  if (input.failures.length > 0) {
    return {
      conclusion: "failure",
      title: labels.checkRun.failedTitle,
      summary: [
        labels.checkRun.failedSummary,
        "",
        ...input.failures.map((failure) => `- **${failure.provider}**: ${failure.message}`)
      ].join("\n")
    };
  }

  const openFindings = input.rows.filter((row) => row.state === "open");
  const blocking = openFindings.some((finding) => input.severity[finding.severity].blockMerge);

  const title = blocking
    ? labels.checkRun.blockingTitle(openFindings.length)
    : openFindings.length > 0
      ? labels.checkRun.openTitle(openFindings.length)
      : labels.checkRun.emptyTitle;

  const summary = [
    `${labels.checkRun.openFindings}: ${String(openFindings.length)}`,
    "",
    ...SEVERITIES.map((severity) => {
      const count = openFindings.filter((finding) => finding.severity === severity).length;
      const blocks = input.severity[severity].blockMerge;
      return `- **${severity}**: ${String(count)} ${labels.checkRun.openFindings.toLowerCase()} (${labels.checkRun.blocksMerge}: ${blocks ? labels.checkRun.yes : labels.checkRun.no})`;
    })
  ].join("\n");

  return { conclusion: blocking ? "failure" : "success", title, summary };
}

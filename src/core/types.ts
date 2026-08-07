export type Severity = "P0" | "P1" | "P2" | "P3";
export type ReviewSource = "llm" | "semgrep" | "eslint" | "ruff" | "golangci-lint";
export type FindingState = "open" | "fixed" | "suppressed";
export type RuntimeMode = "app" | "action";

export interface ReviewContext {
  repository: { owner: string; name: string; fullName: string };
  pullRequestNumber: number;
  baseSha: string;
  headSha: string;
  eventId: string;
  source: "pull_request" | "pull_request_review_thread" | "push";
}

export interface FindingDraft {
  ruleId: string;
  severity: Severity;
  title: string;
  body: string;
  path: string;
  line: number;
  codeAnchor: string;
  source: ReviewSource;
  scopeKey: string;
}

export interface Finding extends FindingDraft {
  fingerprint: string;
}

export interface ExistingFinding {
  fingerprint: string;
  ruleId: string;
  source: ReviewSource;
  scopeKey: string;
  severity: Severity;
  title: string;
  body: string;
  path: string;
  line: number | null;
  commentId: number;
  threadId: string | null;
  isResolved: boolean;
  resolvedByLogin: string | null;
  lastAction: "created" | "updated" | "bot-resolved" | null;
  state: FindingState;
}

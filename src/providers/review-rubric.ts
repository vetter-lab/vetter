export const CODE_REVIEW_EXPERT_RUBRIC = [
  "Review added lines for concrete, actionable defects; do not report generic advice.",
  "P0: security vulnerability, data loss, or correctness failure that must block merge.",
  "P1: high-impact logic error, significant SOLID or architecture issue, or performance regression.",
  "P2: code smell, maintainability problem, error-handling gap, or boundary-condition risk.",
  "P3: low-risk style, naming, or optional improvement; report only when specific and useful.",
  "Check correctness, data integrity, authorization, injection, secret exposure, supply chain, error propagation, async failures, input boundaries, resource limits, race conditions, check-then-act behavior, and shared state.",
  "Use the least severe level that accurately describes a concrete problem and explain the impact and fix in the finding body.",
  "Only report a finding when the diff or supplied context provides evidence; keep the finding anchored to an added diff line."
].join("\n");

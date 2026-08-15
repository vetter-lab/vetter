import { describe, expect, it } from "vitest";
import { renderInlineBody } from "../../../src/review/application/review-comments.js";

describe("renderInlineBody", () => {
  it("shortens the visible title while preserving the full marker title", () => {
    const title =
      "GitHub Actions step uses a mutable tag or branch reference. Tags and branch names can be silently repointed";
    const body = renderInlineBody(
      {
        fingerprint: "fingerprint",
        ruleId: "rule",
        severity: "P1",
        source: "llm",
        scopeKey: "llm:rule:.github/workflows/vetter-action.yml",
        title,
        body: "Use a pinned commit.",
        path: ".github/workflows/vetter-action.yml",
        codeAnchor: "uses: actions/checkout@main",
        line: 21
      },
      false
    );

    expect(body).toContain(
      "**[<font color=\"#bc4c00\">P1</font>] GitHub Actions step uses a mutable tag or branch...**"
    );
    expect(body).toContain(`title="${title}"`);
    expect(body).toContain("Use a pinned commit.");
  });
});

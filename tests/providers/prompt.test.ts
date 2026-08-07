import { describe, expect, it } from "vitest";
import { buildReviewPrompt } from "../../src/providers/prompt.js";

describe("buildReviewPrompt", () => {
  it("includes the adapted rubric and canonical JSON severity contract", () => {
    const prompt = buildReviewPrompt({ diff: "+const value = 1;", contextFiles: [], model: "test" });

    expect(prompt.system).toContain("P0");
    expect(prompt.system).toContain("P1");
    expect(prompt.system).toContain("P2");
    expect(prompt.system).toContain("P3");
    expect(prompt.system).toContain("SOLID");
    expect(prompt.system).toContain("race conditions");
    expect(prompt.system).toContain('"severity": "P0" | "P1" | "P2" | "P3"');
    expect(prompt.system).toContain("UNTRUSTED DATA");
  });
});

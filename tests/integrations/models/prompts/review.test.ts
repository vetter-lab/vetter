import { describe, expect, it } from "vitest";
import { buildReviewPrompt } from "../../../../src/integrations/models/prompts/review/index.js";

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

  it("redacts repository secrets before interpolation", () => {
    const prompt = buildReviewPrompt({
      diff: "+const token = 'sk-12345678901234567890';",
      contextFiles: [{ path: "config.ts", content: "Authorization: Bearer abc.def.ghi" }],
      model: "test"
    });

    expect(prompt.user).toContain("[REDACTED]");
    expect(prompt.user).not.toContain("sk-12345678901234567890");
    expect(prompt.user).not.toContain("Bearer abc.def.ghi");
  });

  it("keeps diff and context inside explicit untrusted markers", () => {
    const prompt = buildReviewPrompt({
      diff: "+const value = 1;",
      contextFiles: [{ path: "src/example.ts", content: "export const value = 1;" }],
      model: "test"
    });

    expect(prompt.user).toContain("--- BEGIN UNTRUSTED DIFF ---");
    expect(prompt.user).toContain("--- END UNTRUSTED DIFF ---");
    expect(prompt.user).toContain("--- BEGIN UNTRUSTED FILE (src/example.ts) ---");
    expect(prompt.user).toContain("--- END UNTRUSTED FILE (src/example.ts) ---");
  });

  it("keeps prompt sections in the current order", () => {
    const prompt = buildReviewPrompt({ diff: "+const value = 1;", contextFiles: [], model: "test" });

    expect(prompt.system.indexOf("Review rubric:")).toBeGreaterThanOrEqual(0);
    expect(prompt.system.indexOf("Review rubric:")).toBeLessThan(
      prompt.system.indexOf("Respond with a single JSON object")
    );
    expect(prompt.system.indexOf("Respond with a single JSON object")).toBeLessThan(
      prompt.system.indexOf("- Output ONLY the JSON object described above.")
    );
  });
});

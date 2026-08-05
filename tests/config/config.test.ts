import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/load.js";

describe("loadConfig", () => {
  it("merges defaults, repository config, and external overrides in that order", () => {
    const result = loadConfig({
      repositoryText: "review:\n  model: repo-model\n",
      external: { review: { model: "external-model" } }
    });

    expect(result.review.model).toBe("external-model");
    expect(result.review.incremental).toBe(true);
    expect(result.severity.major.blockMerge).toBe(false);
  });

  it("rejects a repository config that attempts to disable the open-PR requirement", () => {
    expect(() =>
      loadConfig({
        repositoryText: "events:\n  push:\n    requireOpenPullRequest: false\n"
      })
    ).toThrowError(/requireOpenPullRequest/);
  });

  it("rejects an analyzer that is not in the allowlist", () => {
    expect(() =>
      loadConfig({
        repositoryText: "analyzers:\n  - arbitrary-shell\n"
      })
    ).toThrowError(/analyzer/);
  });
});

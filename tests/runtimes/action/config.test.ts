import { describe, expect, it } from "vitest";
import { loadActionConfig } from "../../../src/runtimes/action/config.js";

describe("loadActionConfig", () => {
  it("merges workflow config above repository config and built-in defaults", () => {
    const result = loadActionConfig({
      repositoryText: [
        "review:",
        "  model: repository-model",
        "  baseUrl: https://repository.example/v1",
        "  language: zh-CN",
        "limits:",
        "  modelRetries: 1"
      ].join("\n"),
      workflowText: [
        "review:",
        "  model: workflow-model",
        "  baseUrl: https://workflow.example/v1",
        "events:",
        "  push:",
        "    branchPatterns:",
        "      - main"
      ].join("\n")
    });

    expect(result.review.model).toBe("workflow-model");
    expect(result.review.baseUrl).toBe("https://workflow.example/v1");
    expect(result.review.language).toBe("zh-CN");
    expect(result.limits.modelRetries).toBe(1);
    expect(result.events.push.branchPatterns).toEqual(["main"]);
  });

  it("lets direct workflow inputs override workflow YAML", () => {
    const result = loadActionConfig({
      workflowText: [
        "review:",
        "  model: yaml-model",
        "  baseUrl: https://yaml.example/v1"
      ].join("\n"),
      model: "input-model",
      baseUrl: "https://input.example/v1"
    });

    expect(result.review.model).toBe("input-model");
    expect(result.review.baseUrl).toBe("https://input.example/v1");
  });

  it("rejects a secret-shaped key in workflow configuration", () => {
    expect(() =>
      loadActionConfig({ workflowText: "review:\n  apiKey: do-not-commit\n" })
    ).toThrowError(/disallowed secret-shaped key/);
  });
});

import { describe, expect, it } from "vitest";
import {
  createOpenAiCompatibleModelProvider,
  type ChatCompletionCreator
} from "../../../src/integrations/models/openai-compatible.js";

const DIFF = [
  "diff --git a/src/example.ts b/src/example.ts",
  "index 1111111..2222222 100644",
  "--- a/src/example.ts",
  "+++ b/src/example.ts",
  "@@ -9,6 +9,7 @@",
  " line9",
  " line10",
  " line11",
  "+line12 added",
  " line13",
  " line14",
  " line15"
].join("\n");

function completion(path: string, line: number, severity = "P1") {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            findings: [
              {
                ruleId: "example-rule",
                severity,
                title: "Example finding",
                body: "Fix the added line.",
                path,
                line,
                codeAnchor: "line12 added"
              }
            ]
          })
        }
      }
    ]
  };
}

describe("createOpenAiCompatibleModelProvider", () => {
  it("retries invalid paths and corrects a line using the code anchor", async () => {
    const responses = [
      completion("src/not-in-diff.ts", 12),
      completion("src/example.ts", 13),
      completion("src/example.ts", 12)
    ];
    let attempts = 0;
    const createCompletion: ChatCompletionCreator = async () => {
      attempts += 1;
      return responses.shift()!;
    };
    const provider = createOpenAiCompatibleModelProvider(
      { apiKey: "test", maxRetries: 2 },
      createCompletion
    );

    const result = await provider.review({ diff: DIFF, contextFiles: [], model: "test-model" });

    expect(attempts).toBe(2);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ path: "src/example.ts", line: 12 });
  });

  it("retries a model response that uses a legacy severity label", async () => {
    const responses = [completion("src/example.ts", 12, "major"), completion("src/example.ts", 12, "P3")];
    let attempts = 0;
    const createCompletion: ChatCompletionCreator = async () => {
      attempts += 1;
      return responses.shift()!;
    };
    const provider = createOpenAiCompatibleModelProvider(
      { apiKey: "test", maxRetries: 1 },
      createCompletion
    );

    const result = await provider.review({ diff: DIFF, contextFiles: [], model: "test-model" });

    expect(attempts).toBe(2);
    expect(result.findings[0]?.severity).toBe("P3");
  });
});

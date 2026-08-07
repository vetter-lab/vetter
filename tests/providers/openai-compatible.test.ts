import { describe, expect, it } from "vitest";
import {
  createOpenAiCompatibleModelProvider,
  type ChatCompletionCreator
} from "../../src/providers/openai-compatible.js";

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

function completion(path: string, line: number) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            findings: [
              {
                ruleId: "example-rule",
                severity: "major",
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
  it("retries findings whose path or line is outside the added diff lines", async () => {
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

    expect(attempts).toBe(3);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ path: "src/example.ts", line: 12 });
  });
});

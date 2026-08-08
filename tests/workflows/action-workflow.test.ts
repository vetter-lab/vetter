import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { expect, test } from "vitest";

const workflowPath = fileURLToPath(new URL("../../examples/vetter-action.yml", import.meta.url));

test("shares one concurrency group between push and pull request runs", () => {
  const workflow = YAML.parse(readFileSync(workflowPath, "utf8")) as {
    concurrency?: { group?: string };
  };

  expect(workflow.concurrency?.group).toBe(
    "vetter-${{ github.repository }}-${{ github.head_ref || github.ref_name }}"
  );
});

test("does not include pull_request_review_comment or pull_request_review_thread triggers", () => {
  const workflow = YAML.parse(readFileSync(workflowPath, "utf8")) as {
    on?: Record<string, unknown>;
  };

  expect(workflow.on?.pull_request_review_comment).toBeUndefined();
  expect(workflow.on?.pull_request_review_thread).toBeUndefined();
});

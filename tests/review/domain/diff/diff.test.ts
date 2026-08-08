import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findReviewAnchor } from "../../../../src/review/domain/diff/anchor.js";
import { parseChangedFiles } from "../../../../src/review/domain/diff/parser.js";

const fixturePath = fileURLToPath(new URL("../../../fixtures/example.patch", import.meta.url));
const fixtureFile = readFileSync(fixturePath, "utf8");

describe("parseChangedFiles / findReviewAnchor", () => {
  it("returns a RIGHT anchor only for a line added to the current diff", () => {
    const diff = parseChangedFiles([fixtureFile]);

    expect(findReviewAnchor(diff, "src/example.ts", 12)).toEqual({
      path: "src/example.ts",
      line: 12,
      side: "RIGHT"
    });
  });

  it("corrects a model line using a unique code anchor", () => {
    const diff = parseChangedFiles([fixtureFile]);

    expect(
      findReviewAnchor(diff, "src/example.ts", 13, {
        codeAnchor: "line12 added",
        requireCodeAnchor: true
      })
    ).toEqual({
      path: "src/example.ts",
      line: 12,
      side: "RIGHT"
    });
  });

  it("rejects an LLM finding whose code anchor is not in the added diff", () => {
    const diff = parseChangedFiles([fixtureFile]);

    expect(
      findReviewAnchor(diff, "src/example.ts", 12, {
        codeAnchor: "not present",
        requireCodeAnchor: true
      })
    ).toBeNull();
  });

  it("returns null when a finding line is outside the current diff", () => {
    const diff = parseChangedFiles([fixtureFile]);

    expect(findReviewAnchor(diff, "src/example.ts", 3)).toBeNull();
  });

  it("returns null for a path that isn't part of the diff", () => {
    const diff = parseChangedFiles([fixtureFile]);

    expect(findReviewAnchor(diff, "src/unknown.ts", 12)).toBeNull();
  });

  it("records a deleted-only file with removed lines and no added lines", () => {
    const diff = parseChangedFiles([fixtureFile]);
    const removedFile = diff.find((file) => file.path === "src/removed.ts");

    expect(removedFile).toBeDefined();
    expect(removedFile?.status).toBe("deleted");
    expect(removedFile?.addedLines).toEqual([]);
    expect(removedFile?.removedLines).toEqual([1, 2, 3, 4]);
  });

  it("preserves the raw per-file diff text, including headers, in .patch", () => {
    const diff = parseChangedFiles([fixtureFile]);
    const exampleFile = diff.find((file) => file.path === "src/example.ts");
    const removedFile = diff.find((file) => file.path === "src/removed.ts");

    expect(exampleFile?.patch).toBe(
      [
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
      ].join("\n")
    );
    expect(exampleFile?.addedLineContents).toEqual([{ line: 12, content: "line12 added" }]);

    expect(removedFile?.patch).toBe(
      [
        "diff --git a/src/removed.ts b/src/removed.ts",
        "deleted file mode 100644",
        "index 3333333..0000000",
        "--- a/src/removed.ts",
        "+++ /dev/null",
        "@@ -1,4 +0,0 @@",
        "-old line1",
        "-old line2",
        "-old line3",
        "-old line4"
      ].join("\n")
    );
  });
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findReviewAnchor, parseChangedFiles } from "../../src/core/diff.js";

const fixturePath = fileURLToPath(new URL("../fixtures/example.patch", import.meta.url));
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
});

import { describe, expect, it } from "vitest";
import { renderFindingTitle, shortenFindingTitle } from "../../../../src/review/domain/findings/title.js";

describe("shortenFindingTitle", () => {
  it("keeps short titles unchanged", () => {
    expect(shortenFindingTitle("Avoid mutable state")).toBe("Avoid mutable state");
  });

  it("limits long titles to a concise display title", () => {
    const result = shortenFindingTitle(
      "GitHub Actions step uses a mutable tag or branch reference. Tags and branch names can be silently repointed"
    );

    expect(result).toBe("GitHub Actions step uses a mutable tag or branch...");
    expect(result.split(/\s+/).length).toBeLessThanOrEqual(10);
  });

  it("collapses whitespace before rendering", () => {
    expect(shortenFindingTitle("  Avoid\n\tmutable   state  ")).toBe("Avoid mutable state");
  });

  it.each([
    ["P0", "#cf222e"],
    ["P1", "#bc4c00"],
    ["P2", "#9a6700"],
    ["P3", "#6e7781"]
  ] as const)("renders %s with color %s", (severity, color) => {
    expect(renderFindingTitle(severity, "Avoid mutable state")).toBe(
      `**[<font color="${color}">${severity}</font>] Avoid mutable state**`
    );
  });
});

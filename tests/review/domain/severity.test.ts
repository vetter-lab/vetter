import { describe, expect, it } from "vitest";
import { parseSeverity, SEVERITIES } from "../../../src/review/domain/severity.js";

describe("severity", () => {
  it("orders findings from P0 to P3", () => {
    expect(SEVERITIES).toEqual(["P0", "P1", "P2", "P3"]);
  });

  it("maps legacy labels only when reading compatibility data", () => {
    expect(parseSeverity("critical")).toBe("P0");
    expect(parseSeverity("major")).toBe("P1");
    expect(parseSeverity("minor")).toBe("P3");
    expect(parseSeverity("P3")).toBe("P3");
    expect(parseSeverity("blocker")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { buildFindingMarker, isFindingComment, parseFindingMarker } from "../../../../src/review/domain/reconciliation/markers.js";

const fields = {
  fingerprint: "fp",
  ruleId: "rule",
  severity: "P0" as const,
  source: "llm" as const,
  scopeKey: "llm:rule:file.ts",
  title: "Title",
  botResolved: false
};

describe("finding markers", () => {
  it("writes and reads canonical P0-P3 values", () => {
    const marker = buildFindingMarker({ ...fields, severity: "P3" });
    expect(parseFindingMarker(marker)?.severity).toBe("P3");
  });

  it("maps a legacy marker severity while reading persisted state", () => {
    const marker = buildFindingMarker({ ...fields, severity: "P1" }).replace('severity="P1"', 'severity="major"');
    expect(parseFindingMarker(marker)?.severity).toBe("P1");
  });

  it("rejects unknown marker severities as unmanaged", () => {
    const marker = buildFindingMarker(fields).replace('severity="P0"', 'severity="blocker"');
    expect(parseFindingMarker(marker)).toBeNull();
    expect(isFindingComment(marker)).toBe(false);
  });
});

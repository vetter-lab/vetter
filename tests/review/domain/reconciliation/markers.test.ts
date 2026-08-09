import { describe, expect, it } from "vitest";
import {
  buildFindingMarker,
  buildSummaryRowMarker,
  isFindingComment,
  parseFindingMarker,
  parseSummaryRowMarkers
} from "../../../../src/review/domain/reconciliation/markers.js";

const fields = {
  fingerprint: "fp",
  ruleId: "rule",
  severity: "P0" as const,
  source: "llm" as const,
  scopeKey: "llm:rule:file.ts",
  title: "Title",
  codeAnchor: "const value = 1;",
  botResolved: false
};

describe("finding markers", () => {
  it("writes and reads canonical P0-P3 values", () => {
    const marker = buildFindingMarker({ ...fields, severity: "P3" });
    expect(parseFindingMarker(marker)?.severity).toBe("P3");
  });

  it("persists a code anchor in the v2 marker", () => {
    const marker = buildFindingMarker({ ...fields, codeAnchor: 'const value = "new";' });

    expect(marker).toContain("vetter:finding:v2");
    expect(parseFindingMarker(marker)?.codeAnchor).toBe('const value = "new";');
  });

  it("rejects a marker without a code anchor", () => {
    const marker = '<!-- vetter:finding:v2 fingerprint="fp" rule="rule" severity="P0" source="llm" scope="llm:rule:file.ts" title="Title" bot-resolved="false" -->';

    expect(parseFindingMarker(marker)).toBeNull();
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

  it("normalizes legacy suppressed summary rows to dismissed", () => {
    const marker = buildSummaryRowMarker({
      fingerprint: "fp",
      severity: "P1",
      title: "Title",
      path: "src/example.ts",
      line: 12,
      state: "dismissed"
    }).replace('state="dismissed"', 'state="suppressed"');

    expect(parseSummaryRowMarkers(marker)[0]?.state).toBe("dismissed");
  });
});

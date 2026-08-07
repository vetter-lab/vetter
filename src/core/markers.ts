import type { FindingState, ReviewSource, Severity } from "./types.js";
import { parseSeverity } from "./severity.js";

const FINDING_MARKER_PATTERN =
  /<!--\s*vetter:finding:v1\s+fingerprint="([^"]*)"\s+rule="([^"]*)"\s+severity="([^"]*)"\s+source="([^"]*)"\s+scope="([^"]*)"\s+title="([^"]*)"\s+bot-resolved="(true|false)"\s*-->/;
const SUMMARY_MARKER_PATTERN = /<!--\s*vetter:summary:v1\s*-->/;
const SUMMARY_ROW_MARKER_PATTERN =
  /<!--\s*vetter:summary-row:v1\s+fingerprint="([^"]*)"\s+severity="([^"]*)"\s+title="([^"]*)"\s+path="([^"]*)"\s+line="(null|[0-9]+)"\s+state="(open|fixed|suppressed)"\s*-->/g;

export const SUMMARY_MARKER = "<!-- vetter:summary:v1 -->";

function escapeAttr(value: string): string {
  return value.replace(/"/g, "&quot;");
}

function unescapeAttr(value: string): string {
  return value.replace(/&quot;/g, '"');
}

export interface FindingMarkerFields {
  fingerprint: string;
  ruleId: string;
  severity: Severity;
  source: ReviewSource;
  scopeKey: string;
  title: string;
  /**
   * Written `true` only when Vetter itself resolves the thread (a "fixed"
   * finding). Used as the fallback signal for who resolved a thread when
   * GitHub's `resolvedBy` is unavailable; see `core/reconcile.ts`.
   */
  botResolved: boolean;
}

export interface SummaryRowMarkerFields {
  fingerprint: string;
  severity: Severity;
  title: string;
  path: string;
  line: number | null;
  state: FindingState;
}

/**
 * Renders the hidden marker embedded in every Vetter-managed inline comment.
 * All identity and rendering fields the core needs to reconstruct an
 * `ExistingFinding` on a later run are carried here, since GitHub comments
 * (not SQL) are the only persisted state.
 */
export function buildFindingMarker(fields: FindingMarkerFields): string {
  return [
    "<!-- vetter:finding:v1",
    `fingerprint="${escapeAttr(fields.fingerprint)}"`,
    `rule="${escapeAttr(fields.ruleId)}"`,
    `severity="${escapeAttr(fields.severity)}"`,
    `source="${escapeAttr(fields.source)}"`,
    `scope="${escapeAttr(fields.scopeKey)}"`,
    `title="${escapeAttr(fields.title)}"`,
    `bot-resolved="${fields.botResolved ? "true" : "false"}"`,
    "-->"
  ].join(" ");
}

/**
 * Extracts the finding identity/rendering fields from a comment body, or
 * `null` when the body does not carry a valid v1 finding marker.
 */
export function parseFindingMarker(body: string): FindingMarkerFields | null {
  const match = FINDING_MARKER_PATTERN.exec(body);
  if (!match) {
    return null;
  }
  const [, fingerprint, ruleId, severity, source, scopeKey, title, botResolved] = match;
  if (!fingerprint || !severity || !source || scopeKey === undefined || title === undefined) {
    return null;
  }
  const parsedSeverity = parseSeverity(severity);
  if (parsedSeverity === null) {
    return null;
  }
  return {
    fingerprint,
    ruleId: ruleId ?? "",
    severity: parsedSeverity,
    source: source as ReviewSource,
    scopeKey,
    title: unescapeAttr(title),
    botResolved: botResolved === "true"
  };
}

export function isFindingComment(body: string): boolean {
  return parseFindingMarker(body) !== null;
}

export function buildSummaryRowMarker(fields: SummaryRowMarkerFields): string {
  return [
    "<!-- vetter:summary-row:v1",
    "fingerprint=\"" + escapeAttr(fields.fingerprint) + "\"",
    "severity=\"" + escapeAttr(fields.severity) + "\"",
    "title=\"" + escapeAttr(fields.title) + "\"",
    "path=\"" + escapeAttr(fields.path) + "\"",
    "line=\"" + (fields.line === null ? "null" : String(fields.line)) + "\"",
    "state=\"" + fields.state + "\"",
    "-->"
  ].join(" ");
}

export function parseSummaryRowMarkers(body: string): SummaryRowMarkerFields[] {
  return Array.from(body.matchAll(SUMMARY_ROW_MARKER_PATTERN), (match) => {
    const [, fingerprint, severity, title, path, line, state] = match;
    const parsedSeverity = parseSeverity(severity ?? "");
    if (!fingerprint || parsedSeverity === null || title === undefined || path === undefined || !state) {
      return null;
    }

    return {
      fingerprint,
      severity: parsedSeverity,
      title: unescapeAttr(title),
      path: unescapeAttr(path),
      line: line === "null" ? null : Number(line),
      state: state as FindingState
    };
  }).filter((marker): marker is SummaryRowMarkerFields => marker !== null);
}

export function isSummaryComment(body: string): boolean {
  return SUMMARY_MARKER_PATTERN.test(body);
}

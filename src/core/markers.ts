import type { ReviewSource, Severity } from "./types.js";
import { parseSeverity } from "./severity.js";

const FINDING_MARKER_PATTERN =
  /<!--\s*vetter:finding:v1\s+fingerprint="([^"]*)"\s+rule="([^"]*)"\s+severity="([^"]*)"\s+source="([^"]*)"\s+scope="([^"]*)"\s+title="([^"]*)"\s+bot-resolved="(true|false)"\s*-->/;
const SUMMARY_MARKER_PATTERN = /<!--\s*vetter:summary:v1\s*-->/;

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

export function isSummaryComment(body: string): boolean {
  return SUMMARY_MARKER_PATTERN.test(body);
}

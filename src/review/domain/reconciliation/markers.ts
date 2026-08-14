import type { FindingState, ReviewSource, Severity } from "../types.js";
import { shortenFindingTitle } from "../findings/title.js";
import { parseSeverity } from "../severity.js";

const FINDING_MARKER_PATTERN =
  /<!--\s*vetter:finding:v2\s+fingerprint="([^"]*)"\s+rule="([^"]*)"\s+severity="([^"]*)"\s+source="([^"]*)"\s+scope="([^"]*)"\s+title="([^"]*)"\s+anchor="([^"]*)"\s+bot-resolved="(true|false)"\s*-->/;
const SUMMARY_MARKER_PATTERN = /<!--\s*vetter:summary:v1\s*-->/;
const SUMMARY_ROW_MARKER_PATTERN =
  /<!--\s*vetter:summary-row:v1\s+fingerprint="([^"]*)"\s+severity="([^"]*)"\s+title="([^"]*)"\s+path="([^"]*)"\s+line="(null|[0-9]+)"\s+state="(open|fixed|dismissed|suppressed)"\s*-->/g;

export const SUMMARY_MARKER = "<!-- vetter:summary:v1 -->";

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function unescapeAttr(value: string): string {
  return value
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

export interface FindingMarkerFields {
  fingerprint: string;
  ruleId: string;
  severity: Severity;
  source: ReviewSource;
  scopeKey: string;
  title: string;
  /** Verbatim source snippet used to relocate a finding after line shifts. */
  codeAnchor: string;
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
    "<!-- vetter:finding:v2",
    `fingerprint="${escapeAttr(fields.fingerprint)}"`,
    `rule="${escapeAttr(fields.ruleId)}"`,
    `severity="${escapeAttr(fields.severity)}"`,
    `source="${escapeAttr(fields.source)}"`,
    `scope="${escapeAttr(fields.scopeKey)}"`,
    `title="${escapeAttr(fields.title)}"`,
    `anchor="${escapeAttr(fields.codeAnchor)}"`,
    `bot-resolved="${fields.botResolved ? "true" : "false"}"`,
    "-->"
  ].join(" ");
}

/**
 * Extracts the finding identity/rendering fields from a comment body, or
 * `null` when the body does not carry a valid finding marker.
 */
export function parseFindingMarker(body: string): FindingMarkerFields | null {
  const match = FINDING_MARKER_PATTERN.exec(body);
  if (!match) {
    return null;
  }
  const [, fingerprint, ruleId, severity, source, scopeKey, title, codeAnchor, botResolved] = match;
  if (!fingerprint || !severity || !source || scopeKey === undefined || title === undefined || !codeAnchor?.trim()) {
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
    codeAnchor: unescapeAttr(codeAnchor),
    botResolved: botResolved === "true"
  };
}

/**
 * Extracts the finding-specific body from a rendered inline comment. The
 * persisted GitHub comment contains the visible title and marker in addition
 * to the model body; keeping those presentation details out of ExistingFinding
 * prevents a fixed comment from rendering them a second time.
 */
export function extractFindingBody(body: string, marker: FindingMarkerFields): string {
  const markerStart = body.search(/<!--\s*vetter:finding:v2\b/);
  let findingBody = (markerStart === -1 ? body : body.slice(0, markerStart)).trim();
  const renderedTitle = `**[${marker.severity.toUpperCase()}] ${shortenFindingTitle(marker.title)}**`;

  while (findingBody.startsWith(renderedTitle)) {
    findingBody = findingBody.slice(renderedTitle.length).trimStart();
  }

  return findingBody.trimEnd();
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
      // Keep summaries written before the rename readable and canonicalize them
      // when the next summary body is rebuilt.
      state: (state === "suppressed" ? "dismissed" : state) as FindingState
    };
  }).filter((marker): marker is SummaryRowMarkerFields => marker !== null);
}

export function isSummaryComment(body: string): boolean {
  return SUMMARY_MARKER_PATTERN.test(body);
}

import type { ChangedFile, ReviewAnchor } from "./types.js";
import { normalize } from "../findings/text.js";

export interface ReviewAnchorOptions {
  codeAnchor?: string;
  requireCodeAnchor?: boolean;
}

interface SourceLine {
  line: number;
  content: string;
}

function findAnchorMatches(lines: SourceLine[], codeAnchor: string): number[] {
  const anchorLines = normalize(codeAnchor).split("\n").filter((value) => value.length > 0);
  if (anchorLines.length === 0) {
    return [];
  }

  const matches: number[] = [];
  for (let index = 0; index <= lines.length - anchorLines.length; index += 1) {
    const candidate = lines[index];
    if (!candidate) {
      continue;
    }
    const matchesAnchor = anchorLines.every((anchorLine, offset) => {
      const next = lines[index + offset];
      return next !== undefined && next.line === candidate.line + offset && normalize(next.content).includes(anchorLine);
    });
    if (matchesAnchor) {
      matches.push(candidate.line);
    }
  }
  return matches;
}

/**
 * Finds a unique source location for a persisted code anchor. A preferred
 * line can disambiguate repeated snippets only when it still points to one of
 * the matches; otherwise the result is intentionally rejected as ambiguous.
 */
export function findCodeAnchorLine(content: string, codeAnchor: string, preferredLine?: number | null): number | null {
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const matches = findAnchorMatches(lines.map((content, index) => ({ line: index + 1, content })), codeAnchor);

  if (matches.length === 0) {
    return null;
  }
  if (matches.length === 1) {
    return matches[0] ?? null;
  }
  return preferredLine !== null && preferredLine !== undefined && matches.includes(preferredLine) ? preferredLine : null;
}

/**
 * Only added lines in the current diff can receive an inline review comment.
 */
export function findReviewAnchor(
  files: ChangedFile[],
  path: string,
  line: number,
  options: ReviewAnchorOptions = {}
): ReviewAnchor | null {
  const file = files.find((candidate) => candidate.path === path);
  if (!file) {
    return null;
  }

  const anchor = options.codeAnchor ? findCodeAnchor(file, options.codeAnchor, line) : null;
  if (anchor) {
    return anchor;
  }
  if (options.requireCodeAnchor) {
    return null;
  }
  if (!file.addedLines.includes(line)) {
    return null;
  }
  return { path, line, side: "RIGHT" };
}

function findCodeAnchor(file: ChangedFile, codeAnchor: string, reportedLine: number): ReviewAnchor | null {
  const matches = findAnchorMatches(file.addedLineContents, codeAnchor);

  if (matches.length === 0) {
    return null;
  }
  if (matches.length > 1) {
    return matches.includes(reportedLine) ? { path: file.path, line: reportedLine, side: "RIGHT" } : null;
  }
  return { path: file.path, line: matches[0]!, side: "RIGHT" };
}

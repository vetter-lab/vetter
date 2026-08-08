import type { ChangedFile, ReviewAnchor } from "./types.js";
import { normalize } from "../findings/text.js";

export interface ReviewAnchorOptions {
  codeAnchor?: string;
  requireCodeAnchor?: boolean;
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
  const anchorLines = normalize(codeAnchor).split("\n").filter((value) => value.length > 0);
  if (anchorLines.length === 0) {
    return null;
  }

  const matches = file.addedLineContents.filter((candidate, index, lines) =>
    anchorLines.every((anchorLine, offset) => {
      const next = lines[index + offset];
      return next !== undefined && next.line === candidate.line + offset && normalize(next.content).includes(anchorLine);
    })
  );

  if (matches.length === 0) {
    return null;
  }
  if (matches.length > 1) {
    const reportedMatch = matches.find((match) => match.line === reportedLine);
    return reportedMatch ? { path: file.path, line: reportedMatch.line, side: "RIGHT" } : null;
  }
  return { path: file.path, line: matches[0]!.line, side: "RIGHT" };
}

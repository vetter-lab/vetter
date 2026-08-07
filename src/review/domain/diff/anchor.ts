import type { ChangedFile, ReviewAnchor } from "./types.js";

/**
 * Only added lines in the current diff can receive an inline review comment.
 */
export function findReviewAnchor(files: ChangedFile[], path: string, line: number): ReviewAnchor | null {
  const file = files.find((candidate) => candidate.path === path);
  if (!file || !file.addedLines.includes(line)) {
    return null;
  }
  return { path, line, side: "RIGHT" };
}

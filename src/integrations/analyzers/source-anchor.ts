import { readFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

export function toRelativePath(repositoryPath: string, rawPath: string): string {
  return isAbsolute(rawPath) ? relative(repositoryPath, rawPath) : rawPath;
}

/** Reads a source range from the checkout for use as a finding anchor. */
export function readSourceAnchor(
  repositoryPath: string,
  rawPath: string,
  startLine: number,
  endLine = startLine
): string | null {
  try {
    const relativePath = toRelativePath(repositoryPath, rawPath);
    const content = readFileSync(join(repositoryPath, relativePath), "utf8");
    const source = content.split("\n").slice(startLine - 1, endLine).join("\n").trim();
    return source.length > 0 ? source : null;
  } catch {
    return null;
  }
}

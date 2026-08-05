import parseDiff, { type File as ParseDiffFile } from "parse-diff";

export type ChangedFileStatus = "added" | "modified" | "deleted" | "renamed";

export interface ChangedFile {
  path: string;
  status: ChangedFileStatus;
  patch: string;
  addedLines: number[];
  removedLines: number[];
  scopeKey: string;
}

export interface ReviewAnchor {
  path: string;
  line: number;
  side: "RIGHT";
}

/**
 * Parses one or more unified diff patch strings into normalized
 * `ChangedFile` records. A single patch string may itself contain multiple
 * file entries (e.g. a full PR diff), so results across all inputs are
 * flattened into a single list.
 */
export function parseChangedFiles(patches: string[]): ChangedFile[] {
  return patches.flatMap((patch) => {
    const files = parseDiff(patch);
    const rawSections = splitPatchIntoFileSections(patch, files.length);
    return files.map((file, index) => toChangedFile(file, rawSections[index] ?? patch));
  });
}

/**
 * Only lines that were added in the current diff are valid inline review
 * anchors: GitHub only accepts RIGHT-side comments on lines present in the
 * current diff's added/context ranges, and we conservatively restrict this
 * to lines the diff actually added so stale line numbers never anchor a
 * comment to the wrong code.
 */
export function findReviewAnchor(files: ChangedFile[], path: string, line: number): ReviewAnchor | null {
  const file = files.find((candidate) => candidate.path === path);
  if (!file || !file.addedLines.includes(line)) {
    return null;
  }
  return { path, line, side: "RIGHT" };
}

function toChangedFile(file: ParseDiffFile, rawPatch: string): ChangedFile {
  const status = resolveStatus(file);
  const path = resolvePath(file, status);
  const addedLines: number[] = [];
  const removedLines: number[] = [];

  for (const chunk of file.chunks) {
    for (const change of chunk.changes) {
      if (change.type === "add") {
        addedLines.push(change.ln);
      } else if (change.type === "del") {
        removedLines.push(change.ln);
      }
    }
  }

  return {
    path,
    status,
    patch: rawPatch.trim(),
    addedLines,
    removedLines,
    scopeKey: path
  };
}

function resolveStatus(file: ParseDiffFile): ChangedFileStatus {
  if (file.deleted) {
    return "deleted";
  }
  if (file.new) {
    return "added";
  }
  if (file.from && file.to && file.from !== file.to) {
    return "renamed";
  }
  return "modified";
}

function resolvePath(file: ParseDiffFile, status: ChangedFileStatus): string {
  if (status === "deleted") {
    return file.from ?? file.to ?? "unknown";
  }
  return file.to ?? file.from ?? "unknown";
}

/**
 * Splits a raw multi-file patch string into one raw substring per file, in
 * the same order `parse-diff` reports files, so each `ChangedFile.patch` is
 * a byte-accurate slice of the input (including `diff --git`/`---`/`+++`
 * header lines) rather than a hand-reconstructed approximation.
 */
function splitPatchIntoFileSections(patch: string, expectedCount: number): string[] {
  const gitSections = splitByLinePrefix(patch, "diff --git ");
  if (gitSections.length === expectedCount) {
    return gitSections;
  }

  // Fall back for plain unified diffs that omit the `diff --git` line and
  // instead start each file directly with its `--- a/...` header.
  const plainSections = splitByLinePrefix(patch, "--- ");
  if (plainSections.length === expectedCount) {
    return plainSections;
  }

  return gitSections.length > 0 ? gitSections : [patch];
}

function splitByLinePrefix(patch: string, prefix: string): string[] {
  const lines = patch.split("\n");
  const sections: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.startsWith(prefix) && current.length > 0) {
      sections.push(current.join("\n"));
      current = [line];
    } else {
      current.push(line);
    }
  }

  if (current.length > 0) {
    sections.push(current.join("\n"));
  }

  return sections;
}

import type { ChangedFile } from "../diff/types.js";
import { findCodeAnchorLine } from "../diff/anchor.js";
import type { ExistingFinding } from "../types.js";

export interface RelocateExistingFindingsInput {
  existing: ExistingFinding[];
  changedFiles: ChangedFile[];
  currentFiles: ReadonlyMap<string, string | null>;
  baseFiles?: ReadonlyMap<string, string | null>;
}

export interface RelocateExistingFindingsResult {
  findings: ExistingFinding[];
  reviewedFingerprints: Set<string>;
}

/**
 * Reconciles persisted comment locations with source content. GitHub's
 * `line` becomes null for outdated comments, so it is only a fallback. The
 * persisted anchor is used to update display locations and to map a finding
 * back to the old side of the incremental diff before deciding it was fixed.
 */
export function relocateExistingFindings(input: RelocateExistingFindingsInput): RelocateExistingFindingsResult {
  const { existing, changedFiles, currentFiles, baseFiles = new Map() } = input;
  const changedByPath = new Map(changedFiles.map((file) => [file.path, file]));
  const reviewedFingerprints = new Set<string>();

  const findings = existing.map((finding) => {
    const changedFile = changedByPath.get(finding.path);
    const baseContent = baseFiles.get(finding.path);
    const currentContent = currentFiles.get(finding.path);
    const anchoredBaseLine = finding.codeAnchor && baseContent !== null && baseContent !== undefined
      ? findCodeAnchorLine(baseContent, finding.codeAnchor, finding.line)
      : null;
    // GitHub's originalLine is still useful when an older provider emitted an
    // invalid or stale anchor. It lets the diff prove that the old finding was
    // reviewed instead of leaving the thread open forever.
    const baseLine = anchoredBaseLine ?? finding.line;
    const currentLine = finding.codeAnchor && currentContent !== null && currentContent !== undefined
      ? findCodeAnchorLine(currentContent, finding.codeAnchor, baseLine ?? finding.line)
      : null;

    if (changedFile && (changedFile.status === "deleted" ||
      (baseLine !== null &&
        (changedFile.addedLines.includes(baseLine) || changedFile.removedLines.includes(baseLine))))) {
      reviewedFingerprints.add(finding.fingerprint);
    }

    return currentLine === null ? finding : { ...finding, line: currentLine };
  });

  return { findings, reviewedFingerprints };
}

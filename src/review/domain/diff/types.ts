export type ChangedFileStatus = "added" | "modified" | "deleted" | "renamed";

export interface AddedLineContent {
  line: number;
  content: string;
}

export interface ChangedFile {
  path: string;
  status: ChangedFileStatus;
  patch: string;
  addedLines: number[];
  addedLineContents: AddedLineContent[];
  removedLines: number[];
  scopeKey: string;
}

export interface ReviewAnchor {
  path: string;
  line: number;
  side: "RIGHT";
}

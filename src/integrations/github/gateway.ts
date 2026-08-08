import type {
  CheckRunInput,
  CreatedReviewComment,
  CreateReviewInput,
  IssueCommentSnapshot,
  PullRequestRef,
  PullRequestSnapshot,
  ReviewStateSnapshot
} from "./types.js";

export interface ChangedFileEntry {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  patch: string;
}

/**
 * Narrow GitHub surface consumed by the review core. No Octokit type ever
 * crosses this boundary, so the core stays testable with a plain fake and
 * portable between the App and Action runtimes.
 */
export interface GitHubGateway {
  getPullRequest(input: PullRequestRef): Promise<PullRequestSnapshot>;

  findOpenPullRequestsForHead(input: {
    owner: string;
    repo: string;
    branch: string;
  }): Promise<PullRequestSnapshot[]>;

  listChangedFiles(input: PullRequestRef): Promise<ChangedFileEntry[]>;

  /**
   * Reads a file's raw text content at `ref`, or null when the path does
   * not exist at that ref. Used to load a repository's `.vetter.yml`.
   */
  getFileContent(input: { owner: string; repo: string; ref: string; path: string }): Promise<string | null>;

  /**
   * Reads only review threads/comments authored by a login in `botLogins`
   * and that carry a valid Vetter marker; everything else (developer
   * comments, unmarked bot comments) is excluded so the core never mutates
   * content it doesn't own.
   */
  listReviewState(input: PullRequestRef & { botLogins: Set<string> }): Promise<ReviewStateSnapshot>;

  findSummaryComment(input: PullRequestRef & { botLogins: Set<string> }): Promise<IssueCommentSnapshot | null>;

  /**
   * Creates one review comment per input comment and returns each database id
   * and canonical URL in the same order as `input.comments`. Returning these
   * references lets the caller link summary rows to the newly created inline
   * comments in the same run.
   */
  createReview(input: CreateReviewInput): Promise<CreatedReviewComment[]>;

  updateReviewComment(input: { owner: string; repo: string; commentId: number; body: string }): Promise<void>;

  createIssueComment(input: PullRequestRef & { body: string }): Promise<{ commentId: number }>;

  updateIssueComment(input: { owner: string; repo: string; commentId: number; body: string }): Promise<void>;

  deleteIssueComment(input: { owner: string; repo: string; commentId: number }): Promise<void>;

  resolveThread(input: { threadId: string }): Promise<void>;

  reopenThread(input: { threadId: string }): Promise<void>;

  upsertCheckRun(input: CheckRunInput): Promise<void>;
}

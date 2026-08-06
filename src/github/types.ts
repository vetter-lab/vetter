export interface PullRequestRef {
  owner: string;
  repo: string;
  number: number;
}

export interface PullRequestSnapshot {
  number: number;
  state: "open" | "closed";
  headSha: string;
  headRef: string;
  baseSha: string;
  baseRef: string;
}

export interface ReviewThreadComment {
  /** REST-style database id, usable with `pulls.updateReviewComment`. */
  commentId: number;
  body: string;
  path: string;
  line: number | null;
  authorLogin: string | null;
}

export interface ReviewThreadSnapshot {
  /** GraphQL node id, usable with `resolveReviewThread`/`unresolveReviewThread`. */
  threadId: string;
  isResolved: boolean;
  resolvedByLogin: string | null;
  /** Only comments authored by a configured bot login; see `GitHubGateway.listReviewState`. */
  comments: ReviewThreadComment[];
}

export interface IssueCommentSnapshot {
  commentId: number;
  body: string;
  authorLogin: string | null;
}

export interface ReviewStateSnapshot {
  reviewThreads: ReviewThreadSnapshot[];
  issueComments: IssueCommentSnapshot[];
}

export interface CreateReviewCommentInput {
  path: string;
  line: number;
  side: "RIGHT";
  body: string;
}

export interface CreateReviewInput extends PullRequestRef {
  commitId: string;
  comments: CreateReviewCommentInput[];
}

export interface CheckRunInput {
  owner: string;
  repo: string;
  headSha: string;
  conclusion: "success" | "failure";
  title: string;
  summary: string;
}

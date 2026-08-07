import type { Octokit } from "octokit";
import { isFindingComment, isSummaryComment } from "../core/markers.js";
import type { ChangedFileEntry, GitHubGateway } from "./gateway.js";
import type {
  CheckRunInput,
  CreateReviewInput,
  IssueCommentSnapshot,
  PullRequestRef,
  PullRequestSnapshot,
  ReviewStateSnapshot,
  ReviewThreadComment,
  ReviewThreadSnapshot
} from "./types.js";

const CHECK_RUN_NAME = "vetter / code-review";

interface GraphQlThreadComment {
  databaseId: number | null;
  body: string;
  path: string;
  line: number | null;
  author: { login: string } | null;
}

interface GraphQlThreadNode {
  id: string;
  isResolved: boolean;
  resolvedBy: { login: string } | null;
  comments: { nodes: GraphQlThreadComment[] };
}

interface ReviewThreadsQueryResult {
  repository: {
    pullRequest: {
      reviewThreads: {
        nodes: GraphQlThreadNode[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    };
  };
}

const REVIEW_THREADS_QUERY = `
  query ReviewThreads($owner: String!, $repo: String!, $number: Int!, $after: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 50, after: $after) {
          nodes {
            id
            isResolved
            resolvedBy {
              login
            }
            comments(first: 50) {
              nodes {
                databaseId
                body
                path
                line
                author {
                  login
                }
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;

const RESOLVE_THREAD_MUTATION = `
  mutation ResolveReviewThread($threadId: ID!) {
    resolveReviewThread(input: { threadId: $threadId }) {
      thread {
        id
      }
    }
  }
`;

const UNRESOLVE_THREAD_MUTATION = `
  mutation UnresolveReviewThread($threadId: ID!) {
    unresolveReviewThread(input: { threadId: $threadId }) {
      thread {
        id
      }
    }
  }
`;

function toPullRequestSnapshot(pr: {
  number: number;
  state: string;
  head: { sha: string; ref: string };
  base: { sha: string; ref: string };
}): PullRequestSnapshot {
  return {
    number: pr.number,
    state: pr.state === "open" ? "open" : "closed",
    headSha: pr.head.sha,
    headRef: pr.head.ref,
    baseSha: pr.base.sha,
    baseRef: pr.base.ref
  };
}

/**
 * Octokit-backed `GitHubGateway`. Contains all REST/GraphQL calls; the
 * review core never imports Octokit directly and depends only on the
 * `GitHubGateway` interface, so this is the sole place that translates
 * between GitHub's API shapes and the core's domain types.
 */
export function createOctokitGateway(octokit: Octokit): GitHubGateway {
  return {
    async getPullRequest(input: PullRequestRef): Promise<PullRequestSnapshot> {
      const { data } = await octokit.rest.pulls.get({
        owner: input.owner,
        repo: input.repo,
        pull_number: input.number
      });
      return toPullRequestSnapshot(data);
    },

    async findOpenPullRequestsForHead(input: {
      owner: string;
      repo: string;
      branch: string;
    }): Promise<PullRequestSnapshot[]> {
      const { data } = await octokit.rest.pulls.list({
        owner: input.owner,
        repo: input.repo,
        state: "open",
        head: `${input.owner}:${input.branch}`
      });
      return data.map((pr) => toPullRequestSnapshot(pr));
    },

    async listChangedFiles(input: PullRequestRef): Promise<ChangedFileEntry[]> {
      const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
        owner: input.owner,
        repo: input.repo,
        pull_number: input.number,
        per_page: 100
      });

      return files.map((file) => ({
        path: file.filename,
        status: mapFileStatus(file.status),
        patch: file.patch ?? ""
      }));
    },

    async getFileContent(input: {
      owner: string;
      repo: string;
      ref: string;
      path: string;
    }): Promise<string | null> {
      try {
        const { data } = await octokit.rest.repos.getContent({
          owner: input.owner,
          repo: input.repo,
          ref: input.ref,
          path: input.path
        });

        if (Array.isArray(data) || data.type !== "file" || !data.content) {
          return null;
        }

        return Buffer.from(data.content, "base64").toString("utf8");
      } catch (error) {
        if (typeof error === "object" && error !== null && "status" in error && error.status === 404) {
          return null;
        }
        throw error;
      }
    },

    async listReviewState(
      input: PullRequestRef & { botLogins: Set<string> }
    ): Promise<ReviewStateSnapshot> {
      const threadNodes = await collectReviewThreadNodes(octokit, input);
      const reviewThreads: ReviewThreadSnapshot[] = threadNodes.map((node) => ({
        threadId: node.id,
        isResolved: node.isResolved,
        resolvedByLogin: node.resolvedBy?.login ?? null,
        comments: node.comments.nodes
          .filter((comment) => isBotOwnedFindingComment(comment, input.botLogins))
          .map((comment): ReviewThreadComment => ({
            commentId: comment.databaseId ?? -1,
            body: comment.body,
            path: comment.path,
            line: comment.line,
            authorLogin: comment.author?.login ?? null
          }))
      }));

      const issueComments = await listBotIssueComments(octokit, input);

      return { reviewThreads, issueComments };
    },

    async findSummaryComment(
      input: PullRequestRef & { botLogins: Set<string> }
    ): Promise<IssueCommentSnapshot | null> {
      const issueComments = await listBotIssueComments(octokit, input);
      return issueComments.find((comment) => isSummaryComment(comment.body)) ?? null;
    },

    async createReview(input: CreateReviewInput): Promise<void> {
      if (input.comments.length === 0) {
        return;
      }
      await octokit.rest.pulls.createReview({
        owner: input.owner,
        repo: input.repo,
        pull_number: input.number,
        commit_id: input.commitId,
        event: "COMMENT",
        comments: input.comments.map((comment) => ({
          path: comment.path,
          line: comment.line,
          side: comment.side,
          body: comment.body
        }))
      });
    },

    async updateReviewComment(input: {
      owner: string;
      repo: string;
      commentId: number;
      body: string;
    }): Promise<void> {
      await octokit.rest.pulls.updateReviewComment({
        owner: input.owner,
        repo: input.repo,
        comment_id: input.commentId,
        body: input.body
      });
    },

    async createIssueComment(input: PullRequestRef & { body: string }): Promise<{ commentId: number }> {
      const { data } = await octokit.rest.issues.createComment({
        owner: input.owner,
        repo: input.repo,
        issue_number: input.number,
        body: input.body
      });
      return { commentId: data.id };
    },

    async updateIssueComment(input: {
      owner: string;
      repo: string;
      commentId: number;
      body: string;
    }): Promise<void> {
      await octokit.rest.issues.updateComment({
        owner: input.owner,
        repo: input.repo,
        comment_id: input.commentId,
        body: input.body
      });
    },

    async deleteIssueComment(input: { owner: string; repo: string; commentId: number }): Promise<void> {
      await octokit.rest.issues.deleteComment({
        owner: input.owner,
        repo: input.repo,
        comment_id: input.commentId
      });
    },

    async resolveThread(input: { threadId: string }): Promise<void> {
      await octokit.graphql(RESOLVE_THREAD_MUTATION, { threadId: input.threadId });
    },

    async reopenThread(input: { threadId: string }): Promise<void> {
      await octokit.graphql(UNRESOLVE_THREAD_MUTATION, { threadId: input.threadId });
    },

    async upsertCheckRun(input: CheckRunInput): Promise<void> {
      const { data } = await octokit.rest.checks.listForRef({
        owner: input.owner,
        repo: input.repo,
        ref: input.headSha,
        check_name: CHECK_RUN_NAME,
        per_page: 1
      });

      const existing = data.check_runs[0];
      if (existing) {
        await octokit.rest.checks.update({
          owner: input.owner,
          repo: input.repo,
          check_run_id: existing.id,
          status: "completed",
          conclusion: input.conclusion,
          output: { title: input.title, summary: input.summary }
        });
        return;
      }

      await octokit.rest.checks.create({
        owner: input.owner,
        repo: input.repo,
        name: CHECK_RUN_NAME,
        head_sha: input.headSha,
        status: "completed",
        conclusion: input.conclusion,
        output: { title: input.title, summary: input.summary }
      });
    }
  };
}

function mapFileStatus(status: string): ChangedFileEntry["status"] {
  switch (status) {
    case "added":
      return "added";
    case "removed":
      return "deleted";
    case "renamed":
      return "renamed";
    default:
      return "modified";
  }
}

function isBotOwnedFindingComment(comment: GraphQlThreadComment, botLogins: Set<string>): boolean {
  const login = comment.author?.login ?? "";
  return botLogins.has(login) && isFindingComment(comment.body);
}

async function collectReviewThreadNodes(
  octokit: Octokit,
  input: PullRequestRef
): Promise<GraphQlThreadNode[]> {
  const nodes: GraphQlThreadNode[] = [];
  let after: string | null = null;

  for (;;) {
    const result: ReviewThreadsQueryResult = await octokit.graphql(REVIEW_THREADS_QUERY, {
      owner: input.owner,
      repo: input.repo,
      number: input.number,
      after
    });

    const page = result.repository.pullRequest.reviewThreads;
    nodes.push(...page.nodes);

    if (!page.pageInfo.hasNextPage) {
      break;
    }
    after = page.pageInfo.endCursor;
  }

  return nodes;
}

async function listBotIssueComments(
  octokit: Octokit,
  input: PullRequestRef & { botLogins: Set<string> }
): Promise<IssueCommentSnapshot[]> {
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner: input.owner,
    repo: input.repo,
    issue_number: input.number,
    per_page: 100
  });

  return comments
    .filter((comment) => input.botLogins.has(comment.user?.login ?? ""))
    .map((comment) => ({
      commentId: comment.id,
      body: comment.body ?? "",
      authorLogin: comment.user?.login ?? null
    }));
}

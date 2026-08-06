import * as core from "@actions/core";
import * as github from "@actions/github";
import { loadConfig } from "../../config/load.js";
import { runReview } from "../../core/review.js";
import { createOctokitGateway } from "../../github/octokit-gateway.js";
import { createAnalyzerProvider } from "../../providers/analyzer.js";
import { createOpenAiCompatibleModelProvider } from "../../providers/openai-compatible.js";
import { runAnalyzerProcess } from "../../providers/process-analyzer.js";
import { normalizeActionEvent } from "./context.js";

const BOT_LOGIN = "github-actions[bot]";

function resolveConfigRef(eventName: string, payload: Record<string, unknown>, sha: string): string {
  if (eventName === "pull_request") {
    const pullRequest = payload.pull_request as { head?: { sha?: string } } | undefined;
    return pullRequest?.head?.sha ?? sha;
  }
  if (eventName === "push") {
    const after = payload.after;
    return typeof after === "string" ? after : sha;
  }
  return sha;
}

async function run(): Promise<void> {
  const token = core.getInput("github-token", { required: true });
  const modelApiKey = core.getInput("model-api-key");
  const modelBaseUrl = core.getInput("model-base-url");
  const modelName = core.getInput("model-name");
  const configPath = core.getInput("config-path") || ".vetter.yml";

  const octokit = github.getOctokit(token);
  const gateway = createOctokitGateway(octokit as unknown as Parameters<typeof createOctokitGateway>[0]);

  const { eventName, payload, repo, sha } = github.context;
  const configRef = resolveConfigRef(eventName, payload as Record<string, unknown>, sha);

  const repositoryYaml = await gateway.getFileContent({
    owner: repo.owner,
    repo: repo.repo,
    ref: configRef,
    path: configPath
  });

  const external = modelName ? { review: { model: modelName } } : {};
  const config = loadConfig({ repositoryText: repositoryYaml ?? "", external, runtime: "action" });

  if (config.runtime && config.runtime !== "action") {
    core.info("runtime disabled by configuration; skipping");
    return;
  }

  if (eventName === "push" && !config.events.push.enabled) {
    core.info("push reviews disabled by configuration; skipping");
    return;
  }

  const contexts = await normalizeActionEvent({
    eventName,
    payload,
    runId: `${github.context.runId}`,
    gateway,
    branchPatterns: config.events.push.branchPatterns
  });

  if (contexts.length === 0) {
    core.info("no matching open pull request for this event; nothing to review");
    return;
  }

  const modelProvider = createOpenAiCompatibleModelProvider({
    apiKey: modelApiKey,
    maxRetries: config.limits.modelRetries,
    ...(modelBaseUrl ? { baseURL: modelBaseUrl } : {})
  });

  const analyzerProviders = config.analyzers.map((name) => createAnalyzerProvider(name, runAnalyzerProcess));

  for (const context of contexts) {
    const result = await runReview({
      gateway,
      context,
      config,
      modelProvider,
      analyzerProviders,
      botLogins: new Set([BOT_LOGIN]),
      repositoryPath: process.env.GITHUB_WORKSPACE ?? process.cwd(),
      contextFiles: []
    });

    if (result.status === "completed" && result.conclusion === "failure") {
      core.setFailed(`Vetter review for PR #${String(context.pullRequestNumber)} reported a failing check`);
    }
  }
}

run().catch((error: unknown) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});

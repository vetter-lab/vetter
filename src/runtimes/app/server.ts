import { createHmac, timingSafeEqual } from "node:crypto";
import Fastify from "fastify";
import fastifyRawBody from "fastify-raw-body";
import type { Octokit } from "octokit";
import { loadConfig } from "../../config/load.js";
import { deepMerge } from "../../config/merge.js";
import type { ReviewConfig } from "../../config/schema.js";
import { createAnalyzerProvider } from "../../integrations/analyzers/registry.js";
import { runAnalyzerProcess } from "../../integrations/analyzers/process.js";
import { createInstallationClient } from "../../integrations/github/auth.js";
import type { GitHubGateway } from "../../integrations/github/gateway.js";
import { createOctokitGateway } from "../../integrations/github/octokit-gateway.js";
import { createOpenAiCompatibleModelProvider } from "../../integrations/models/openai-compatible.js";
import { runReview, syncReviewSummary } from "../../review/application/run-review.js";
import type { ReviewContext } from "../../review/domain/types.js";
import { checkoutPullRequest } from "./checkout.js";
import { normalizeWebhookEvent } from "./events.js";
import { createScheduler } from "./scheduler.js";

interface WebhookRepository {
  name: string;
  full_name: string;
  owner: { login: string };
}

interface WebhookInstallation {
  id: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing required environment variable: ${name}`);
  }
  return value;
}

const VETTER_WEBHOOK_SECRET = requireEnv("VETTER_WEBHOOK_SECRET");
const VETTER_APP_ID = requireEnv("VETTER_APP_ID");
const VETTER_PRIVATE_KEY = requireEnv("VETTER_PRIVATE_KEY");
const VETTER_MODEL_API_KEY = process.env.VETTER_MODEL_API_KEY ?? "";
const VETTER_MODEL_BASE_URL = process.env.VETTER_MODEL_BASE_URL;
const VETTER_MODEL_NAME = process.env.VETTER_MODEL_NAME;
const PORT = Number(process.env.PORT ?? "3000");

const perRepositoryConfig = JSON.parse(process.env.VETTER_CONFIG_JSON ?? "{}") as Record<string, unknown>;

let cachedAppSlug: string | null = null;

async function resolveBotLogin(octokit: Octokit): Promise<string> {
  if (!cachedAppSlug) {
    const { data } = await octokit.rest.apps.getAuthenticated();
    cachedAppSlug = data?.slug ?? "vetter";
  }
  return `${cachedAppSlug}[bot]`;
}

function resolveConfigRef(eventName: string, payload: Record<string, unknown>): string | null {
  if (eventName === "pull_request" || eventName === "pull_request_review_thread") {
    const pullRequest = payload.pull_request as { head?: { sha?: string } } | undefined;
    return pullRequest?.head?.sha ?? null;
  }
  if (eventName === "push") {
    const after = payload.after;
    return typeof after === "string" ? after : null;
  }
  return null;
}

async function runContextReview(input: {
  context: ReviewContext;
  config: ReviewConfig;
  gateway: GitHubGateway;
  octokit: Octokit;
  botLogin: string;
  signal: AbortSignal;
}): Promise<void> {
  const { context, config, gateway, octokit, botLogin, signal } = input;

  if (context.source === "pull_request_review_thread") {
    await syncReviewSummary({ gateway, context, config, botLogins: new Set([botLogin]), signal });
    return;
  }

  const installationAuth = (await octokit.auth({ type: "installation" })) as { token: string };
  const checkout = await checkoutPullRequest({
    owner: context.repository.owner,
    repo: context.repository.name,
    headSha: context.headSha,
    token: installationAuth.token
  });

  try {
    const modelProvider = createOpenAiCompatibleModelProvider({
      apiKey: VETTER_MODEL_API_KEY,
      maxRetries: config.limits.modelRetries,
      ...(VETTER_MODEL_BASE_URL ? { baseURL: VETTER_MODEL_BASE_URL } : {})
    });

    const analyzerProviders = config.analyzers.map((name) => createAnalyzerProvider(name, runAnalyzerProcess));

    await runReview({
      gateway,
      context,
      config,
      modelProvider,
      analyzerProviders,
      botLogins: new Set([botLogin]),
      repositoryPath: checkout.path,
      contextFiles: [],
      signal
    });
  } finally {
    await checkout.cleanup();
  }
}

async function main(): Promise<void> {
  const app = Fastify({ logger: true });

  await app.register(fastifyRawBody, {
    field: "rawBody",
    global: false,
    encoding: "utf8"
  });

  const scheduler = createScheduler({
    maxConcurrent: 4,
    onError: (key, error) => {
      app.log.error({ key, error }, "review task failed");
    }
  });

  app.get("/healthz", async () => ({ status: "ok" }));

  app.post("/webhooks/github", { config: { rawBody: true } }, async (request, reply) => {
    const signature = request.headers["x-hub-signature-256"];
    const rawBody = request.rawBody;
    if (typeof signature !== "string" || typeof rawBody !== "string") {
      return reply.code(401).send({ error: "missing signature" });
    }

    const expected = `sha256=${createHmac("sha256", VETTER_WEBHOOK_SECRET).update(rawBody).digest("hex")}`;
    const expectedBuffer = Buffer.from(expected);
    const providedBuffer = Buffer.from(signature);
    const valid = expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
    if (!valid) {
      return reply.code(401).send({ error: "invalid signature" });
    }

    const eventName = request.headers["x-github-event"];
    const deliveryId = request.headers["x-github-delivery"];
    if (typeof eventName !== "string" || typeof deliveryId !== "string") {
      return reply.code(400).send({ error: "missing event headers" });
    }

    if (typeof request.body !== "object" || request.body === null) {
      return reply.code(400).send({ error: "malformed payload" });
    }
    const payload = request.body as Record<string, unknown>;
    const repository = payload.repository as WebhookRepository | undefined;
    const installation = payload.installation as WebhookInstallation | undefined;

    if (!repository || !installation) {
      return reply.code(400).send({ error: "malformed payload" });
    }

    try {
      const octokit = createInstallationClient({
        appId: VETTER_APP_ID,
        privateKey: VETTER_PRIVATE_KEY,
        installationId: installation.id
      });
      const botLogin = await resolveBotLogin(octokit);
      const gateway = createOctokitGateway(octokit);

      const sender = payload.sender as { login?: unknown } | undefined;
      if (eventName === "pull_request_review_thread" && sender?.login === botLogin) {
        return reply.code(202).send({ accepted: false, reason: "bot-authored review thread event" });
      }

      const configRef = resolveConfigRef(eventName, payload);
      const repositoryYaml = configRef
        ? await gateway.getFileContent({
            owner: repository.owner.login,
            repo: repository.name,
            ref: configRef,
            path: ".vetter.yml"
          })
        : null;

      const repoKey = `${repository.owner.login}/${repository.name}`;
      const envOverride = VETTER_MODEL_NAME ? { review: { model: VETTER_MODEL_NAME } } : {};
      const external = deepMerge(envOverride, perRepositoryConfig[repoKey] ?? {});

      const config = loadConfig({ repositoryText: repositoryYaml ?? "", external, runtime: "app" });

      if (config.runtime && config.runtime !== "app") {
        return reply.code(202).send({ accepted: false, reason: "runtime disabled" });
      }

      if (eventName === "push" && !config.events.push.enabled) {
        return reply.code(202).send({ accepted: false, reason: "push reviews disabled" });
      }

      const contexts = await normalizeWebhookEvent({
        eventName,
        payload,
        deliveryId,
        gateway,
        branchPatterns: config.events.push.branchPatterns
      });

      for (const context of contexts) {
        scheduler.enqueue({
          key: `${context.repository.owner}/${context.repository.name}#${String(context.pullRequestNumber)}`,
          run: (signal) => runContextReview({ context, config, gateway, octokit, botLogin, signal })
        });
      }

      return reply.code(202).send({ accepted: true, contexts: contexts.length });
    } catch (error) {
      app.log.error({ error }, "failed to process webhook");
      return reply.code(500).send({ error: "failed to schedule review" });
    }
  });

  await app.listen({ port: PORT, host: "0.0.0.0" });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

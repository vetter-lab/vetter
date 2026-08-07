# GitHub App setup

Vetter's App runtime is a stateless Fastify server that receives GitHub
webhook deliveries and reviews the affected pull request. A repository can
run entirely on the App with no Action workflow at all.

## 1. Create the GitHub App

1. In GitHub, go to **Settings → Developer settings → GitHub Apps → New
   GitHub App**.
2. Set the **Webhook URL** to `https://<your-host>/webhooks/github`.
3. Set a **Webhook secret** and record it — it becomes `VETTER_WEBHOOK_SECRET`.
4. Under **Permissions**, grant:
   - Contents: Read-only
   - Pull requests: Read and write
   - Checks: Read and write
   - Metadata: Read-only
5. Under **Subscribe to events**, enable:
   - Pull request
   - Pull request review thread
   - Push
6. Choose which repositories the App is installed on (all or selected).

After creation, generate a private key from the App settings page. Record the
**App ID** and the private key — they become `VETTER_APP_ID` and
`VETTER_PRIVATE_KEY`.

## 2. Configure environment variables

Copy `.env.example` to `.env` (or set these as real secrets in your
deployment platform) and fill in:

| Variable | Purpose |
| --- | --- |
| `VETTER_WEBHOOK_SECRET` | Verifies the `x-hub-signature-256` header on every webhook delivery. Deliveries with a missing or invalid signature are rejected with HTTP 401 before the payload is parsed. |
| `VETTER_APP_ID` | The GitHub App's ID, used to mint installation access tokens. |
| `VETTER_PRIVATE_KEY` | The App's PEM private key, used to sign the JWT for installation authentication. Never log this value. |
| `VETTER_CONFIG_JSON` | Optional JSON object keyed by `owner/repo`, merged on top of each repository's `.vetter.yml` as the external configuration layer. Defaults to `{}`. |
| `VETTER_MODEL_API_KEY` | API key for the OpenAI-compatible review model. |
| `VETTER_MODEL_BASE_URL` | Optional base URL override for the model endpoint. |
| `VETTER_MODEL_NAME` | Optional model name override, merged into every repository's configuration as `review.model`. |
| `PORT` | Port the Fastify server listens on. Defaults to `3000`. |

## 3. Installation tokens

The server never uses a long-lived personal access token. On each webhook
delivery, it reads the installation ID from the payload and mints a
short-lived installation access token via `@octokit/auth-app`. That token is
used only for the duration of the review (including the temporary shallow
git checkout used by static analyzers) and is discarded afterward.

## 4. Health check

`GET /healthz` returns `{ "status": "ok" }` and requires no authentication.
Point your platform's liveness/readiness probe at this endpoint. It responds
immediately even while a review is in progress, since review work runs on
an in-memory scheduler independent of the HTTP request/response cycle.

## 5. Deploying

Build and run the container:

```bash
docker build -t vetter-app .
docker run -p 3000:3000 --env-file .env vetter-app
```

Or run directly with Node after `pnpm build:app`:

```bash
node dist/app/server.js
```

## 6. Scheduling and delivery semantics

The App runtime keeps an in-memory `Map` of one `AbortController` per
`owner/repo#pullRequestNumber`. A new webhook delivery for a PR that already
has a review running aborts the older one before starting — this is the
"latest-wins" rule described in the design doc. There is no durable queue:
if the process restarts, any in-flight or queued review is lost. A later PR
event (a new commit, or GitHub's own webhook redelivery) triggers another
run, so this is an acceptable limitation for a first version rather than a
correctness bug.

Running the App runtime for a repository and also enabling the Action
workflow on the same repository is not recommended — see
[configuration.md](configuration.md) for how the `runtime` field guards
against double-reviewing.

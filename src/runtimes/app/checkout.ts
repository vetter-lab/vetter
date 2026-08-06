import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface CheckoutInput {
  owner: string;
  repo: string;
  headSha: string;
  /** Installation access token; embedded only in the local git remote URL, never logged. */
  token: string;
}

export interface Checkout {
  path: string;
  cleanup: () => Promise<void>;
}

function runGit(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, shell: false, stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`git ${args.join(" ")} exited with code ${String(code)}`));
      }
    });
  });
}

/**
 * Shallow-clones one commit into a fresh temp directory so analyzer
 * providers, which read from disk, have real files to scan. Unlike the
 * Action runtime (which relies on the workflow's `actions/checkout` step),
 * the App runtime has no persistent checkout, so this is created and torn
 * down per review run via `cleanup()`.
 */
export async function checkoutPullRequest(input: CheckoutInput): Promise<Checkout> {
  const path = await mkdtemp(join(tmpdir(), "vetter-"));
  const remote = `https://x-access-token:${input.token}@github.com/${input.owner}/${input.repo}.git`;

  try {
    await runGit(["init"], path);
    await runGit(["remote", "add", "origin", remote], path);
    await runGit(["fetch", "--depth", "1", "origin", input.headSha], path);
    await runGit(["checkout", "FETCH_HEAD"], path);
  } catch (error) {
    await rm(path, { recursive: true, force: true });
    throw error;
  }

  return {
    path,
    cleanup: () => rm(path, { recursive: true, force: true })
  };
}

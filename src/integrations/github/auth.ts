import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "octokit";

export interface InstallationClientInput {
  appId: string;
  privateKey: string;
  installationId: number;
}

/**
 * Creates an Octokit client authenticated as a GitHub App installation.
 * Used exclusively by the App runtime; never logs `privateKey` or any
 * derived installation token.
 */
export function createInstallationClient(input: InstallationClientInput): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: input.appId,
      privateKey: input.privateKey,
      installationId: input.installationId
    }
  });
}

/**
 * Creates an Octokit client authenticated with a plain token, e.g. the
 * Action runtime's `GITHUB_TOKEN` or an explicitly configured App token.
 */
export function createTokenClient(token: string): Octokit {
  return new Octokit({ auth: token });
}

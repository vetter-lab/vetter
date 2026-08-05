/**
 * Redacts secret-shaped substrings from arbitrary repository-sourced text
 * before it can be embedded into a model prompt. This is a best-effort,
 * defense-in-depth measure: repository content is untrusted and must never
 * carry credentials into an outbound model request.
 *
 * Patterns covered: PEM-style private key blocks, `Authorization: Bearer`
 * style tokens, and common vendor API-key shapes (OpenAI, GitHub, AWS,
 * Slack, Google). This list is intentionally conservative (namespaced
 * prefixes/structure) to avoid mangling ordinary code with false positives.
 */
const SECRET_PATTERNS: RegExp[] = [
  // PEM private key blocks (RSA, EC, PKCS8, OpenSSH, generic).
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  /-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]*?-----END OPENSSH PRIVATE KEY-----/g,
  // Bearer tokens, e.g. `Authorization: Bearer <token>`.
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  // OpenAI-style API keys.
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  // GitHub tokens (personal access, OAuth, app, refresh, server-to-server).
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
  // AWS access key IDs.
  /\bAKIA[0-9A-Z]{16}\b/g,
  // Slack tokens.
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  // Google API keys.
  /\bAIza[0-9A-Za-z_-]{35}\b/g
];

const REDACTED = "[REDACTED]";

/**
 * Replaces every match of a known secret shape with a fixed placeholder.
 * Safe to call on already-redacted text (idempotent).
 */
export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((current, pattern) => current.replace(pattern, REDACTED), text);
}

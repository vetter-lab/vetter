import { spawn } from "node:child_process";

export interface RunProcessInput {
  /** Fixed executable name; never derived from caller-supplied strings. */
  command: string;
  /** Argument array passed directly to `spawn`, never a shell string. */
  args: string[];
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface RunProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type ProcessRunner = (input: RunProcessInput) => Promise<RunProcessResult>;

/**
 * Runs a fixed executable with a fixed argument array. Always uses `spawn`
 * with an argument array (`shell: false`) so no part of the command line is
 * ever interpreted by a shell: this is the command-injection guardrail for
 * every analyzer adapter built on top of this runner.
 *
 * Enforces `timeoutMs` by killing the child process, and caps captured
 * stdout/stderr at `maxOutputBytes` each by dropping bytes beyond the cap
 * rather than buffering them, so a runaway analyzer cannot exhaust memory.
 */
export const runAnalyzerProcess: ProcessRunner = (input) => {
  return new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, input.timeoutMs);

    const capture = (chunk: Buffer, currentBytes: number, appendTo: (text: string) => void): number => {
      if (currentBytes >= input.maxOutputBytes) {
        return currentBytes;
      }
      const remaining = input.maxOutputBytes - currentBytes;
      const slice = chunk.subarray(0, remaining);
      appendTo(slice.toString("utf8"));
      return currentBytes + slice.length;
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBytes = capture(chunk, stdoutBytes, (text) => {
        stdout += text;
      });
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBytes = capture(chunk, stderrBytes, (text) => {
        stderr += text;
      });
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, timedOut });
    });
  });
};

import fsSync from "node:fs";

/**
 * Check if a process is a zombie on Linux by reading /proc/<pid>/status.
 * Returns false on non-Linux platforms or if the proc file can't be read.
 */
function isZombieProcess(pid: number): boolean {
  if (process.platform !== "linux") {
    return false;
  }
  try {
    const status = fsSync.readFileSync(`/proc/${pid}/status`, "utf8");
    const stateMatch = status.match(/^State:\s+(\S)/m);
    return stateMatch?.[1] === "Z";
  } catch {
    return false;
  }
}

/**
 * Check if a pid belongs to a clawdbot process by examining /proc/<pid>/cmdline on Linux.
 * This helps detect stale locks where the pid has been reused by another process after a reboot.
 * Returns true if the process is a clawdbot/gateway process, false otherwise.
 * On non-Linux platforms, returns true (identity check not available).
 */
export function isPidClawdbotProcess(pid: number): boolean {
  if (process.platform !== "linux") {
    // On non-Linux platforms, we can't verify process identity
    return true;
  }
  try {
    const cmdline = fsSync.readFileSync(`/proc/${pid}/cmdline`, "utf8");
    // Check if the command line contains "clawdbot" or "gateway" (case-insensitive)
    const lowerCmdline = cmdline.toLowerCase();
    if (lowerCmdline.includes("clawdbot") || lowerCmdline.includes("gateway")) {
      return true;
    }
    // Also check for known entry point patterns
    const entryCandidates = [
      "dist/index.js",
      "dist/entry.js",
      "openclaw.mjs",
      "scripts/run-node.mjs",
      "src/index.ts",
    ];
    for (const entry of entryCandidates) {
      if (lowerCmdline.includes(entry)) {
        return true;
      }
    }
    return false;
  } catch {
    // If we can't read the cmdline, assume it's not a clawdbot process
    return false;
  }
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  if (isZombieProcess(pid)) {
    return false;
  }
  return true;
}

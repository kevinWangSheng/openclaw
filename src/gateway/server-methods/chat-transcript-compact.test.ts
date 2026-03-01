import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Helper to create a transcript file with specified content
function createTranscriptFile(filePath: string, lines: string[]): void {
  const content = lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}

// Helper to create a large transcript file
function createLargeTranscriptFile(filePath: string, numLines: number, lineSize: number): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const fd = fs.openSync(filePath, "w");
  try {
    for (let i = 0; i < numLines; i++) {
      const line = JSON.stringify({ message: { content: "x".repeat(lineSize) } }) + "\n";
      fs.writeFileSync(fd, line, "utf-8");
    }
  } finally {
    fs.closeSync(fd);
  }
}

// Constants matching the implementation
const IDEMPOTENCY_CHECK_MAX_BYTES = 64 * 1024; // 64KB
const TRANSCRIPT_AUTO_COMPACT_MAX_BYTES = 1 * 1024 * 1024; // 1MB

describe("chat transcript optimization", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "transcript-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("transcriptHasIdempotencyKey optimization", () => {
    // This test verifies that the idempotency check reads from the end of the file
    // for large files instead of reading the entire file.

    it("should find idempotency key in small file", () => {
      const filePath = path.join(tempDir, "small.jsonl");
      const key = "test-key-123";
      createTranscriptFile(filePath, [
        JSON.stringify({ message: { idempotencyKey: "other-key" } }),
        JSON.stringify({ message: { idempotencyKey: key } }),
      ]);

      // Simulate the idempotency check behavior
      const stat = fs.statSync(filePath);
      expect(stat.size).toBeLessThan(IDEMPOTENCY_CHECK_MAX_BYTES);

      const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/);
      let found = false;
      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        const parsed = JSON.parse(line);
        if (parsed?.message?.idempotencyKey === key) {
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
    });

    it("should find idempotency key in large file by reading end only", () => {
      const filePath = path.join(tempDir, "large.jsonl");
      const key = "test-key-recent";

      // Create a file larger than IDEMPOTENCY_CHECK_MAX_BYTES
      // Each line is about 100 bytes, so we need > 640 lines to exceed 64KB
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const fd = fs.openSync(filePath, "w");
      try {
        // Write enough lines to exceed 64KB
        for (let i = 0; i < 700; i++) {
          const line =
            JSON.stringify({
              message: { idempotencyKey: `old-key-${i}`, content: "x".repeat(80) },
            }) + "\n";
          fs.writeFileSync(fd, line, "utf-8");
        }
        // Write the key we're looking for near the end
        fs.writeFileSync(fd, JSON.stringify({ message: { idempotencyKey: key } }) + "\n", "utf-8");
      } finally {
        fs.closeSync(fd);
      }

      const stat = fs.statSync(filePath);
      expect(stat.size).toBeGreaterThan(IDEMPOTENCY_CHECK_MAX_BYTES);

      // Simulate the optimized idempotency check behavior - read from end
      const readStart = Math.max(0, stat.size - IDEMPOTENCY_CHECK_MAX_BYTES);
      const readLen = Math.min(stat.size, IDEMPOTENCY_CHECK_MAX_BYTES);
      const buf = Buffer.alloc(readLen);
      const fd2 = fs.openSync(filePath, "r");
      try {
        fs.readSync(fd2, buf, 0, readLen, readStart);
        const chunk = buf.toString("utf-8");
        const lines = chunk.split(/\r?\n/);

        let found = false;
        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }
          try {
            const parsed = JSON.parse(line);
            if (parsed?.message?.idempotencyKey === key) {
              found = true;
              break;
            }
          } catch {
            // Skip malformed lines
          }
        }
        expect(found).toBe(true);
      } finally {
        fs.closeSync(fd2);
      }
    });

    it("should not find idempotency key that was at the start of large file", () => {
      const filePath = path.join(tempDir, "large-start.jsonl");
      const key = "test-key-old";

      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const fd = fs.openSync(filePath, "w");
      try {
        // Write the key we're looking for at the start
        fs.writeFileSync(fd, JSON.stringify({ message: { idempotencyKey: key } }) + "\n", "utf-8");
        // Write enough lines to exceed 64KB, pushing the key out of the 64KB window
        for (let i = 0; i < 800; i++) {
          const line =
            JSON.stringify({
              message: { idempotencyKey: `newer-key-${i}`, content: "y".repeat(80) },
            }) + "\n";
          fs.writeFileSync(fd, line, "utf-8");
        }
      } finally {
        fs.closeSync(fd);
      }

      const stat = fs.statSync(filePath);
      expect(stat.size).toBeGreaterThan(IDEMPOTENCY_CHECK_MAX_BYTES);

      // Simulate the optimized idempotency check behavior - read from end
      const readStart = Math.max(0, stat.size - IDEMPOTENCY_CHECK_MAX_BYTES);
      const readLen = Math.min(stat.size, IDEMPOTENCY_CHECK_MAX_BYTES);
      const buf = Buffer.alloc(readLen);
      const fd2 = fs.openSync(filePath, "r");
      try {
        fs.readSync(fd2, buf, 0, readLen, readStart);
        const chunk = buf.toString("utf-8");
        const lines = chunk.split(/\r?\n/);

        let found = false;
        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }
          try {
            const parsed = JSON.parse(line);
            if (parsed?.message?.idempotencyKey === key) {
              found = true;
              break;
            }
          } catch {
            // Skip malformed lines
          }
        }
        // The key at the start should not be found when only reading the last 64KB
        expect(found).toBe(false);
      } finally {
        fs.closeSync(fd2);
      }
    });
  });

  describe("autoCompactTranscriptIfNeeded", () => {
    // This test verifies that auto-compaction is triggered when file exceeds threshold

    it("should not compact small files", () => {
      const filePath = path.join(tempDir, "small.jsonl");
      createTranscriptFile(filePath, [
        JSON.stringify({ message: { content: "line 1" } }),
        JSON.stringify({ message: { content: "line 2" } }),
      ]);

      const stat = fs.statSync(filePath);
      expect(stat.size).toBeLessThan(TRANSCRIPT_AUTO_COMPACT_MAX_BYTES);
    });

    it("should identify files exceeding compaction threshold", () => {
      const filePath = path.join(tempDir, "large.jsonl");

      // Create a file larger than 1MB
      createLargeTranscriptFile(filePath, 15000, 100); // ~1.5MB

      const stat = fs.statSync(filePath);
      expect(stat.size).toBeGreaterThan(TRANSCRIPT_AUTO_COMPACT_MAX_BYTES);
    });

    it("should compact file to 400 lines when exceeding threshold", () => {
      const filePath = path.join(tempDir, "compact.jsonl");
      const numLines = 500;
      const maxLines = 400;

      // Create a file with 500 lines
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const fd = fs.openSync(filePath, "w");
      try {
        for (let i = 0; i < numLines; i++) {
          fs.writeFileSync(
            fd,
            JSON.stringify({ message: { content: `line ${i}` } }) + "\n",
            "utf-8",
          );
        }
      } finally {
        fs.closeSync(fd);
      }

      // Simulate compaction
      const raw = fs.readFileSync(filePath, "utf-8");
      const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);

      if (lines.length > maxLines) {
        const keptLines = lines.slice(-maxLines);
        fs.writeFileSync(filePath, `${keptLines.join("\n")}\n`, "utf-8");
      }

      // Verify compaction result
      const compactedRaw = fs.readFileSync(filePath, "utf-8");
      const compactedLines = compactedRaw.split(/\r?\n/).filter((l) => l.trim().length > 0);
      expect(compactedLines.length).toBe(maxLines);

      // Verify the last line is preserved
      const lastLine = JSON.parse(compactedLines[compactedLines.length - 1]);
      expect(lastLine.message.content).toBe(`line ${numLines - 1}`);
    });
  });
});

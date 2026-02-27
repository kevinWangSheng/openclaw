/**
 * Cleanup script for stale content-hashed dist files.
 *
 * When OpenClaw is updated via npm global install, old content-hashed files
 * may remain in the dist/ folder, causing import errors like:
 * "Cannot find module '/.../openclaw/dist/tool-loop-detection-Ck6LbMx_.js'"
 *
 * This script removes stale .js files from dist/ that are not part of the current build.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DIST_DIR = path.join(__dirname, "dist");

// Get all .js files in dist/
function getJsFiles(dir) {
  const files = [];
  if (!fs.existsSync(dir)) {
    return files;
  }

  for (const file of fs.readdirSync(dir)) {
    if (file.endsWith(".js")) {
      files.push(path.join(dir, file));
    }
  }
  return files;
}

// Get all files that should exist based on the build
// We'll check which files are referenced in the built JS files
function getReferencedFiles() {
  const referenced = new Set();
  const jsFiles = getJsFiles(DIST_DIR);

  for (const file of jsFiles) {
    try {
      const content = fs.readFileSync(file, "utf-8");
      // Match import statements like: import x from './file-HASH.js'
      const matches = content.matchAll(/from\s+['"](\.[^'"]+\.js)['"]/g);
      for (const match of matches) {
        const relativePath = match[1];
        // Resolve relative to the current file
        const resolvedPath = path.resolve(path.dirname(file), relativePath);
        referenced.add(resolvedPath);
      }

      // Also match dynamic imports
      const dynamicMatches = content.matchAll(/import\(['"]([^'"]+\.js)['"]\)/g);
      for (const match of dynamicMatches) {
        const relativePath = match[1];
        const resolvedPath = path.resolve(path.dirname(file), relativePath);
        referenced.add(resolvedPath);
      }
    } catch {
      // Ignore read errors
    }
  }

  return referenced;
}

function cleanup() {
  console.log("Running dist cleanup...");

  const jsFiles = getJsFiles(DIST_DIR);
  const referencedFiles = getReferencedFiles();

  let removedCount = 0;

  for (const file of jsFiles) {
    // Keep files that are referenced by other files in dist/
    // This preserves the current build's files
    if (referencedFiles.has(file)) {
      continue;
    }

    // Also keep index.js and plugin-sdk entry points
    const fileName = path.basename(file);
    if (
      fileName === "index.js" ||
      fileName.startsWith("plugin-sdk") ||
      fileName === "openclaw.mjs"
    ) {
      continue;
    }

    // Remove stale files
    try {
      fs.unlinkSync(file);
      console.log(`Removed stale file: ${fileName}`);
      removedCount++;
    } catch (err) {
      console.error(`Failed to remove ${file}: ${err.message}`);
    }
  }

  if (removedCount > 0) {
    console.log(`Cleanup complete. Removed ${removedCount} stale file(s).`);
  } else {
    console.log("No stale files to remove.");
  }
}

// Only run if executed directly
cleanup();

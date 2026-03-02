import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { IStorageProvider, ICryptoStorageProvider } from "@vector-im/matrix-bot-sdk";
import {
  LogService,
  MatrixClient,
  SimpleFsStorageProvider,
  RustSdkCryptoStorageProvider,
} from "@vector-im/matrix-bot-sdk";
import { ensureMatrixSdkLoggingConfigured } from "./logging.js";
import {
  maybeMigrateLegacyStorage,
  resolveMatrixStoragePaths,
  writeStorageMeta,
} from "./storage.js";

/**
 * Check if the native crypto library exists for the current platform,
 * and download it if missing.
 */
async function ensureMatrixCryptoNativeModule(): Promise<boolean> {
  // Map platform+arch to the expected native module filename
  const platform = process.platform;
  const arch = process.arch;

  let libName: string;
  if (platform === "darwin") {
    libName = arch === "arm64" ? "matrix-sdk-crypto.darwin-arm64.node" : "matrix-sdk-crypto.darwin-x64.node";
  } else if (platform === "linux") {
    libName = arch === "arm64" ? "matrix-sdk-crypto.linux-arm64-gnu.node" : "matrix-sdk-crypto.linux-x64-gnu.node";
  } else if (platform === "win32") {
    libName = arch === "x64" ? "matrix-sdk-crypto.win32-x64.node" : "matrix-sdk-crypto.win32-arm64.node";
  } else {
    return false;
  }

  // Try to resolve the module path
  let modulePath: string;
  try {
    // Create a temporary require to resolve the module location
    const resolved = require.resolve("@matrix-org/matrix-sdk-crypto-nodejs");
    modulePath = path.dirname(resolved);
  } catch {
    LogService.warn("MatrixClientLite", "Cannot resolve @matrix-org/matrix-sdk-crypto-nodejs path");
    return false;
  }

  const nativeLibPath = path.join(modulePath, libName);

  // Check if the native library exists
  if (fs.existsSync(nativeLibPath)) {
    return true;
  }

  // Native library not found, try to download it
  LogService.warn(
    "MatrixClientLite",
    `Native crypto library not found (${libName}), attempting to download...`,
  );

  const downloadScriptPath = path.join(modulePath, "download-lib.js");

  if (!fs.existsSync(downloadScriptPath)) {
    LogService.warn(
      "MatrixClientLite",
      "Download script not found, cannot auto-download crypto library",
    );
    return false;
  }

  try {
    // Run the download script
    const result = spawnSync(process.execPath, [downloadScriptPath], {
      cwd: modulePath,
      stdio: "pipe",
      encoding: "utf-8",
    });

    if (result.status !== 0) {
      LogService.warn(
        "MatrixClientLite",
        `Failed to download crypto library: ${result.stderr || result.error?.message || "Unknown error"}`,
      );
      return false;
    }

    // Verify the library was downloaded
    if (fs.existsSync(nativeLibPath)) {
      LogService.info("MatrixClientLite", `Successfully downloaded crypto library: ${libName}`);
      return true;
    }

    LogService.warn("MatrixClientLite", "Download completed but library not found");
    return false;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    LogService.warn("MatrixClientLite", `Error downloading crypto library: ${message}`);
    return false;
  }
}

function sanitizeUserIdList(input: unknown, label: string): string[] {
  if (input == null) {
    return [];
  }
  if (!Array.isArray(input)) {
    LogService.warn(
      "MatrixClientLite",
      `Expected ${label} list to be an array, got ${typeof input}`,
    );
    return [];
  }
  const filtered = input.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  );
  if (filtered.length !== input.length) {
    LogService.warn(
      "MatrixClientLite",
      `Dropping ${input.length - filtered.length} invalid ${label} entries from sync payload`,
    );
  }
  return filtered;
}

export async function createMatrixClient(params: {
  homeserver: string;
  userId: string;
  accessToken: string;
  encryption?: boolean;
  localTimeoutMs?: number;
  accountId?: string | null;
}): Promise<MatrixClient> {
  ensureMatrixSdkLoggingConfigured();
  const env = process.env;

  // Create storage provider
  const storagePaths = resolveMatrixStoragePaths({
    homeserver: params.homeserver,
    userId: params.userId,
    accessToken: params.accessToken,
    accountId: params.accountId,
    env,
  });
  maybeMigrateLegacyStorage({ storagePaths, env });
  fs.mkdirSync(storagePaths.rootDir, { recursive: true });
  const storage: IStorageProvider = new SimpleFsStorageProvider(storagePaths.storagePath);

  // Create crypto storage if encryption is enabled
  let cryptoStorage: ICryptoStorageProvider | undefined;
  if (params.encryption) {
    fs.mkdirSync(storagePaths.cryptoPath, { recursive: true });

    try {
      // Ensure the native crypto module is available (download if missing)
      const cryptoReady = await ensureMatrixCryptoNativeModule();
      if (!cryptoReady) {
        LogService.warn(
          "MatrixClientLite",
          "Crypto native module not available, E2EE disabled",
        );
      } else {
        const { StoreType } = await import("@matrix-org/matrix-sdk-crypto-nodejs");
        cryptoStorage = new RustSdkCryptoStorageProvider(storagePaths.cryptoPath, StoreType.Sqlite);
      }
    } catch (err) {
      LogService.warn(
        "MatrixClientLite",
        "Failed to initialize crypto storage, E2EE disabled:",
        err,
      );
    }
  }

  writeStorageMeta({
    storagePaths,
    homeserver: params.homeserver,
    userId: params.userId,
    accountId: params.accountId,
  });

  const client = new MatrixClient(params.homeserver, params.accessToken, storage, cryptoStorage);

  if (client.crypto) {
    const originalUpdateSyncData = client.crypto.updateSyncData.bind(client.crypto);
    client.crypto.updateSyncData = async (
      toDeviceMessages,
      otkCounts,
      unusedFallbackKeyAlgs,
      changedDeviceLists,
      leftDeviceLists,
    ) => {
      const safeChanged = sanitizeUserIdList(changedDeviceLists, "changed device list");
      const safeLeft = sanitizeUserIdList(leftDeviceLists, "left device list");
      try {
        return await originalUpdateSyncData(
          toDeviceMessages,
          otkCounts,
          unusedFallbackKeyAlgs,
          safeChanged,
          safeLeft,
        );
      } catch (err) {
        const message = typeof err === "string" ? err : err instanceof Error ? err.message : "";
        if (message.includes("Expect value to be String")) {
          LogService.warn(
            "MatrixClientLite",
            "Ignoring malformed device list entries during crypto sync",
            message,
          );
          return;
        }
        throw err;
      }
    };
  }

  return client;
}

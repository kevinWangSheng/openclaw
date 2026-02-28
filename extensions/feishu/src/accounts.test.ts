import type { ClawdbotConfig } from "openclaw/plugin-sdk";
import { describe, it, expect } from "vitest";
import {
  resolveDefaultFeishuAccountId,
  resolveFeishuAccount,
  listFeishuAccountIds,
} from "./accounts.js";

describe("Feishu accounts", () => {
  describe("resolveDefaultFeishuAccountId", () => {
    it("returns 'default' when no accounts configured", () => {
      const cfg = { channels: {} } as ClawdbotConfig;
      expect(resolveDefaultFeishuAccountId(cfg)).toBe("default");
    });

    it("returns 'default' when default account exists", () => {
      const cfg = {
        channels: {
          feishu: {
            accounts: {
              default: { appId: "app1", appSecret: "secret1" },
            },
          },
        },
      } as ClawdbotConfig;
      expect(resolveDefaultFeishuAccountId(cfg)).toBe("default");
    });

    it("returns first account when no default exists", () => {
      const cfg = {
        channels: {
          feishu: {
            accounts: {
              "router-a": { appId: "app1", appSecret: "secret1" },
              "router-b": { appId: "app2", appSecret: "secret2" },
            },
          },
        },
      } as ClawdbotConfig;
      // Returns first sorted account
      expect(resolveDefaultFeishuAccountId(cfg)).toBe("router-a");
    });

    it("honors defaultAccount configuration", () => {
      const cfg = {
        channels: {
          feishu: {
            defaultAccount: "router-d",
            accounts: {
              "router-a": { appId: "app1", appSecret: "secret1" },
              "router-b": { appId: "app2", appSecret: "secret2" },
              "router-d": { appId: "app4", appSecret: "secret4" },
            },
          },
        },
      } as ClawdbotConfig;
      expect(resolveDefaultFeishuAccountId(cfg)).toBe("router-d");
    });

    it("ignores empty defaultAccount", () => {
      const cfg = {
        channels: {
          feishu: {
            defaultAccount: "",
            accounts: {
              "router-a": { appId: "app1", appSecret: "secret1" },
            },
          },
        },
      } as ClawdbotConfig;
      expect(resolveDefaultFeishuAccountId(cfg)).toBe("router-a");
    });

    it("ignores whitespace-only defaultAccount", () => {
      const cfg = {
        channels: {
          feishu: {
            defaultAccount: "   ",
            accounts: {
              "router-a": { appId: "app1", appSecret: "secret1" },
            },
          },
        },
      } as ClawdbotConfig;
      expect(resolveDefaultFeishuAccountId(cfg)).toBe("router-a");
    });
  });

  describe("resolveFeishuAccount", () => {
    it("resolves explicit accountId when provided", () => {
      const cfg = {
        channels: {
          feishu: {
            defaultAccount: "router-d",
            accounts: {
              "router-a": { appId: "app1", appSecret: "secret1" },
              "router-d": { appId: "app4", appSecret: "secret4" },
            },
          },
        },
      } as ClawdbotConfig;
      const account = resolveFeishuAccount({ cfg, accountId: "router-a" });
      expect(account.accountId).toBe("router-a");
      expect(account.appId).toBe("app1");
    });

    it("uses defaultAccount when accountId is not provided", () => {
      const cfg = {
        channels: {
          feishu: {
            defaultAccount: "router-d",
            accounts: {
              "router-a": { appId: "app1", appSecret: "secret1" },
              "router-d": { appId: "app4", appSecret: "secret4" },
            },
          },
        },
      } as ClawdbotConfig;
      const account = resolveFeishuAccount({ cfg });
      expect(account.accountId).toBe("router-d");
      expect(account.appId).toBe("app4");
    });

    it("uses defaultAccount when accountId is null", () => {
      const cfg = {
        channels: {
          feishu: {
            defaultAccount: "router-d",
            accounts: {
              "router-a": { appId: "app1", appSecret: "secret1" },
              "router-d": { appId: "app4", appSecret: "secret4" },
            },
          },
        },
      } as ClawdbotConfig;
      const account = resolveFeishuAccount({ cfg, accountId: null });
      expect(account.accountId).toBe("router-d");
      expect(account.appId).toBe("app4");
    });

    it("uses defaultAccount when accountId is empty string", () => {
      const cfg = {
        channels: {
          feishu: {
            defaultAccount: "router-d",
            accounts: {
              "router-a": { appId: "app1", appSecret: "secret1" },
              "router-d": { appId: "app4", appSecret: "secret4" },
            },
          },
        },
      } as ClawdbotConfig;
      const account = resolveFeishuAccount({ cfg, accountId: "" });
      expect(account.accountId).toBe("router-d");
      expect(account.appId).toBe("app4");
    });

    it("falls back to first account when no defaultAccount configured", () => {
      const cfg = {
        channels: {
          feishu: {
            accounts: {
              "router-a": { appId: "app1", appSecret: "secret1" },
              "router-b": { appId: "app2", appSecret: "secret2" },
            },
          },
        },
      } as ClawdbotConfig;
      const account = resolveFeishuAccount({ cfg });
      expect(account.accountId).toBe("router-a");
      expect(account.appId).toBe("app1");
    });

    it("falls back to 'default' when no accounts configured", () => {
      const cfg = { channels: { feishu: {} } } as ClawdbotConfig;
      const account = resolveFeishuAccount({ cfg });
      expect(account.accountId).toBe("default");
      expect(account.configured).toBe(false);
    });
  });

  describe("listFeishuAccountIds", () => {
    it("returns ['default'] when no accounts configured", () => {
      const cfg = { channels: {} } as ClawdbotConfig;
      expect(listFeishuAccountIds(cfg)).toEqual(["default"]);
    });

    it("returns sorted account IDs", () => {
      const cfg = {
        channels: {
          feishu: {
            accounts: {
              "router-c": { appId: "app3" },
              "router-a": { appId: "app1" },
              "router-b": { appId: "app2" },
            },
          },
        },
      } as ClawdbotConfig;
      expect(listFeishuAccountIds(cfg)).toEqual(["router-a", "router-b", "router-c"]);
    });
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ refresh: vi.fn(), adc: vi.fn() }));
vi.mock("googleapis", () => {
  class OAuth2 {
    credentials: any = {};
    _clientId: string;
    _clientSecret: string;
    constructor(id: string, secret: string) {
      this._clientId = id;
      this._clientSecret = secret;
    }
    setCredentials(c: any) {
      this.credentials = c;
    }
    on() {}
    refreshAccessToken() {
      return h.refresh();
    }
  }
  class GoogleAuth {
    getClient() {
      return h.adc();
    }
  }
  return { google: { auth: { OAuth2, GoogleAuth }, searchconsole: vi.fn(() => ({ built: true })) } };
});
vi.mock("open", () => ({ default: vi.fn(async () => undefined) }));

import { config, SCOPE_READONLY, SCOPE_WRITE } from "./config.js";
import { getGscService, isDeadGrant } from "./auth.js";

let dir: string;
const writeToken = (extra: object = {}) =>
  fs.writeFileSync(
    config.tokenFile,
    JSON.stringify({ token: "old", refresh_token: "r", client_id: "id", client_secret: "sec", expiry: "2000-01-01T00:00:00Z", ...extra }),
  );

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gsc-auth-"));
  Object.assign(config, {
    configDir: dir,
    tokenFile: path.join(dir, "token.json"),
    oldTokenFile: path.join(dir, "old", "token.json"),
    oauthClientSecretsFile: path.join(dir, "missing_secrets.json"),
    oauthClientSecretsExplicit: false,
    oauthClientId: undefined,
    oauthClientSecret: undefined,
    credentialsPath: undefined,
    possibleCredentialPaths: [undefined],
    skipOauth: false,
    allowDestructive: false,
    scopes: [SCOPE_READONLY],
  });
  h.refresh.mockReset();
  h.adc.mockReset().mockRejectedValue(new Error("no ADC"));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("getGscService", () => {
  it("refreshes an expired token and saves it", async () => {
    writeToken();
    h.refresh.mockResolvedValue({ credentials: { access_token: "new", refresh_token: "r", expiry_date: Date.now() + 3600_000 } });
    expect(await getGscService()).toEqual({ built: true });
    expect(JSON.parse(fs.readFileSync(config.tokenFile, "utf8")).token).toBe("new");
  });

  it("keeps the token file when refresh fails for a non-grant reason", async () => {
    writeToken();
    h.refresh.mockRejectedValue(new Error("invalid_scope: bad scope"));
    await expect(getGscService()).rejects.toThrow(/Failed to refresh the OAuth token/);
    expect(fs.existsSync(config.tokenFile)).toBe(true);
  });

  it("deletes the token file on invalid_grant", async () => {
    writeToken();
    h.refresh.mockRejectedValue(new Error("invalid_grant: Token has been expired or revoked."));
    await expect(getGscService()).rejects.toThrow();
    expect(fs.existsSync(config.tokenFile)).toBe(false);
  });

  it("never deletes a corrupt token file", async () => {
    fs.writeFileSync(config.tokenFile, "{not json");
    await expect(getGscService()).rejects.toThrow(/OAuth client credentials not found/);
    expect(fs.readFileSync(config.tokenFile, "utf8")).toBe("{not json");
  });

  it("reports a scope mismatch without touching the token", async () => {
    config.scopes = [SCOPE_WRITE];
    writeToken({ scopes: [SCOPE_READONLY] });
    await expect(getGscService()).rejects.toThrow(/different scope/);
    expect(fs.existsSync(config.tokenFile)).toBe(true);
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("fails fast when WSP_SERVICE_ACCOUNT_FILE points to a missing file", async () => {
    config.credentialsPath = path.join(dir, "nope.json");
    await expect(getGscService()).rejects.toThrow(/WSP_SERVICE_ACCOUNT_FILE/);
  });

  it("fails fast when an explicit client secrets path is missing", async () => {
    config.oauthClientSecretsExplicit = true;
    await expect(getGscService()).rejects.toThrow(/WSP_OAUTH_FILE/);
  });

  it("skips OAuth when WSP_SERVICE_ACCOUNT_ONLY is set and falls back to ADC", async () => {
    config.skipOauth = true;
    writeToken();
    h.adc.mockResolvedValue({});
    expect(await getGscService()).toEqual({ built: true });
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("raises when no credentials exist anywhere", async () => {
    await expect(getGscService()).rejects.toThrow(/Authentication failed/);
  });

  it("migrates a token from the old location", async () => {
    fs.mkdirSync(path.dirname(config.oldTokenFile), { recursive: true });
    fs.writeFileSync(config.oldTokenFile, "{}");
    await getGscService().catch(() => {});
    expect(fs.existsSync(config.tokenFile)).toBe(true);
    expect(fs.existsSync(config.oldTokenFile)).toBe(false);
  });

  it("keeps stdout clean (stdout carries the MCP protocol)", async () => {
    const out = vi.spyOn(process.stdout, "write");
    await getGscService().catch(() => {});
    expect(out).not.toHaveBeenCalled();
  });
});

describe("isDeadGrant", () => {
  it("only matches invalid_grant", () => {
    expect(isDeadGrant(new Error("invalid_grant"))).toBe(true);
    expect(isDeadGrant({ response: { data: { error: "invalid_grant" } } })).toBe(true);
    expect(isDeadGrant(new Error("invalid_scope"))).toBe(false);
    expect(isDeadGrant(new Error("ECONNRESET"))).toBe(false);
  });
});

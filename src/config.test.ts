import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expandPath, loadConfig, SCOPE_READONLY, SCOPE_WRITE } from "./config.js";

describe("config", () => {
  it("expands ~ and env vars in paths", () => {
    expect(expandPath("~/creds.json")).toBe(`${os.homedir()}/creds.json`);
    process.env.WSP_TEST_DIR = "/opt/x";
    expect(expandPath("$WSP_TEST_DIR/c.json")).toBe("/opt/x/c.json");
    expect(expandPath("")).toBeUndefined();
  });
  it("requests the read-only scope by default and write scope when opted in", () => {
    expect(loadConfig({}).scopes).toEqual([SCOPE_READONLY]);
    expect(loadConfig({ WSP_ALLOW_WRITES: "true" }).scopes).toEqual([SCOPE_WRITE]);
  });
  it("validates WSP_DATA_MODE", () => {
    expect(loadConfig({ WSP_DATA_MODE: " FINAL " }).dataState).toBe("final");
    expect(() => loadConfig({ WSP_DATA_MODE: "fresh" })).toThrow(/Invalid WSP_DATA_MODE/);
  });
  it("tracks whether the client secrets path was explicit", () => {
    expect(loadConfig({}).oauthClientSecretsExplicit).toBe(false);
    expect(loadConfig({ WSP_OAUTH_FILE: "/x/c.json" })).toMatchObject({
      oauthClientSecretsExplicit: true,
      oauthClientSecretsFile: "/x/c.json",
    });
  });
  it("reads the OAuth client ID and secret from env", () => {
    expect(loadConfig({})).toMatchObject({ oauthClientId: undefined, oauthClientSecret: undefined });
    expect(loadConfig({ WSP_CLIENT_ID: " id ", WSP_CLIENT_SECRET: "sec" })).toMatchObject({
      oauthClientId: "id",
      oauthClientSecret: "sec",
    });
  });
  it("honours WSP_TOKEN_DIR for the token file", () => {
    expect(loadConfig({ WSP_TOKEN_DIR: "/cfg" }).tokenFile).toBe(path.join("/cfg", "token.json"));
  });
});

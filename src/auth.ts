import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { google, searchconsole_v1 } from "googleapis";
import type { Credentials } from "google-auth-library";
import open from "open";
import { config, SCOPE_WRITE } from "./config.js";

export type SearchConsole = searchconsole_v1.Searchconsole;

/** Logging must never touch stdout: it carries the MCP stdio protocol. */
const warn = (...args: unknown[]) => console.error("[google-search-console-mcp]", ...args);

/** True only when Google says the refresh token itself is revoked or expired. */
export function isDeadGrant(error: unknown): boolean {
  const e = error as { message?: string; response?: { data?: { error?: string } } };
  return (e?.response?.data?.error ?? "") === "invalid_grant" || String(e?.message ?? error).includes("invalid_grant");
}

function build(auth: unknown): SearchConsole {
  // googleapis accepts any google-auth-library client here.
  return google.searchconsole({ version: "v1", auth: auth as never });
}

interface ClientSecrets {
  client_id: string;
  client_secret: string;
  redirect_uris?: string[];
}

/** True when the client ID and secret were given directly via WSP_CLIENT_ID / WSP_CLIENT_SECRET. */
function hasInlineClient(): boolean {
  return Boolean(config.oauthClientId && config.oauthClientSecret);
}

function readClientSecrets(file: string): ClientSecrets {
  if (hasInlineClient()) {
    return { client_id: config.oauthClientId!, client_secret: config.oauthClientSecret! };
  }
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const section = raw.installed ?? raw.web;
  if (!section?.client_id || !section?.client_secret) {
    throw new Error(`Unrecognised OAuth client secrets format in ${file} (expected an "installed" or "web" key).`);
  }
  return section;
}

/** Token file format is compatible with the one written by the original Python server. */
interface StoredToken {
  token?: string;
  refresh_token?: string;
  token_uri?: string;
  client_id?: string;
  client_secret?: string;
  scopes?: string[];
  expiry?: string;
}

function saveToken(file: string, creds: Credentials, client: { _clientId?: string; _clientSecret?: string }) {
  const stored: StoredToken = {
    token: creds.access_token ?? undefined,
    refresh_token: creds.refresh_token ?? undefined,
    token_uri: "https://oauth2.googleapis.com/token",
    client_id: client._clientId,
    client_secret: client._clientSecret,
    scopes: creds.scope ? creds.scope.split(" ") : config.scopes,
    expiry: creds.expiry_date ? new Date(creds.expiry_date).toISOString() : undefined,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(stored, null, 2), { mode: 0o600 });
}

function migrateOldToken() {
  if (fs.existsSync(config.oldTokenFile) && !fs.existsSync(config.tokenFile)) {
    fs.mkdirSync(path.dirname(config.tokenFile), { recursive: true });
    try {
      fs.renameSync(config.oldTokenFile, config.tokenFile);
    } catch {
      fs.copyFileSync(config.oldTokenFile, config.tokenFile);
      fs.rmSync(config.oldTokenFile);
    }
  }
}

/** Run the browser-based OAuth installed-app flow with a loopback redirect. */
async function runLocalOAuthFlow(): Promise<SearchConsole> {
  const secrets = readClientSecrets(config.oauthClientSecretsFile);

  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const redirectUri = `http://127.0.0.1:${port}`;

  const client = new google.auth.OAuth2(secrets.client_id, secrets.client_secret, redirectUri);
  const authUrl = client.generateAuthUrl({ access_type: "offline", scope: config.scopes, prompt: "consent" });

  const code = new Promise<string>((resolve, reject) => {
    server.on("request", (req, res) => {
      const url = new URL(req.url ?? "/", redirectUri);
      const err = url.searchParams.get("error");
      const c = url.searchParams.get("code");
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(c ? "Authentication complete. You can close this window." : "Authentication failed.");
      if (c) resolve(c);
      else if (err) reject(new Error(`OAuth error: ${err}`));
    });
  });

  try {
    warn(`Open this URL to authorize if a browser does not appear: ${authUrl}`);
    open(authUrl).catch(() => undefined);
    const { tokens } = await client.getToken(await code);
    client.setCredentials(tokens);
    saveToken(config.tokenFile, tokens, client as never);
    attachTokenPersistence(client);
    return build(client);
  } finally {
    server.close();
  }
}

/** Persist refreshed access tokens so long-running servers keep the file current. */
function attachTokenPersistence(client: InstanceType<typeof google.auth.OAuth2>) {
  client.on("tokens", (t) => {
    try {
      saveToken(config.tokenFile, { ...client.credentials, ...t }, client as never);
    } catch (e) {
      warn("Could not persist refreshed token:", e);
    }
  });
}

export async function getGscServiceOAuth(): Promise<SearchConsole> {
  let client: InstanceType<typeof google.auth.OAuth2> | undefined;

  if (fs.existsSync(config.tokenFile)) {
    try {
      const stored: StoredToken = JSON.parse(fs.readFileSync(config.tokenFile, "utf8"));
      if (!stored.client_id || !stored.client_secret || !(stored.refresh_token || stored.token)) {
        throw new Error("token file is missing required fields");
      }
      // A token granted only read-only access cannot satisfy the write scope.
      if (
        stored.scopes?.length &&
        config.scopes.includes(SCOPE_WRITE) &&
        !stored.scopes.includes(SCOPE_WRITE)
      ) {
        throw Object.assign(new Error("invalid_scope"), { scopeMismatch: true });
      }
      client = new google.auth.OAuth2(stored.client_id, stored.client_secret);
      client.setCredentials({
        access_token: stored.token,
        refresh_token: stored.refresh_token,
        expiry_date: stored.expiry ? Date.parse(stored.expiry) : undefined,
      });
    } catch (e) {
      if ((e as { scopeMismatch?: boolean }).scopeMismatch) {
        throw new Error(
          `Failed to use the OAuth token at ${config.tokenFile}: it was granted a different scope than ` +
            `the server now requests (${config.scopes.join(", ")}). The token file was left in place; ` +
            `set WSP_ALLOW_WRITES to match the scope you authorized, or call the 'wsp_login_again_gsc' tool.`,
        );
      }
      // Unreadable token file: ignore it and start a fresh flow, which overwrites it.
      warn(`Could not read OAuth token file ${config.tokenFile}:`, (e as Error).message);
      client = undefined;
    }
  }

  if (client) {
    const expired = !client.credentials.expiry_date || client.credentials.expiry_date <= Date.now() + 30_000;
    if (!client.credentials.access_token || expired) {
      if (client.credentials.refresh_token) {
        try {
          const { credentials } = await client.refreshAccessToken();
          client.setCredentials(credentials);
          saveToken(config.tokenFile, credentials, client as never);
        } catch (e) {
          if (!isDeadGrant(e)) {
            throw new Error(
              `Failed to refresh the OAuth token at ${config.tokenFile}: ${(e as Error).message}. ` +
                `The token file was left in place. If the error mentions invalid_scope, the token was ` +
                `granted a different scope than the server now requests (${config.scopes.join(", ")}); ` +
                `set WSP_ALLOW_WRITES to match the scope you authorized, or call the 'wsp_login_again_gsc' tool.`,
              { cause: e },
            );
          }
          // invalid_grant: refresh token revoked/expired, so the stored token is useless.
          fs.rmSync(config.tokenFile, { force: true });
          client = undefined;
        }
      } else {
        client = undefined;
      }
    }
  }

  if (!client) {
    if (!hasInlineClient() && !fs.existsSync(config.oauthClientSecretsFile)) {
      throw new Error(
        "OAuth client credentials not found. Set the WSP_CLIENT_ID and WSP_CLIENT_SECRET environment " +
          "variables, or set WSP_OAUTH_FILE to your client_secrets.json file.",
      );
    }
    return runLocalOAuthFlow();
  }

  attachTokenPersistence(client);
  return build(client);
}

async function tryAuthFromKeyFile(keyFile: string): Promise<SearchConsole | undefined> {
  try {
    const auth = new google.auth.GoogleAuth({ keyFile, scopes: config.scopes });
    return build(await auth.getClient());
  } catch {
    // Not a usable key file (e.g. an unsupported config). Try the next path, then ADC.
    return undefined;
  }
}

/** Returns an authorized Search Console client: OAuth, then service account, then ADC. */
export async function getGscService(): Promise<SearchConsole> {
  migrateOldToken();

  if (config.credentialsPath && !fs.existsSync(config.credentialsPath)) {
    throw new Error(
      `WSP_SERVICE_ACCOUNT_FILE is set to '${config.credentialsPath}' but the file does not exist. ` +
        `This MUST be an absolute path to your service account credentials JSON file.`,
    );
  }
  if (!hasInlineClient() && config.oauthClientSecretsExplicit && !fs.existsSync(config.oauthClientSecretsFile)) {
    throw new Error(
      `WSP_OAUTH_FILE is set to '${config.oauthClientSecretsFile}' but the file does not ` +
        `exist. This MUST be an absolute path to your OAuth client_secrets.json file.`,
    );
  }

  let oauthError: Error | undefined;
  if (!config.skipOauth) {
    try {
      return await getGscServiceOAuth();
    } catch (e) {
      warn("OAuth authentication failed:", (e as Error).message);
      oauthError = e as Error;
    }
  }

  for (const p of config.possibleCredentialPaths) {
    if (p && fs.existsSync(p)) {
      const svc = await tryAuthFromKeyFile(p);
      if (svc) return svc;
    }
  }

  // Keyless fallback: Application Default Credentials (Workload Identity Federation,
  // GCE/Cloud Run/GKE metadata servers, `gcloud auth application-default login`).
  try {
    const auth = new google.auth.GoogleAuth({ scopes: config.scopes });
    return build(await auth.getClient());
  } catch (e) {
    warn("Application Default Credentials not available:", (e as Error).message);
  }

  if (oauthError && fs.existsSync(config.tokenFile)) {
    // A token exists but could not be used (e.g. refresh failed): say why.
    throw new Error(oauthError.message);
  }
  throw new Error(
    "Authentication failed. Please either:\n" +
      "1. Set up OAuth by setting WSP_CLIENT_ID and WSP_CLIENT_SECRET (or WSP_OAUTH_FILE to an absolute path), then call the " +
      "'wsp_login_again_gsc' tool to open a browser login window and complete authentication, or\n" +
      "2. Set WSP_SERVICE_ACCOUNT_FILE to an absolute path to a service account credentials file " +
      `(also looked for at: ${config.possibleCredentialPaths.slice(1).filter(Boolean).join(", ")})\n\n` +
      "3. Or use Application Default Credentials (Workload Identity Federation, GCE/Cloud Run/GKE, " +
      "or `gcloud auth application-default login`).",
  );
}

/** Delete the stored token and run a fresh browser login. Returns a status message. */
export async function loginAgain(): Promise<string> {
  const tokenDeleted = fs.existsSync(config.tokenFile);
  if (tokenDeleted) fs.rmSync(config.tokenFile, { force: true });

  if (!hasInlineClient() && !fs.existsSync(config.oauthClientSecretsFile)) {
    return (
      "Error: OAuth client credentials not found. Cannot start new authentication flow. " +
      "Set WSP_CLIENT_ID and WSP_CLIENT_SECRET, or set WSP_OAUTH_FILE to your client_secrets.json."
    );
  }
  await runLocalOAuthFlow();
  const msg = "Successfully authenticated with a new Google account.";
  return tokenDeleted ? `Previous session deleted. ${msg}` : msg;
}

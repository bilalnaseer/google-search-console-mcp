import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Expand `~` and `$VAR` / `${VAR}` in a path; empty input yields undefined. */
export function expandPath(p: string | undefined): string | undefined {
  if (!p) return undefined;
  let out = p;
  if (out === "~" || out.startsWith("~/") || out.startsWith("~\\")) {
    out = os.homedir() + out.slice(1);
  }
  out = out.replace(/\$(\w+)|\$\{(\w+)\}/g, (match, a: string, b: string) => process.env[a ?? b] ?? match);
  return out;
}

const truthy = (v: string | undefined) => ["true", "1", "yes"].includes((v ?? "").toLowerCase());

/** Equivalent of platformdirs.user_config_dir(appname) so existing tokens are found. */
function userConfigDir(app: string): string {
  const home = os.homedir();
  switch (process.platform) {
    case "darwin":
      return path.join(home, "Library", "Application Support", app);
    case "win32":
      return path.join(process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), app, app);
    default:
      return path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), app);
  }
}

export type DataState = "all" | "final";

export interface Config {
  credentialsPath: string | undefined;
  possibleCredentialPaths: (string | undefined)[];
  oauthClientSecretsFile: string;
  oauthClientSecretsExplicit: boolean;
  /** OAuth client ID/secret supplied directly via env (no JSON file needed). */
  oauthClientId: string | undefined;
  oauthClientSecret: string | undefined;
  configDir: string;
  tokenFile: string;
  oldTokenFile: string;
  skipOauth: boolean;
  allowDestructive: boolean;
  dataState: DataState;
  scopes: string[];
}

export const SCOPE_READONLY = "https://www.googleapis.com/auth/webmasters.readonly";
export const SCOPE_WRITE = "https://www.googleapis.com/auth/webmasters";

/** Directory of the running package (dist/ or src/), used for clone-install fallbacks. */
const SCRIPT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const credentialsPath = expandPath(env.WSP_SERVICE_ACCOUNT_FILE);
  const explicitSecrets = expandPath(env.WSP_OAUTH_FILE);
  const configDir = env.WSP_TOKEN_DIR || userConfigDir("google-search-console-mcp");

  const rawState = (env.WSP_DATA_MODE ?? "all").toLowerCase().trim();
  if (rawState !== "all" && rawState !== "final") {
    throw new Error(
      `Invalid WSP_DATA_MODE value '${rawState}'. ` +
        "Accepted values are 'all' (default, matches GSC dashboard) or 'final' (2-3 day lag).",
    );
  }

  const allowDestructive = truthy(env.WSP_ALLOW_WRITES);
  return {
    credentialsPath,
    possibleCredentialPaths: [
      credentialsPath,
      path.join(SCRIPT_DIR, "service_account_credentials.json"),
      path.join(process.cwd(), "service_account_credentials.json"),
    ],
    oauthClientSecretsFile: explicitSecrets ?? path.join(SCRIPT_DIR, "client_secrets.json"),
    oauthClientSecretsExplicit: explicitSecrets !== undefined,
    oauthClientId: env.WSP_CLIENT_ID?.trim() || undefined,
    oauthClientSecret: env.WSP_CLIENT_SECRET?.trim() || undefined,
    configDir,
    tokenFile: path.join(configDir, "token.json"),
    oldTokenFile: path.join(SCRIPT_DIR, "token.json"),
    skipOauth: truthy(env.WSP_SERVICE_ACCOUNT_ONLY),
    allowDestructive,
    dataState: rawState,
    // Read-only unless the operator opted in to write operations; asking for a scope
    // wider than a stored token was granted makes the refresh fail with invalid_scope.
    scopes: [allowDestructive ? SCOPE_WRITE : SCOPE_READONLY],
  };
}

/** Mutable singleton so tests can override individual settings. */
export const config: Config = loadConfig();

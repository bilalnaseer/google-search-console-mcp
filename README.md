# Google Search Console MCP Server

[![npm version](https://img.shields.io/npm/v/google-gsc-mcp)](https://www.npmjs.com/package/google-gsc-mcp)
[![npm downloads](https://img.shields.io/npm/dm/google-gsc-mcp)](https://www.npmjs.com/package/google-gsc-mcp)
[![license](https://img.shields.io/github/license/bilalnaseer/google-search-console-mcp)](LICENSE)

Talk to your [Google Search Console](https://search.google.com/search-console/about) data in plain English from Claude, Cursor, Codex, Gemini CLI or any other MCP app.

> *"Which keywords lost clicks this month?"*
> *"Are my top 10 pages indexed?"*
> *"Compare January with February and tell me what changed."*

**Jump to:** [Setup](#setup) · [Tools](#tools) · [Settings](#settings) · [Example prompts](#example-prompts) · [Troubleshooting](#troubleshooting) · [Docker & remote](#docker--remote)

---

## Setup

You need [Node.js](https://nodejs.org/) 20 or newer (`node --version` to check). Setup takes about 3 minutes and you only do it once.

### 1. Create a Client ID and Secret

1. Open [Google Cloud Console](https://console.cloud.google.com/), then create a project (or pick one).
2. [Enable the Search Console API](https://console.cloud.google.com/apis/library/searchconsole.googleapis.com).
3. Open **Google Auth Platform** and set up the consent screen: enter an app name and your email, and choose **External** as the audience.
4. Under **Audience → Test users**, click **+ Add users** and add the Google account that has access to your Search Console sites. While the app is in *Testing*, only these accounts can sign in.
5. Go to **Clients → Create client**, set **Application type** to **Desktop app**, and click **Create**.
6. Copy the **Client ID** and **Client secret**. The secret can't be shown again after you close the dialog.

This project doesn't ship a login of its own, so your data never goes through anyone else's Google project.

### 2. Add this to your app's MCP config

```json
{
  "mcpServers": {
    "search-console": {
      "command": "npx",
      "args": ["-y", "google-gsc-mcp"],
      "env": {
        "WSP_CLIENT_ID": "your-client-id.apps.googleusercontent.com",
        "WSP_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

| App | Config file |
|---|---|
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Claude Code | `claude mcp add search-console -e WSP_CLIENT_ID=... -e WSP_CLIENT_SECRET=... -- npx -y google-gsc-mcp` |
| Cursor | `~/.cursor/mcp.json` |
| Gemini CLI, Antigravity, others | Your app's MCP config file |

<details>
<summary><strong>Codex CLI</strong> uses TOML instead</summary>

File: `~/.codex/config.toml`

```toml
[mcp_servers.search-console]
command = "npx"
args = ["-y", "google-gsc-mcp"]
enabled = true
env = { WSP_CLIENT_ID = "your-client-id.apps.googleusercontent.com", WSP_CLIENT_SECRET = "your-client-secret" }
```

</details>

### 3. Restart and sign in

**Fully quit** your app and reopen it (on macOS press `Cmd+Q`; closing the window isn't enough). Then ask: *"List my Search Console websites."*

The first time, a browser window opens so you can sign in to Google. Pick the account you added as a test user. If Google warns that the app isn't verified, click **Advanced → Go to (your app name)**. After that you stay signed in.

If something goes wrong, ask *"Run wsp_show_status_gsc"*. It shows whether you're signed in and the exact error.

### Other ways to sign in

<details>
<summary><strong>Service account</strong> (automation and teams)</summary>

1. In [Credentials](https://console.cloud.google.com/apis/credentials), choose **Create Credentials → Service Account**.
2. Open the **Keys** tab → **Add Key → Create new key → JSON**, and download it to a safe place.
3. In Search Console, open **Settings → Users and permissions → Add user**, paste the service account's email and give it **Full** access.
4. Use this `env` block instead:

```json
"env": {
  "WSP_SERVICE_ACCOUNT_FILE": "/full/path/to/service_account.json",
  "WSP_SERVICE_ACCOUNT_ONLY": "true"
}
```

With neither a client nor a service account set, the server falls back to [Google's default credentials](https://cloud.google.com/docs/authentication/application-default-credentials) (`gcloud auth application-default login`, Cloud Run, GKE, Workload Identity Federation).

</details>

<details>
<summary><strong>Use a downloaded JSON file</strong> instead of Client ID and Secret</summary>

Click **Download JSON** when you create the client, save it somewhere safe, and set `WSP_OAUTH_FILE` to its full path, e.g. `"WSP_OAUTH_FILE": "/Users/you/secrets/client_secrets.json"`. It is ignored if `WSP_CLIENT_ID` and `WSP_CLIENT_SECRET` are set.

</details>

<details>
<summary><strong>Multiple Google accounts</strong></summary>

Add one MCP entry per account, each with its own `WSP_TOKEN_DIR`, so the saved logins don't overwrite each other. All entries can share the same Client ID and secret. Add every account as a test user.

```json
"search-console-work": {
  "command": "npx",
  "args": ["-y", "google-gsc-mcp"],
  "env": {
    "WSP_CLIENT_ID": "...",
    "WSP_CLIENT_SECRET": "...",
    "WSP_TOKEN_DIR": "/Users/you/.gsc-tokens/work"
  }
}
```

</details>

<details>
<summary><strong>Run from source</strong> instead of npx</summary>

```bash
git clone https://github.com/bilalnaseer/google-search-console-mcp.git
cd google-search-console-mcp
npm install
npm run build
```

Then use `"command": "node"` and `"args": ["/full/path/to/google-search-console-mcp/dist/index.js"]` in your config.

</details>

---

## Tools

Most tools need a `site_url`. Get it from `wsp_list_websites_gsc` and copy it exactly. It looks like `https://example.com/` or `sc-domain:example.com`.

| Tool | What it does |
|---|---|
| **Getting started** | |
| `wsp_show_status_gsc` | Shows whether you're signed in and lists every tool |
| `wsp_list_websites_gsc` | Lists your Search Console websites and their exact `site_url` |
| `wsp_show_website_gsc` | Your permission level and verification details for one website |
| `wsp_login_again_gsc` | Opens the Google login again, e.g. to switch accounts or fix login errors |
| **Traffic & keywords** | |
| `wsp_show_traffic_gsc` | Clicks, impressions, CTR and position: totals plus a daily trend |
| `wsp_compare_dates_gsc` | Compares two date ranges and shows what went up or down most |
| `wsp_find_page_keywords_gsc` | The search keywords that bring visitors to one page |
| `wsp_run_report_gsc` | Custom report with filters, sorting, device, country, search type, up to 25,000 rows |
| **Indexing** | |
| `wsp_check_url_gsc` | Is this page indexed? Last crawl, canonical, robots and rich results |
| `wsp_check_urls_gsc` | The same check for up to 10 pages at once |
| **Sitemaps** | |
| `wsp_show_sitemaps_gsc` | All your sitemaps with status, errors and warnings |
| `wsp_show_sitemap_gsc` | Full details for one sitemap |
| **Write tools** (off by default) | |
| `wsp_add_sitemap_gsc` | Submits or resubmits a sitemap |
| `wsp_remove_sitemap_gsc` | Removes a sitemap (pages already indexed stay indexed) |
| `wsp_add_website_gsc` | Adds a website to Search Console |
| `wsp_remove_website_gsc` | Removes a website from Search Console |

### Turning on write tools

By default the server only **reads** your data. To let it add or remove websites and sitemaps:

1. Add `"WSP_ALLOW_WRITES": "true"` to your `env` block.
2. Restart your app.
3. Ask it to run `wsp_login_again_gsc` once so Google grants the extra permission.

---

## Settings

Put these in the `env` block of your config.

| Setting | Default | What it does |
|---|---|---|
| `WSP_CLIENT_ID` | — | OAuth Client ID |
| `WSP_CLIENT_SECRET` | — | OAuth Client secret (use together with `WSP_CLIENT_ID`) |
| `WSP_OAUTH_FILE` | — | Alternative to the two above: full path to your OAuth `client_secrets.json`. Ignored if ID and secret are set |
| `WSP_SERVICE_ACCOUNT_FILE` | — | Full path to your service account key |
| `WSP_SERVICE_ACCOUNT_ONLY` | `false` | `true` skips the Google login and uses only the service account |
| `WSP_DATA_MODE` | `all` | `all` matches the Search Console dashboard. `final` shows only confirmed data (2–3 days behind) |
| `WSP_ALLOW_WRITES` | `false` | `true` turns on the write tools. Run `wsp_login_again_gsc` after changing it |
| `WSP_TOKEN_DIR` | OS config folder | Where your saved login (`token.json`) is kept. Rarely needed |

The server tries logins in this order: saved Google login → service account → Google default credentials.

---

## Example prompts

| Goal | Ask |
|---|---|
| See your sites | "List my Search Console websites." |
| Fix low CTR | "Show my top 20 keywords for mysite.com in the last 30 days. Flag any with CTR under 2% and suggest better titles." |
| Spot drops | "Show traffic for mysite.com over the last 28 days and explain any sudden drops or spikes." |
| Month vs month | "Compare January with February. Which keywords improved most?" |
| Check indexing | "Are these pages indexed? mysite.com/product, mysite.com/services, mysite.com/about" |
| Audit one page | "Check mysite.com/landing-page and give me a list of fixes." |
| Quick wins | "Find keywords with lots of impressions but position 11–20, mobile and US only." |

---

## Troubleshooting

**Start here:** ask your app to *"run wsp_show_status_gsc"*. It shows the exact login status and error.

<details>
<summary><strong><code>spawn npx ENOENT</code> or <code>command not found: npx</code></strong></summary>

Your app can't find `npx`. This is common with nvm or fnm. Find the full path:

```bash
which npx     # macOS / Linux
where npx     # Windows
```

Then use that path as `"command"`, e.g. `"/Users/you/.nvm/versions/node/v22.0.0/bin/npx"`.

</details>

<details>
<summary><strong>Login failed or file not found</strong></summary>

- File paths must be **full paths**. `~/` works, but a bare file name doesn't.
- Check `WSP_CLIENT_ID` and `WSP_CLIENT_SECRET` for typos or extra spaces.
- If you set `WSP_OAUTH_FILE` or `WSP_SERVICE_ACCOUNT_FILE`, the file must exist. The server stops and names the setting if it can't find it.
- Seeing `invalid_grant` or want another Google account? Run `wsp_login_again_gsc`.
- Changed `WSP_ALLOW_WRITES`? Run `wsp_login_again_gsc`.

</details>

<details>
<summary><strong>"Access blocked" or <code>Error 403: access_denied</code> when signing in</strong></summary>

Your OAuth app is in *Testing* mode and the Google account you picked isn't a test user. Open **Google Auth Platform → Audience → Test users**, click **+ Add users**, add that account, then run `wsp_login_again_gsc` again. Having access to the Cloud project is not enough; the account must be on this list.

</details>

<details>
<summary><strong>"No Search Console properties found"</strong></summary>

You signed in, but that Google account has no Search Console access. Run `wsp_login_again_gsc` and pick the account that owns or is a user on your sites, and make sure it is also a test user (see above).

</details>

<details>
<summary><strong>"Property not found (404)"</strong></summary>

- Copy `site_url` exactly from `wsp_list_websites_gsc`.
- Domain properties look like `sc-domain:example.com`, not a full URL.
- A service account must be added as a user on that website in Search Console.

</details>

<details>
<summary><strong>Works in Claude Desktop but not on claude.ai</strong></summary>

The server runs on your computer, so it only works in the [Claude Desktop app](https://claude.ai/download), not in the browser.

</details>

<details>
<summary><strong>Config changes do nothing</strong></summary>

Fully quit the app (`Cmd+Q`) and reopen it. Also check that your JSON is valid and every path is a full path.

</details>

---

## Docker & remote

Skip this unless you want to run the server on another machine or in a container.

| Setting | Default | What it does |
|---|---|---|
| `WSP_TRANSPORT` | `stdio` | Set to `sse` to serve over the network |
| `WSP_HOST` | `127.0.0.1` | Address to listen on |
| `WSP_PORT` | `3001` | Port to listen on |

```bash
WSP_TRANSPORT=sse WSP_HOST=0.0.0.0 WSP_PORT=3001 node dist/index.js
```

Apps connect to `http://HOST:3001/sse`.

> The SSE endpoint has no password. Don't expose it to the internet without a reverse proxy or firewall in front.

**Docker:**

```bash
docker build -t google-search-console-mcp .

docker run \
  -e WSP_TRANSPORT=sse \
  -e WSP_HOST=0.0.0.0 \
  -e WSP_PORT=3001 \
  -e WSP_SERVICE_ACCOUNT_FILE=/app/credentials.json \
  -e WSP_SERVICE_ACCOUNT_ONLY=true \
  -v /path/to/credentials.json:/app/credentials.json \
  -p 3001:3001 \
  google-search-console-mcp
```

A container can't open a browser, so use a service account, or mount a `token.json` you already signed in with and point `WSP_TOKEN_DIR` at its folder.

---

## Development

```bash
npm install
npm test            # no Google login needed
npm run typecheck
npm run dev         # run from source
```

Bugs and ideas are welcome as GitHub issues or pull requests.

## License

MIT, see [LICENSE](LICENSE). Maintained by [Bilal Naseer](https://github.com/bilalnaseer).

# Google Search Console MCP Server

Talk to your [Google Search Console](https://search.google.com/search-console/about) data in plain English from Claude, Cursor, Codex, Gemini CLI or any other MCP app.

> *"Which keywords lost clicks this month?"*
> *"Are my top 10 pages indexed?"*
> *"Compare January with February and tell me what changed."*

No Python needed. One `npx` command and you're running.

**Jump to:** [Quick start](#quick-start) · [Setup in detail](#setup-in-detail) · [Tools](#tools) · [Settings](#settings) · [Example prompts](#example-prompts) · [Troubleshooting](#troubleshooting) · [Docker & remote](#docker--remote)

---

## Quick start

You need [Node.js](https://nodejs.org/) 20 or newer. Run `node --version` to check.

**1. Get a Google login file.** Follow [Step 1](#step-1-get-a-google-login-file) below. It takes about 3 minutes.

**2. Add this to your AI app's MCP config:**

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

**3. Restart the app and ask:** *"List my Search Console websites."*

The first time, a browser window opens so you can sign in to Google. After that you stay signed in.

---

## Setup in detail

### Step 1: Get a Google login file

Both options start the same way:

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or pick a project.
2. [Turn on the Search Console API](https://console.cloud.google.com/apis/library/searchconsole.googleapis.com).

Then pick **one** option.

#### Option A: Sign in with your Google account (recommended)

3. Go to [Credentials](https://console.cloud.google.com/apis/credentials) → **Create Credentials** → **OAuth client ID**.
4. Set up the consent screen, choose **Desktop app**, then click **Create**.
5. Copy the **Client ID** and **Client secret** shown after creation.
6. Set `WSP_CLIENT_ID` and `WSP_CLIENT_SECRET` to those values. (Prefer a file? Download the JSON and set `WSP_OAUTH_FILE` to its path instead.)

<details>
<summary><strong>Step-by-step Google Cloud setup (about 3 minutes)</strong></summary>

You create your own login file. This project doesn't ship one, so your data never goes through anyone else's Google project.

1. **Pick a project.** Open [Google Cloud Console](https://console.cloud.google.com/), click the project picker at the top, and choose **New Project** (or select an existing one).
2. **Turn on the API.** Open the [Search Console API page](https://console.cloud.google.com/apis/library/searchconsole.googleapis.com) and click **Enable**. It then shows *Status: Enabled*.
3. **Set up the consent screen.** Open **Google Auth Platform**. If it asks you to get started, fill in an app name, your support email, and choose **External** as the audience.
4. **Add yourself as a test user.** In **Google Auth Platform → Audience → Test users**, click **+ Add users** and add the Google account that has access to your Search Console sites. While the app is in *Testing*, only these accounts can sign in.
5. **Create the OAuth client.** Go to **Google Auth Platform → Clients → Create client**. Set **Application type** to **Desktop app**, give it any name, and click **Create**.
6. **Copy the credentials.** In the dialog that appears, copy the **Client ID** and **Client secret**. You can't view the secret again after closing it, so you may also click **Download JSON** as a backup.
7. **Add them to your config.** Set `WSP_CLIENT_ID` and `WSP_CLIENT_SECRET` in the `env` block. Alternatively, save the JSON somewhere safe and set `WSP_OAUTH_FILE` to its full path, e.g. `/Users/you/secrets/client_secrets.json`.
8. **Sign in.** Restart your app and ask *"Run wsp_login_again_gsc"*. In the browser, pick the account you added in step 4. If Google shows a warning that the app isn't verified, click **Advanced → Go to (your app name)**.
9. **Check it works.** Ask *"List my Search Console websites"*.

Never commit or share your JSON file or the saved token.

</details>

#### Option B: Service account (for automation and teams)

3. Go to [Credentials](https://console.cloud.google.com/apis/credentials) → **Create Credentials** → **Service Account**.
4. Open the **Keys** tab → **Add Key** → **Create new key** → **JSON**, and download it.
5. Keep the file somewhere safe, e.g. `~/Documents/service_account.json`.
6. In Search Console, open **Settings → Users and permissions → Add user**, paste the service account's email and give it **Full** access.
7. Use this `env` block instead of the one in the Quick start:

```json
"env": {
  "WSP_SERVICE_ACCOUNT_FILE": "/full/path/to/service_account.json",
  "WSP_SERVICE_ACCOUNT_ONLY": "true"
}
```

> No file at all? If neither option is set, the server falls back to [Google's default credentials](https://cloud.google.com/docs/authentication/application-default-credentials) (`gcloud auth application-default login`, Cloud Run, GKE, Workload Identity Federation).

### Step 2: Add the server to your app

Always use **full paths** to your files.

| App | Config file |
|---|---|
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Cursor | `~/.cursor/mcp.json` |
| Gemini CLI, Antigravity, others | Your app's MCP config file |

Paste the JSON from the [Quick start](#quick-start) into the file.

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

Service account: `env = { WSP_SERVICE_ACCOUNT_FILE = "/full/path/to/service_account.json", WSP_SERVICE_ACCOUNT_ONLY = "true" }`

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

### Step 3: Restart and test

**Fully quit** your app and reopen it. On macOS press `Cmd+Q`; closing the window isn't enough.

Then ask: *"List my Search Console websites."* If it doesn't work, ask *"Run wsp_show_status_gsc"*. It shows whether you're signed in and the exact error.

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
| `WSP_CLIENT_ID` | — | OAuth Client ID (Option A, no JSON file needed) |
| `WSP_CLIENT_SECRET` | — | OAuth Client secret (use together with `WSP_CLIENT_ID`) |
| `WSP_OAUTH_FILE` | — | Alternative to the two above: full path to your OAuth `client_secrets.json`. Ignored if ID and secret are set |
| `WSP_SERVICE_ACCOUNT_FILE` | — | Full path to your service account key (Option B) |
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

- Use the **full path** to the file. `~/` works, but a bare name like `client_secrets.json` doesn't.
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

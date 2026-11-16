# Install Google Search Console MCP (instructions for AI agents)

This file tells an AI agent (such as Cline) how to install and verify this MCP server for a user.
The server lets the user query their own Google Search Console data: search analytics, URL inspection and sitemaps.

- Package: `google-gsc-mcp` on npm
- Repository: https://github.com/bilalnaseer/google-search-console-mcp
- Runs locally over stdio, no hosted service involved.

## What you need from the user

1. **Node.js 20 or newer.** Check with `node --version`.
2. **A Google OAuth Client ID and Client secret** from the user's own Google Cloud project. Ask the user for both values. Never invent or guess them.
3. **A Google account that has access to the user's Search Console sites.**

If the user does not have a Client ID and secret yet, walk them through these steps (about 3 minutes):

1. Open https://console.cloud.google.com/ and create or pick a project.
2. Enable the Search Console API: https://console.cloud.google.com/apis/library/searchconsole.googleapis.com
3. Open **Google Auth Platform** and set up the consent screen: enter an app name and an email, and choose **External** as the audience.
4. Under **Audience > Test users**, click **+ Add users** and add the Google account that owns or has access to the Search Console sites. While the app is in Testing mode, only these accounts can sign in.
5. Go to **Clients > Create client**, set **Application type** to **Desktop app**, and click **Create**.
6. Copy the **Client ID** and **Client secret**. The secret cannot be shown again after the dialog closes.

## Install

Add this entry to the MCP settings file (for Cline this is `cline_mcp_settings.json`).
Replace the two placeholder values with the user's own Client ID and Client secret.

```json
{
  "mcpServers": {
    "github.com/bilalnaseer/google-search-console-mcp": {
      "command": "npx",
      "args": ["-y", "google-gsc-mcp"],
      "env": {
        "WSP_CLIENT_ID": "your-client-id.apps.googleusercontent.com",
        "WSP_CLIENT_SECRET": "your-client-secret"
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

No clone or build step is needed, `npx` downloads the package.

### Alternatives

- **Downloaded JSON file instead of Client ID and secret:** set `WSP_OAUTH_FILE` to the full path of the client JSON the user downloaded from Google Cloud. It is ignored if `WSP_CLIENT_ID` and `WSP_CLIENT_SECRET` are set.
- **Service account (automation and teams):** set `WSP_SERVICE_ACCOUNT_FILE` to the full path of the service account JSON key and `WSP_SERVICE_ACCOUNT_ONLY` to `true`. The service account's email must be added as a user (Full access) on each website in Search Console.

## First run and sign in

1. Restart the MCP client so it picks up the new server.
2. Call the tool `wsp_show_status_gsc`. It reports whether the user is signed in.
3. If not signed in, call `wsp_login_again_gsc`. A browser window opens. Tell the user to pick the Google account they added as a test user. If Google warns that the app is not verified, they should click **Advanced > Go to (app name)**.
4. Call `wsp_list_websites_gsc` to confirm it works. It returns the user's Search Console properties and the exact `site_url` each other tool needs (for example `https://example.com/` or `sc-domain:example.com`).

## Tools

- Getting started: `wsp_show_status_gsc`, `wsp_list_websites_gsc`, `wsp_show_website_gsc`, `wsp_login_again_gsc`
- Traffic and keywords: `wsp_show_traffic_gsc`, `wsp_compare_dates_gsc`, `wsp_find_page_keywords_gsc`, `wsp_run_report_gsc`
- Indexing: `wsp_check_url_gsc`, `wsp_check_urls_gsc`
- Sitemaps: `wsp_show_sitemaps_gsc`, `wsp_show_sitemap_gsc`
- Write tools (off by default): `wsp_add_website_gsc`, `wsp_remove_website_gsc`, `wsp_add_sitemap_gsc`, `wsp_remove_sitemap_gsc`. They only work when the user sets `WSP_ALLOW_WRITES=true` in `env` and signs in again with `wsp_login_again_gsc`. Do not enable them unless the user asks.

## Troubleshooting

- **`Error 403: access_denied` when signing in:** the Google account is not a test user of the OAuth app. Add it under Google Auth Platform > Audience > Test users, then run `wsp_login_again_gsc`.
- **"No Search Console properties found":** the account that signed in has no Search Console access. Run `wsp_login_again_gsc` and choose the right account.
- **"Property not found (404)":** copy `site_url` exactly from `wsp_list_websites_gsc`. Domain properties look like `sc-domain:example.com`.
- **`npx` not found:** install Node.js 20+ or use the full path to `npx` as `command`.
- Any other problem: call `wsp_show_status_gsc`. It shows the exact login status and error.

The user's credentials and saved login stay on their own machine. Never print, log or commit the Client secret or the saved token.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as t from "./tools.js";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true };

const SITE_URL = z
  .string()
  .describe(
    'Exact GSC property URL from wsp_list_websites_gsc (e.g. "https://example.com/" or "sc-domain:example.com"). ' +
      "Domain properties cover all subdomains — use the domain property as site_url and filter by page " +
      "to analyze a specific subdomain.",
  );
const SITE_URL_ADD_DELETE = z
  .string()
  .describe(
    "The URL of the site (must be exact match e.g. https://example.com, or https://www.example.com, or " +
      "https://subdomain.example.com/path/, for domain properties use format: sc-domain:example.com)",
  );
const DAYS = z.number().int().default(28).describe("Number of days to look back (default: 28)");
const ROW_LIMIT_500 = z
  .number()
  .int()
  .default(20)
  .describe(
    "Number of rows to return (default: 20, max: 500). Use 5-20 for quick overviews, 50-200 for deeper " +
      "analysis, up to 500 for comprehensive reports. For bulk exports beyond 500 rows, use " +
      "wsp_run_report_gsc which supports pagination.",
  );

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

export const SERVER_INSTRUCTIONS =
  "Google Search Console tools for SEO analysis. Call wsp_show_status_gsc first for the tool list and auth " +
  "status, then wsp_list_websites_gsc to get the exact site_url (e.g. 'https://example.com/' or " +
  "'sc-domain:example.com') every other tool needs. Search analytics are sorted by clicks and capped per " +
  "request; URL inspection tools accept at most 10 URLs per call. Write operations (wsp_add_website_gsc, wsp_remove_website_gsc, " +
  "wsp_add_sitemap_gsc, wsp_remove_sitemap_gsc) are disabled unless WSP_ALLOW_WRITES=true.";

/** Build a fresh server with every tool registered (one per transport connection). */
export function createServer(): McpServer {
  const server = new McpServer(
    { name: "google-search-console-mcp", version: "0.5.0", websiteUrl: "https://github.com/bilalnaseer/google-search-console-mcp" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  const tool = <S extends z.ZodRawShape>(
    name: string,
    title: string,
    description: string,
    annotations: typeof READ_ONLY,
    inputSchema: S,
    handler: (args: z.infer<z.ZodObject<S>>) => Promise<string>,
  ) =>
    server.registerTool(
      name,
      { title, description, inputSchema, annotations: { title, ...annotations } },
      (async (args: z.infer<z.ZodObject<S>>) => text(await handler(args))) as never,
    );

  tool(
    "wsp_show_status_gsc",
    "Show Status",
    "List every tool this server offers, grouped by category, with the current authentication status. " +
      "Call it first to learn what is available or to diagnose login problems.",
    READ_ONLY,
    {},
    () => t.showStatus(),
  );

  tool(
    "wsp_list_websites_gsc",
    "List Websites",
    "List every Search Console property (domain and URL-prefix) the connected account can access. Returns " +
      "the exact site_url string every other tool requires.",
    READ_ONLY,
    {},
    () => t.listWebsites(),
  );

  tool("wsp_add_website_gsc", "Add Website", "Add a property to Search Console. Requires WSP_ALLOW_WRITES=true.", WRITE, { site_url: SITE_URL_ADD_DELETE }, (a) =>
    t.addWebsite(a.site_url),
  );

  tool("wsp_remove_website_gsc", "Remove Website", "Remove a property from Search Console. Requires WSP_ALLOW_WRITES=true.", DESTRUCTIVE, { site_url: SITE_URL_ADD_DELETE }, (a) =>
    t.removeWebsite(a.site_url),
  );

  tool(
    "wsp_show_website_gsc",
    "Show Website",
    "Permission level, verification and ownership details for one property.",
    READ_ONLY,
    { site_url: SITE_URL },
    (a) => t.showWebsite(a.site_url),
  );

  tool(
    "wsp_check_url_gsc",
    "Check URL",
    "Check a URL's index status, last crawl, canonical, robots and rich results as Google sees it.",
    READ_ONLY,
    { site_url: SITE_URL, page_url: z.string().describe("The specific URL to inspect") },
    (a) => t.checkUrl(a.site_url, a.page_url),
  );

  tool(
    "wsp_check_urls_gsc",
    "Check URLs",
    "Inspect up to 10 URLs in one call (run concurrently). Same data as wsp_check_url_gsc, one row per URL.",
    READ_ONLY,
    { site_url: SITE_URL, urls: z.string().describe("List of URLs to inspect, one per line (max 10)") },
    (a) => t.checkUrls(a.site_url, a.urls),
  );

  tool(
    "wsp_show_traffic_gsc",
    "Show Traffic",
    "Totals (clicks, impressions, CTR, position) and a daily trend for the last N days.",
    READ_ONLY,
    { site_url: SITE_URL, days: DAYS },
    (a) => t.showTraffic(a.site_url, a.days),
  );

  tool(
    "wsp_run_report_gsc",
    "Run Report",
    "Flexible search analytics: choose dimensions, date range, search type, filters, sorting and pagination (up to 25,000 rows).",
    READ_ONLY,
    {
      site_url: SITE_URL,
      start_date: z.string().nullish().describe("Start date in YYYY-MM-DD format (defaults to 28 days ago)"),
      end_date: z.string().nullish().describe("End date in YYYY-MM-DD format (defaults to today)"),
      dimensions: z.string().default("query").describe('Dimensions to group by, comma-separated (e.g., "query,page,device")'),
      search_type: z.string().default("WEB").describe("Type of search results (WEB, IMAGE, VIDEO, NEWS, DISCOVER)"),
      row_limit: z.number().int().default(1000).describe("Maximum number of rows to return (max 25000)"),
      start_row: z.number().int().default(0).describe("Starting row for pagination"),
      sort_by: z
        .string()
        .default("clicks")
        .describe("Metric to sort by (clicks, impressions, ctr, position). Applied client-side to the returned rows, since Google only sorts by clicks."),
      sort_direction: z
        .string()
        .default("descending")
        .describe("Sort direction (ascending or descending). For position, ascending puts the best (lowest) average position first."),
      filter_dimension: z
        .string()
        .nullish()
        .describe("Single filter dimension (query, page, country, device). Use 'filters' instead for multiple filters."),
      filter_operator: z.string().default("contains").describe("Single filter operator (contains, equals, notContains, notEquals)"),
      filter_expression: z.string().nullish().describe("Single filter expression value"),
      filters: z
        .string()
        .nullish()
        .describe(
          "JSON array of filter objects for AND logic across multiple dimensions. Overrides " +
            "filter_dimension/filter_operator/filter_expression when provided. Each object must have " +
            "'dimension', 'operator', and 'expression' keys. Valid dimensions: query, page, country, device. " +
            "Valid operators: contains, equals, notContains, notEquals. " +
            'Example: [{"dimension":"country","operator":"equals","expression":"usa"},' +
            '{"dimension":"device","operator":"equals","expression":"MOBILE"}]',
        ),
      data_state: z
        .string()
        .nullish()
        .describe('Data freshness — "all" (default, matches GSC dashboard) or "final" (confirmed data only, 2-3 day lag)'),
    },
    (a) => t.runReport(a),
  );

  const period = (which: string) => z.string().describe(`${which} (YYYY-MM-DD)`);
  tool(
    "wsp_compare_dates_gsc",
    "Compare Dates",
    "Compare search performance across two date ranges.\n\n" +
      "Direction: Period 1 is the period you are analyzing and Period 2 is the baseline you compare it " +
      "against. All deltas are Period 1 relative to Period 2, and the percentage baseline is Period 2. A " +
      "positive value means Period 1 outperformed Period 2 — more clicks/impressions, higher CTR, or a " +
      "better (lower) average position. For a current-vs-previous comparison, pass the current period as " +
      "Period 1 and the previous period as Period 2. Percentages are null when the Period 2 baseline is zero.",
    READ_ONLY,
    {
      site_url: SITE_URL,
      period1_start: period("Start date for period 1 / the analyzed period"),
      period1_end: period("End date for period 1 / the analyzed period"),
      period2_start: period("Start date for period 2 / the baseline period"),
      period2_end: period("End date for period 2 / the baseline period"),
      dimensions: z.string().default("query").describe("Dimensions to group by (default: query)"),
      limit: z.number().int().default(10).describe("Number of top results to compare (default: 10)"),
    },
    (a) =>
      t.compareDates(a.site_url, a.period1_start, a.period1_end, a.period2_start, a.period2_end, a.dimensions, a.limit),
  );

  tool(
    "wsp_find_page_keywords_gsc",
    "Find Page Keywords",
    "Queries that drove clicks and impressions to one specific page.",
    READ_ONLY,
    { site_url: SITE_URL, page_url: z.string().describe("The specific page URL to analyze"), days: DAYS, row_limit: ROW_LIMIT_500 },
    (a) => t.findPageKeywords(a.site_url, a.page_url, a.days, a.row_limit),
  );

  tool(
    "wsp_show_sitemaps_gsc",
    "Show Sitemaps",
    "List submitted sitemaps with status, URL counts, errors and warnings. Pass sitemap_index to list an index's children.",
    READ_ONLY,
    { site_url: SITE_URL, sitemap_index: z.string().nullish().describe("Optional sitemap index URL to list child sitemaps") },
    (a) => t.showSitemaps(a.site_url, a.sitemap_index),
  );

  tool(
    "wsp_show_sitemap_gsc",
    "Show Sitemap",
    "Full status and per-content-type breakdown for one sitemap.",
    READ_ONLY,
    { site_url: SITE_URL, sitemap_url: z.string().describe("The full URL of the sitemap to inspect") },
    (a) => t.showSitemap(a.site_url, a.sitemap_url),
  );

  tool(
    "wsp_add_sitemap_gsc",
    "Add Sitemap",
    "Submit or resubmit a sitemap. Requires WSP_ALLOW_WRITES=true.",
    WRITE,
    { site_url: SITE_URL, sitemap_url: z.string().describe("The full URL of the sitemap to submit") },
    (a) => t.addSitemap(a.site_url, a.sitemap_url),
  );

  tool(
    "wsp_remove_sitemap_gsc",
    "Remove Sitemap",
    "Unsubmit a sitemap. Already-indexed URLs stay indexed. Requires WSP_ALLOW_WRITES=true.",
    DESTRUCTIVE,
    { site_url: SITE_URL, sitemap_url: z.string().describe("The full URL of the sitemap to delete") },
    (a) => t.removeSitemap(a.site_url, a.sitemap_url),
  );

  tool(
    "wsp_login_again_gsc",
    "Log In Again",
    "Delete the saved OAuth token and open a browser login. Use it to switch Google accounts, fix auth " +
      "errors, or apply a changed WSP_ALLOW_WRITES setting.",
    DESTRUCTIVE,
    {},
    () => t.loginAgain(),
  );

  return server;
}

import { config } from "./config.js";
import * as auth from "./auth.js";
import type { SearchConsole } from "./auth.js";

/* ------------------------------------------------------------------ helpers */

type Json = Record<string, unknown>;
type Row = { keys?: string[] | null; clicks?: number | null; impressions?: number | null; ctr?: number | null; position?: number | null };

const getService = (): Promise<SearchConsole> => auth.getGscService();

const round = (n: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** HTTP status of a googleapis/gaxios error, if any. */
function statusOf(e: unknown): number | undefined {
  const x = e as { status?: number; code?: number | string; response?: { status?: number } };
  const s = x?.response?.status ?? x?.status ?? (typeof x?.code === "number" ? x.code : Number(x?.code));
  return Number.isFinite(s) ? (s as number) : undefined;
}

const isNotFound = (e: unknown) => statusOf(e) === 404 || errMsg(e).includes("404");

/** Local-calendar YYYY-MM-DD. */
export function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function daysAgo(days: number): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  return { start: isoDate(start), end: isoDate(end) };
}

/** "2024-01-02T03:04:05Z" -> "2024-01-02 03:04"; unparseable input is returned unchanged. */
function fmtDateTime(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw : d.toISOString().slice(0, 16).replace("T", " ");
}

const splitDims = (s: string) => s.split(",").map((d) => d.trim());

export function siteNotFoundError(siteUrl: string): string {
  const lines = [`Property '${siteUrl}' not found (404). Possible causes:\n`];
  lines.push(
    "1. The site_url doesn't exactly match what is in GSC. Run wsp_list_websites_gsc to get the exact string to use.",
  );
  lines.push(
    siteUrl.startsWith("sc-domain:")
      ? "2. Domain properties require the service account to be explicitly added under GSC Settings > Users and permissions for that specific domain property. OAuth users must also have verified access to it."
      : "2. If your property is a domain property (covers all subdomains), the correct format is 'sc-domain:example.com', not a full URL.",
  );
  lines.push("3. The authenticated account may not have access to this property.");
  return lines.join("\n");
}

function shapeRow(row: Row, dims: string[]): Json {
  const entry: Json = {};
  dims.forEach((dim, i) => {
    entry[dim] = row.keys?.[i] ?? null;
  });
  entry.clicks = row.clicks ?? 0;
  entry.impressions = row.impressions ?? 0;
  entry.ctr = round(row.ctr ?? 0, 4);
  entry.position = round(row.position ?? 0, 1);
  return entry;
}

const ok = (v: unknown) => JSON.stringify(v);

/** Map a Google API error to a short, actionable message for site add/remove. */
function siteWriteError(e: unknown, verb: "adding" | "removing", site: string, notFound: string): string {
  const status = statusOf(e);
  if (status === undefined) return `Error ${verb} site: ${errMsg(e)}`;
  const body = (e as { response?: { data?: { error?: { message?: string; errors?: { reason?: string }[] } } } }).response?.data?.error;
  const message = body?.message ?? errMsg(e);
  const reason = body?.errors?.[0]?.reason ?? "";

  switch (status) {
    case 404:
      if (notFound) return notFound.replace("{site}", site);
      return `Error ${verb} site (HTTP 404): ${message}`;
    case 409:
      return `Site ${site} is already added to Search Console.`;
    case 403:
      if (reason === "forbidden")
        return verb === "adding"
          ? "Error: You don't have permission to add this site. Please verify ownership first."
          : "Error: You don't have permission to remove this site.";
      if (reason === "quotaExceeded") return "Error: API quota exceeded. Please try again later.";
      return `Error: Permission denied. ${message}`;
    case 400:
      return reason === "invalidParameter"
        ? "Error: Invalid site URL format. Please check the URL format and try again."
        : `Error: Bad request. ${message}`;
    case 401:
      return "Error: Unauthorized. Please check your credentials.";
    case 429:
      return "Error: Too many requests. Please try again later.";
    case 500:
      return "Error: Internal server error from Google Search Console API. Please try again later.";
    case 503:
      return "Error: Service unavailable. Google Search Console API is currently down. Please try again later.";
    default:
      return `Error ${verb} site (HTTP ${status}): ${message}`;
  }
}

/* ------------------------------------------------------------- capabilities */

export async function showStatus(): Promise<string> {
  let authStatus: string;
  try {
    await getService();
    authStatus = "✅ Authenticated — ready to use all tools.";
  } catch (e) {
    authStatus = `❌ Not authenticated — call the 'wsp_login_again_gsc' tool first to open a browser login window.\nDetails: ${errMsg(e)}`;
  }

  return `Google Search Console MCP Server

AUTH STATUS:
${authStatus}

GETTING STARTED:
1. If not authenticated, call the 'wsp_login_again_gsc' tool to complete OAuth login.
2. Call 'wsp_list_websites_gsc' to see all your GSC sites and get the exact site_url for other tools.
3. Use any tool below with the site_url from step 2.

AVAILABLE TOOLS:

Authentication:
  - wsp_login_again_gsc: Open browser OAuth login window. Call this if you see auth errors.

Websites:
  - wsp_list_websites_gsc: List all GSC properties you have access to (start here)
  - wsp_show_website_gsc: Permission level, verification and ownership details for a property

Analytics:
  - wsp_run_report_gsc: Flexible search analytics: dimensions, filters, sorting, pagination
  - wsp_show_traffic_gsc: Totals and daily trend for a period
  - wsp_compare_dates_gsc: Compare two date ranges and rank what changed most
  - wsp_find_page_keywords_gsc: Queries driving traffic to one page

URL inspection:
  - wsp_check_url_gsc: Index status, crawl, canonical and rich results for one URL
  - wsp_check_urls_gsc: Same, for up to 10 URLs at once

Sitemaps:
  - wsp_show_sitemaps_gsc: List sitemaps with status, errors and warnings
  - wsp_show_sitemap_gsc: Full details for one sitemap

Write tools (disabled by default, set WSP_ALLOW_WRITES=true to enable):
  - wsp_add_sitemap_gsc: Submit or resubmit a sitemap
  - wsp_remove_sitemap_gsc: Unsubmit a sitemap
  - wsp_add_website_gsc: Add a property
  - wsp_remove_website_gsc: Remove a property
`;
}

/* --------------------------------------------------------------- properties */

export async function listWebsites(): Promise<string> {
  try {
    const service = await getService();
    const { data } = await service.sites.list();
    const sites = data.siteEntry ?? [];
    if (!sites.length) return "No Search Console properties found.";
    return ok({
      count: sites.length,
      properties: sites.map((s) => ({
        site_url: s.siteUrl ?? "Unknown",
        permission_level: s.permissionLevel ?? "Unknown",
      })),
    });
  } catch (e) {
    return errMsg(e).includes("not exist") || errMsg(e).includes("secrets file")
      ? `Error: ${errMsg(e)}`
      : `Error retrieving properties: ${errMsg(e)}`;
  }
}

export async function addWebsite(siteUrl: string): Promise<string> {
  if (!config.allowDestructive) {
    return (
      "Safety: wsp_add_website_gsc is a destructive operation that modifies your GSC account. " +
      "Set WSP_ALLOW_WRITES=true in your environment to enable write tools."
    );
  }
  try {
    const service = await getService();
    await service.sites.add({ siteUrl });
    return `Site ${siteUrl} has been added to Search Console.`;
  } catch (e) {
    return siteWriteError(e, "adding", siteUrl, "");
  }
}

export async function removeWebsite(siteUrl: string): Promise<string> {
  if (!config.allowDestructive) {
    return (
      "Safety: wsp_remove_website_gsc permanently removes a property from your GSC account. " +
      "Set WSP_ALLOW_WRITES=true in your environment to enable write tools."
    );
  }
  try {
    const service = await getService();
    await service.sites.delete({ siteUrl });
    return `Site ${siteUrl} has been removed from Search Console.`;
  } catch (e) {
    return siteWriteError(e, "removing", siteUrl, "Site {site} was not found in Search Console.");
  }
}

export async function showWebsite(siteUrl: string): Promise<string> {
  try {
    const service = await getService();
    const { data } = await service.sites.get({ siteUrl });
    const result: Json = { site_url: siteUrl, permission_level: data.permissionLevel ?? "Unknown" };
    const d = data as Record<string, any>;
    if (d.siteVerificationInfo) {
      result.verification = {
        state: d.siteVerificationInfo.verificationState ?? "Unknown",
        verified_user: d.siteVerificationInfo.verifiedUser ?? null,
        method: d.siteVerificationInfo.verificationMethod ?? null,
      };
    }
    if (d.ownershipInfo) {
      result.ownership = {
        owner: d.ownershipInfo.owner ?? "Unknown",
        verification_method: d.ownershipInfo.verificationMethod ?? null,
      };
    }
    return ok(result);
  } catch (e) {
    return `Error retrieving site details: ${errMsg(e)}`;
  }
}

/* ---------------------------------------------------------------- analytics */

export async function showTraffic(siteUrl: string, days = 28): Promise<string> {
  try {
    const service = await getService();
    const { start, end } = daysAgo(days);
    const base = { startDate: start, endDate: end, dataState: config.dataState };

    const { data: totalResp } = await service.searchanalytics.query({
      siteUrl,
      requestBody: { ...base, dimensions: [], rowLimit: 1 },
    });
    const { data: dateResp } = await service.searchanalytics.query({
      siteUrl,
      requestBody: { ...base, dimensions: ["date"], rowLimit: days },
    });

    if (!totalResp.rows?.length) return `No performance data available for ${siteUrl} in the last ${days} days.`;

    const t = totalResp.rows[0];
    const totals = {
      clicks: t.clicks ?? 0,
      impressions: t.impressions ?? 0,
      ctr: round(t.ctr ?? 0, 4),
      position: round(t.position ?? 0, 1),
    };
    const dailyTrend = [...(dateResp.rows ?? [])]
      .sort((a, b) => (a.keys![0] < b.keys![0] ? -1 : a.keys![0] > b.keys![0] ? 1 : 0))
      .map((r) => ({
        date: r.keys![0],
        clicks: r.clicks ?? 0,
        impressions: r.impressions ?? 0,
        ctr: round(r.ctr ?? 0, 4),
        position: round(r.position ?? 0, 1),
      }));

    return ok({ site_url: siteUrl, date_range: { start, end, days }, totals, daily_trend: dailyTrend });
  } catch (e) {
    if (isNotFound(e)) return siteNotFoundError(siteUrl);
    return `Error retrieving performance overview: ${errMsg(e)}`;
  }
}

export interface ReportArgs {
  site_url: string;
  start_date?: string | null;
  end_date?: string | null;
  dimensions?: string;
  search_type?: string;
  row_limit?: number;
  start_row?: number;
  sort_by?: string;
  sort_direction?: string;
  filter_dimension?: string | null;
  filter_operator?: string;
  filter_expression?: string | null;
  filters?: string | null;
  data_state?: string | null;
}

export async function runReport(a: ReportArgs): Promise<string> {
  const siteUrl = a.site_url;
  try {
    const service = await getService();
    const dimensions = a.dimensions ?? "query";
    const searchType = a.search_type ?? "WEB";
    const startRow = a.start_row ?? 0;
    const sortBy = a.sort_by ?? "clicks";
    const sortDirection = a.sort_direction ?? "descending";

    const end = a.end_date || isoDate(new Date());
    const start = a.start_date || daysAgo(28).start;

    const resolvedState = (a.data_state || config.dataState).toLowerCase().trim();
    if (resolvedState !== "all" && resolvedState !== "final") {
      return (
        `Invalid data_state value '${a.data_state}'. ` +
        "Accepted values are 'all' (matches GSC dashboard) or 'final' (2-3 day lag)."
      );
    }

    const dims = splitDims(dimensions);
    // Pagination must use the capped value or has_more/next_start_row are wrong above 25000.
    const effectiveRowLimit = Math.min(Math.max(1, a.row_limit ?? 1000), 25000);

    const requestBody: Record<string, unknown> = {
      startDate: start,
      endDate: end,
      dimensions: dims,
      rowLimit: effectiveRowLimit,
      startRow,
      searchType: searchType.toUpperCase(),
      dataState: resolvedState,
    };

    let activeFilters: { dimension: string; operator: string; expression: string }[] = [];
    if (a.filters) {
      let list: unknown;
      try {
        list = JSON.parse(a.filters);
      } catch {
        return "Invalid filters JSON. Please provide a valid JSON array of filter objects.";
      }
      if (!Array.isArray(list) || list.length === 0) {
        return "Invalid filters value. Expected a non-empty JSON array of filter objects.";
      }
      for (const f of list) {
        if (!f || typeof f !== "object" || !["dimension", "operator", "expression"].every((k) => k in f)) {
          return (
            "Each filter object must have 'dimension', 'operator', and 'expression' keys. " +
            `Invalid filter: ${JSON.stringify(f)}`
          );
        }
      }
      requestBody.dimensionFilterGroups = [{ filters: list }];
      activeFilters = list;
    } else if (a.filter_dimension && a.filter_expression) {
      const single = {
        dimension: a.filter_dimension,
        operator: a.filter_operator ?? "contains",
        expression: a.filter_expression,
      };
      requestBody.dimensionFilterGroups = [{ filters: [single] }];
      activeFilters = [single];
    }

    const { data } = await service.searchanalytics.query({ siteUrl, requestBody });

    if (!data.rows?.length) {
      let msg =
        `No search analytics data found for ${siteUrl} with the specified parameters.\n\n` +
        `Parameters used:\n- Date range: ${start} to ${end}\n- Dimensions: ${dimensions}\n- Search type: ${searchType}\n`;
      if (activeFilters.length) {
        msg += "- Filters:\n";
        for (const f of activeFilters) msg += `    ${f.dimension} ${f.operator} '${f.expression}'\n`;
      } else {
        msg += "- No filter applied\n";
      }
      return msg;
    }

    const rows = data.rows.map((r) => shapeRow(r, dims));

    // Google only sorts by clicks descending; apply the requested order client-side.
    if (["clicks", "impressions", "ctr", "position"].includes(sortBy)) {
      const dir = sortDirection.toLowerCase() === "ascending" ? 1 : -1;
      rows.sort((x, y) => dir * ((x[sortBy] as number) - (y[sortBy] as number)));
    }

    const hasMore = data.rows.length === effectiveRowLimit;
    return ok({
      site_url: siteUrl,
      date_range: { start, end },
      search_type: searchType,
      dimensions: dims,
      filters_applied: activeFilters,
      pagination: {
        start_row: startRow,
        row_count: rows.length,
        has_more: hasMore,
        next_start_row: hasMore ? startRow + effectiveRowLimit : null,
      },
      rows,
    });
  } catch (e) {
    if (isNotFound(e)) return siteNotFoundError(siteUrl);
    return `Error retrieving advanced search analytics: ${errMsg(e)}`;
  }
}

export async function compareDates(
  siteUrl: string,
  p1Start: string,
  p1End: string,
  p2Start: string,
  p2End: string,
  dimensions = "query",
  limit = 10,
): Promise<string> {
  try {
    const service = await getService();
    const dims = splitDims(dimensions);
    // Fetch extra rows so items can be matched between the two periods.
    const q = (startDate: string, endDate: string) =>
      service.searchanalytics.query({
        siteUrl,
        requestBody: { startDate, endDate, dimensions: dims, rowLimit: 1000, dataState: config.dataState },
      });
    const { data: r1 } = await q(p1Start, p1End);
    const { data: r2 } = await q(p2Start, p2End);

    const rows1 = r1.rows ?? [];
    const rows2 = r2.rows ?? [];
    if (!rows1.length && !rows2.length) return `No data found for either period for ${siteUrl}.`;

    const keyOf = (r: Row) => JSON.stringify(r.keys ?? []);
    const m1 = new Map(rows1.map((r) => [keyOf(r), r]));
    const m2 = new Map(rows2.map((r) => [keyOf(r), r]));
    const allKeys = new Set([...m1.keys(), ...m2.keys()]);
    const zero: Row = { clicks: 0, impressions: 0, ctr: 0, position: 0 };

    // Differences are Period 1 relative to Period 2 (the baseline). Positive always
    // means Period 1 outperformed: more clicks/impressions, higher CTR, or lower position.
    const items = [...allKeys].map((key) => {
      const a = m1.get(key) ?? zero;
      const b = m2.get(key) ?? zero;
      const clickDiff = (a.clicks ?? 0) - (b.clicks ?? 0);
      const impDiff = (a.impressions ?? 0) - (b.impressions ?? 0);
      return {
        key: JSON.parse(key) as string[],
        p1_clicks: a.clicks ?? 0,
        p2_clicks: b.clicks ?? 0,
        click_diff: clickDiff,
        click_pct: (b.clicks ?? 0) > 0 ? round((clickDiff / b.clicks!) * 100, 1) : null,
        p1_impressions: a.impressions ?? 0,
        p2_impressions: b.impressions ?? 0,
        imp_diff: impDiff,
        imp_pct: (b.impressions ?? 0) > 0 ? round((impDiff / b.impressions!) * 100, 1) : null,
        p1_ctr: round(a.ctr ?? 0, 4),
        p2_ctr: round(b.ctr ?? 0, 4),
        ctr_diff: round((a.ctr ?? 0) - (b.ctr ?? 0), 4),
        p1_position: round(a.position ?? 0, 1),
        p2_position: round(b.position ?? 0, 1),
        position_diff: round((b.position ?? 0) - (a.position ?? 0), 1),
      };
    });

    items.sort((x, y) => Math.abs(y.click_diff) - Math.abs(x.click_diff));
    const shown = items.slice(0, limit);

    return ok({
      site_url: siteUrl,
      period1: { start: p1Start, end: p1End },
      period2: { start: p2Start, end: p2End },
      dimensions: dims,
      total_items: items.length,
      showing: shown.length,
      comparison: shown,
    });
  } catch (e) {
    if (isNotFound(e)) return siteNotFoundError(siteUrl);
    return `Error comparing search periods: ${errMsg(e)}`;
  }
}

export async function findPageKeywords(siteUrl: string, pageUrl: string, days = 28, rowLimit = 20): Promise<string> {
  try {
    const service = await getService();
    const { start, end } = daysAgo(days);
    const { data } = await service.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate: start,
        endDate: end,
        dimensions: ["query"],
        dimensionFilterGroups: [{ filters: [{ dimension: "page", operator: "equals", expression: pageUrl }] }],
        rowLimit: Math.min(Math.max(1, rowLimit), 500),
        dataState: config.dataState,
      },
    });
    if (!data.rows?.length) return `No search data found for page ${pageUrl} in the last ${days} days.`;

    const rows = data.rows.map((r) => ({
      query: r.keys?.[0] ?? "Unknown",
      clicks: r.clicks ?? 0,
      impressions: r.impressions ?? 0,
      ctr: round(r.ctr ?? 0, 4),
      position: round(r.position ?? 0, 1),
    }));
    const totalClicks = rows.reduce((s, r) => s + r.clicks, 0);
    const totalImpressions = rows.reduce((s, r) => s + r.impressions, 0);

    return ok({
      site_url: siteUrl,
      page_url: pageUrl,
      date_range: { start, end, days },
      totals: {
        clicks: totalClicks,
        impressions: totalImpressions,
        avg_ctr: totalImpressions > 0 ? round(totalClicks / totalImpressions, 4) : 0,
      },
      row_count: rows.length,
      rows,
    });
  } catch (e) {
    return `Error retrieving page query data: ${errMsg(e)}`;
  }
}

/* --------------------------------------------------------- URL inspection */

type Inspection = Record<string, any>;

/** Shape richResultsResult; issues live under detectedItems[].items[].issues[]. */
export function richResultsSummary(inspection: Inspection): Json | null {
  const rich = inspection.richResultsResult;
  if (!rich) return null;
  const detected: Inspection[] = rich.detectedItems ?? [];
  return {
    verdict: rich.verdict ?? "UNKNOWN",
    detected_types: detected.map((d) => d.richResultType ?? "Unknown"),
    issues: detected.flatMap((d) =>
      (d.items ?? []).flatMap((item: Inspection) =>
        (item.issues ?? []).map((issue: Inspection) => ({
          type: d.richResultType ?? "Unknown",
          item: item.name ?? null,
          severity: issue.severity ?? null,
          message: issue.issueMessage ?? null,
        })),
      ),
    ),
  };
}

export async function checkUrl(siteUrl: string, pageUrl: string): Promise<string> {
  try {
    const service = await getService();
    const { data } = await service.urlInspection.index.inspect({
      requestBody: { inspectionUrl: pageUrl, siteUrl },
    });
    if (!data?.inspectionResult) return `No inspection data found for ${pageUrl}.`;

    const inspection = data.inspectionResult as Inspection;
    const idx: Inspection = inspection.indexStatusResult ?? {};

    return ok({
      page_url: pageUrl,
      site_url: siteUrl,
      inspection_result_link: inspection.inspectionResultLink ?? null,
      verdict: idx.verdict ?? "UNKNOWN",
      coverage_state: idx.coverageState ?? null,
      last_crawled: idx.lastCrawlTime ? (fmtDateTime(idx.lastCrawlTime) ?? idx.lastCrawlTime) : null,
      page_fetch_state: idx.pageFetchState ?? null,
      robots_txt_state: idx.robotsTxtState ?? null,
      indexing_state: idx.indexingState ?? null,
      google_canonical: idx.googleCanonical ?? null,
      user_canonical: idx.userCanonical ?? null,
      crawled_as: idx.crawledAs ?? null,
      referring_urls: (idx.referringUrls ?? []).slice(0, 5),
      rich_results: richResultsSummary(inspection),
    });
  } catch (e) {
    if (isNotFound(e)) return siteNotFoundError(siteUrl);
    return `Error inspecting URL: ${errMsg(e)}`;
  }
}

const MAX_BATCH_URLS = 10;

function parseUrls(urls: string): string[] {
  return urls.split("\n").map((u) => u.trim()).filter(Boolean);
}

async function inspectOne(service: SearchConsole, siteUrl: string, pageUrl: string): Promise<Inspection | null> {
  const { data } = await service.urlInspection.index.inspect({ requestBody: { inspectionUrl: pageUrl, siteUrl } });
  return (data?.inspectionResult as Inspection) ?? null;
}

export async function checkUrls(siteUrl: string, urls: string): Promise<string> {
  try {
    // Authenticate once up front so the concurrent calls share one refreshed token.
    const service = await getService();
    const list = parseUrls(urls);
    if (!list.length) return "No URLs provided for inspection.";
    if (list.length > MAX_BATCH_URLS) {
      return `Too many URLs provided (${list.length}). Please limit to ${MAX_BATCH_URLS} URLs per batch to avoid API quota issues.`;
    }

    // Concurrent so a full batch stays under the MCP client's request timeout; the
    // result order follows the input order.
    const results = await Promise.all(
      list.map(async (pageUrl): Promise<Json> => {
        try {
          const inspection = await inspectOne(service, siteUrl, pageUrl);
          if (!inspection) return { url: pageUrl, error: "No inspection data found" };
          const idx: Inspection = inspection.indexStatusResult ?? {};
          return {
            url: pageUrl,
            index_verdict: idx.verdict ?? "UNKNOWN",
            coverage_state: idx.coverageState ?? "Unknown",
            last_crawled: idx.lastCrawlTime ? (fmtDateTime(idx.lastCrawlTime)?.slice(0, 10) ?? idx.lastCrawlTime) : "Never",
            rich_results: richResultsSummary(inspection),
          };
        } catch (e) {
          return { url: pageUrl, error: errMsg(e) };
        }
      }),
    );

    return ok({ site_url: siteUrl, count: results.length, results });
  } catch (e) {
    return `Error performing batch inspection: ${errMsg(e)}`;
  }
}

/* ----------------------------------------------------------------- sitemaps */

function webSubmitted(contents: { type?: string | null; submitted?: string | null }[] | undefined | null) {
  const web = contents?.find((c) => c.type === "web");
  return web?.submitted ?? null;
}

export async function showSitemaps(siteUrl: string, sitemapIndex?: string | null): Promise<string> {
  try {
    const service = await getService();
    const { data } = await service.sitemaps.list(sitemapIndex ? { siteUrl, sitemapIndex } : { siteUrl });
    if (!data.sitemap?.length) {
      return `No sitemaps found for ${siteUrl}` + (sitemapIndex ? ` in index ${sitemapIndex}` : ".");
    }

    const sitemaps = data.sitemap.map((s) => ({
      path: s.path ?? "Unknown",
      last_submitted: fmtDateTime(s.lastSubmitted),
      last_downloaded: fmtDateTime(s.lastDownloaded),
      type: s.isSitemapsIndex ? "Index" : "Sitemap",
      is_pending: s.isPending ?? false,
      url_count: webSubmitted(s.contents),
      errors: Number(s.errors ?? 0),
      warnings: Number(s.warnings ?? 0),
    }));

    return ok({
      site_url: siteUrl,
      sitemap_index: sitemapIndex ?? null,
      count: sitemaps.length,
      pending_count: sitemaps.filter((s) => s.is_pending).length,
      sitemaps,
    });
  } catch (e) {
    if (isNotFound(e)) return siteNotFoundError(siteUrl);
    return `Error retrieving sitemaps: ${errMsg(e)}`;
  }
}

export async function showSitemap(siteUrl: string, sitemapUrl: string): Promise<string> {
  try {
    const service = await getService();
    const { data } = await service.sitemaps.get({ siteUrl, feedpath: sitemapUrl });
    if (!data || !Object.keys(data).length) return `No details found for sitemap ${sitemapUrl}.`;

    const isIndex = data.isSitemapsIndex ?? false;
    return ok({
      sitemap_url: sitemapUrl,
      site_url: siteUrl,
      type: isIndex ? "Index" : "Sitemap",
      status: data.isPending ? "pending" : "processed",
      last_submitted: fmtDateTime(data.lastSubmitted),
      last_downloaded: fmtDateTime(data.lastDownloaded),
      errors: Number(data.errors ?? 0),
      warnings: Number(data.warnings ?? 0),
      content_breakdown: (data.contents ?? []).map((c) => ({
        type: (c.type ?? "unknown").toUpperCase(),
        submitted: c.submitted ?? 0,
        indexed: c.indexed ?? null,
      })),
      is_index: isIndex,
    });
  } catch (e) {
    return `Error retrieving sitemap details: ${errMsg(e)}`;
  }
}

export async function addSitemap(siteUrl: string, sitemapUrl: string): Promise<string> {
  if (!config.allowDestructive) {
    return (
      "wsp_add_sitemap_gsc needs write access to Search Console, but this server is running with the " +
      "read-only scope. Set WSP_ALLOW_WRITES=true and call the 'wsp_login_again_gsc' tool to grant write access."
    );
  }
  try {
    const service = await getService();
    await service.sitemaps.submit({ siteUrl, feedpath: sitemapUrl });

    try {
      const { data } = await service.sitemaps.get({ siteUrl, feedpath: sitemapUrl });
      const lines = [`Successfully submitted sitemap: ${sitemapUrl}`];
      if (data.lastSubmitted) lines.push(`Submission time: ${fmtDateTime(data.lastSubmitted)}`);
      lines.push(`Status: ${(data.isPending ?? true) ? "Pending processing" : "Processing started"}`);
      lines.push("\nNote: Google may take some time to process the sitemap. Check back later for full details.");
      return lines.join("\n");
    } catch {
      return `Successfully submitted sitemap: ${sitemapUrl}\n\nGoogle will queue it for processing.`;
    }
  } catch (e) {
    return `Error submitting sitemap: ${errMsg(e)}`;
  }
}

export async function removeSitemap(siteUrl: string, sitemapUrl: string): Promise<string> {
  if (!config.allowDestructive) {
    return (
      "Safety: wsp_remove_sitemap_gsc permanently removes a sitemap from GSC. " +
      "Set WSP_ALLOW_WRITES=true in your environment to enable write tools."
    );
  }
  try {
    const service = await getService();
    try {
      await service.sitemaps.get({ siteUrl, feedpath: sitemapUrl });
    } catch (e) {
      if (isNotFound(e)) {
        return `Sitemap not found: ${sitemapUrl}. It may have already been deleted or was never submitted.`;
      }
      throw e;
    }
    await service.sitemaps.delete({ siteUrl, feedpath: sitemapUrl });
    return `Successfully deleted sitemap: ${sitemapUrl}\n\nNote: This only removes the sitemap from Search Console. Any URLs already indexed will remain in Google's index.`;
  } catch (e) {
    return `Error deleting sitemap: ${errMsg(e)}`;
  }
}

/* --------------------------------------------------------------------- auth */

export async function loginAgain(): Promise<string> {
  try {
    return await auth.loginAgain();
  } catch (e) {
    return `Error during reauthentication: ${errMsg(e)}`;
  }
}

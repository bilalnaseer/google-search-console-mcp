import { beforeEach, describe, expect, it, vi } from "vitest";

const svc = vi.hoisted(() => ({ current: undefined as any }));
vi.mock("./auth.js", () => ({
  getGscService: vi.fn(async () => {
    if (svc.current instanceof Error) throw svc.current;
    return svc.current;
  }),
  loginAgain: vi.fn(async () => "ok"),
}));

import { config } from "./config.js";
import * as t from "./tools.js";

const resp = (data: unknown) => Promise.resolve({ data });
const httpError = (status: number, message = "boom", reason = "") =>
  Object.assign(new Error(message), { response: { status, data: { error: { message, errors: [{ reason }] } } } });

function makeService(over: Record<string, any> = {}) {
  return {
    sites: { list: vi.fn(), get: vi.fn(), add: vi.fn(), delete: vi.fn() },
    searchanalytics: { query: vi.fn() },
    sitemaps: { list: vi.fn(), get: vi.fn(), submit: vi.fn(), delete: vi.fn() },
    urlInspection: { index: { inspect: vi.fn() } },
    ...over,
  };
}

let s: ReturnType<typeof makeService>;
beforeEach(() => {
  s = makeService();
  svc.current = s;
  config.allowDestructive = false;
  config.dataState = "all";
});

describe("wsp_list_websites_gsc", () => {
  it("returns JSON with properties", async () => {
    s.sites.list.mockReturnValue(resp({ siteEntry: [{ siteUrl: "https://a.com/", permissionLevel: "siteOwner" }] }));
    expect(JSON.parse(await t.listWebsites())).toEqual({
      count: 1,
      properties: [{ site_url: "https://a.com/", permission_level: "siteOwner" }],
    });
  });
  it("returns a message when empty", async () => {
    s.sites.list.mockReturnValue(resp({}));
    expect(await t.listWebsites()).toBe("No Search Console properties found.");
  });
  it("surfaces the real auth error", async () => {
    svc.current = new Error("token revoked");
    expect(await t.listWebsites()).toContain("token revoked");
  });
});

describe("wsp_show_website_gsc", () => {
  it("returns permission and verification", async () => {
    s.sites.get.mockReturnValue(
      resp({ permissionLevel: "siteOwner", siteVerificationInfo: { verificationState: "VERIFIED" } }),
    );
    const out = JSON.parse(await t.showWebsite("https://a.com/"));
    expect(out.permission_level).toBe("siteOwner");
    expect(out.verification.state).toBe("VERIFIED");
  });
});

describe("sitemaps", () => {
  it("wsp_show_sitemaps_gsc counts pending and passes sitemapIndex", async () => {
    s.sitemaps.list.mockReturnValue(resp({ sitemap: [{ path: "/s", isPending: true, isSitemapsIndex: true }] }));
    const out = JSON.parse(await t.showSitemaps("https://a.com/", "https://a.com/idx.xml"));
    expect(out.pending_count).toBe(1);
    expect(out.sitemaps[0].type).toBe("Index");
    expect(s.sitemaps.list).toHaveBeenCalledWith({ siteUrl: "https://a.com/", sitemapIndex: "https://a.com/idx.xml" });
  });
  it("wsp_show_sitemap_gsc formats dates and contents", async () => {
    s.sitemaps.get.mockReturnValue(
      resp({ lastSubmitted: "2024-03-01T10:30:00Z", contents: [{ type: "web", submitted: "10", indexed: "8" }] }),
    );
    const out = JSON.parse(await t.showSitemap("https://a.com/", "https://a.com/s.xml"));
    expect(out.last_submitted).toBe("2024-03-01 10:30");
    expect(out.content_breakdown).toEqual([{ type: "WEB", submitted: "10", indexed: "8" }]);
  });
});

describe("URL inspection", () => {
  const inspection = (over: Record<string, unknown> = {}) =>
    resp({
      inspectionResult: {
        inspectionResultLink: "https://link",
        indexStatusResult: {
          verdict: "PASS",
          coverageState: "Submitted and indexed",
          lastCrawlTime: "2024-05-01T08:00:00Z",
          pageFetchState: "SUCCESSFUL",
          robotsTxtState: "ALLOWED",
          ...over,
        },
        richResultsResult: {
          verdict: "FAIL",
          detectedItems: [
            { richResultType: "Products", items: [{ name: "P", issues: [{ severity: "ERROR", issueMessage: "Missing price" }] }] },
          ],
        },
      },
    });

  it("wsp_check_url_gsc reports verdict and nested rich result issues", async () => {
    s.urlInspection.index.inspect.mockReturnValue(inspection());
    const out = JSON.parse(await t.checkUrl("https://a.com/", "https://a.com/p"));
    expect(out.verdict).toBe("PASS");
    expect(out.last_crawled).toBe("2024-05-01 08:00");
    expect(out.rich_results.issues).toEqual([
      { type: "Products", item: "P", severity: "ERROR", message: "Missing price" },
    ]);
  });

  it("batch preserves input order and isolates per-URL failures", async () => {
    s.urlInspection.index.inspect.mockImplementation(async ({ requestBody }: any) => {
      if (requestBody.inspectionUrl.endsWith("/bad")) throw new Error("quota");
      return inspection();
    });
    const urls = ["https://a.com/1", "https://a.com/bad", "https://a.com/3"].join("\n");
    const out = JSON.parse(await t.checkUrls("https://a.com/", urls));
    expect(out.results.map((r: any) => r.url)).toEqual(["https://a.com/1", "https://a.com/bad", "https://a.com/3"]);
    expect(out.results[1].error).toBe("quota");
    expect(out.results[0].last_crawled).toBe("2024-05-01");
  });

  it("batch enforces the 10 URL limit", async () => {
    const urls = Array.from({ length: 11 }, (_, i) => `https://a.com/${i}`).join("\n");
    expect(await t.checkUrls("https://a.com/", urls)).toContain("Too many URLs");
    expect(s.urlInspection.index.inspect).not.toHaveBeenCalled();
  });
});

describe("wsp_show_traffic_gsc", () => {
  it("returns totals and a date-sorted trend", async () => {
    s.searchanalytics.query
      .mockReturnValueOnce(resp({ rows: [{ clicks: 5, impressions: 50, ctr: 0.1, position: 2 }] }))
      .mockReturnValueOnce(
        resp({ rows: [{ keys: ["2024-01-02"], clicks: 2 }, { keys: ["2024-01-01"], clicks: 3 }] }),
      );
    const out = JSON.parse(await t.showTraffic("https://a.com/", 2));
    expect(out.totals.clicks).toBe(5);
    expect(out.daily_trend.map((d: any) => d.date)).toEqual(["2024-01-01", "2024-01-02"]);
  });
});

describe("wsp_run_report_gsc", () => {
  const rows = [
    { keys: ["a"], clicks: 10, impressions: 100, ctr: 0.1, position: 9 },
    { keys: ["b"], clicks: 5, impressions: 500, ctr: 0.01, position: 2 },
  ];
  const call = (extra: Record<string, unknown> = {}) =>
    t.runReport({ site_url: "https://a.com/", ...extra });

  it("rejects malformed filters JSON", async () => {
    expect(await call({ filters: "{nope" })).toContain("Invalid filters JSON");
    expect(await call({ filters: "[]" })).toContain("non-empty");
    expect(await call({ filters: '[{"dimension":"page"}]' })).toContain("must have");
  });
  it("rejects invalid data_state", async () => {
    expect(await call({ data_state: "fresh" })).toContain("Invalid data_state");
  });
  it("sorts client-side by impressions and position ascending", async () => {
    s.searchanalytics.query.mockReturnValue(resp({ rows }));
    const byImp = JSON.parse(await call({ sort_by: "impressions" }));
    expect(byImp.rows.map((r: any) => r.query)).toEqual(["b", "a"]);
    const byPos = JSON.parse(await call({ sort_by: "position", sort_direction: "ascending" }));
    expect(byPos.rows.map((r: any) => r.query)).toEqual(["b", "a"]);
  });
  it("paginates using the capped row limit", async () => {
    s.searchanalytics.query.mockReturnValue(resp({ rows: new Array(25000).fill({ keys: ["q"] }) }));
    const out = JSON.parse(await call({ row_limit: 90000, start_row: 100 }));
    expect(out.pagination).toMatchObject({ has_more: true, next_start_row: 25100 });
  });
  it("builds single and multi filters", async () => {
    s.searchanalytics.query.mockReturnValue(resp({ rows }));
    await call({ filter_dimension: "page", filter_expression: "/blog" });
    expect(s.searchanalytics.query.mock.calls[0][0].requestBody.dimensionFilterGroups[0].filters).toEqual([
      { dimension: "page", operator: "contains", expression: "/blog" },
    ]);
    const multi = '[{"dimension":"country","operator":"equals","expression":"usa"}]';
    const out = JSON.parse(await call({ filters: multi, filter_dimension: "page", filter_expression: "x" }));
    expect(out.filters_applied).toHaveLength(1);
    expect(out.filters_applied[0].dimension).toBe("country");
  });
  it("accepts explicit nulls for optional arguments", async () => {
    s.searchanalytics.query.mockReturnValue(resp({ rows }));
    const out = await call({ start_date: null, end_date: null, filters: null, data_state: null });
    expect(JSON.parse(out).rows).toHaveLength(2);
  });
  it("describes the parameters when nothing matches", async () => {
    s.searchanalytics.query.mockReturnValue(resp({}));
    expect(await call({ filter_dimension: "query", filter_expression: "zzz" })).toContain("query contains 'zzz'");
  });
});

describe("wsp_compare_dates_gsc", () => {
  const compare = async (p1: any, p2: any) => {
    s.searchanalytics.query
      .mockReturnValueOnce(resp({ rows: p1 ? [{ keys: ["q"], ...p1 }] : [] }))
      .mockReturnValueOnce(resp({ rows: p2 ? [{ keys: ["q"], ...p2 }] : [] }));
    return JSON.parse(await t.compareDates("https://a.com/", "a", "b", "c", "d")).comparison[0];
  };

  it("period 1 growth is positive, with period 2 as the baseline", async () => {
    const r = await compare(
      { clicks: 150, impressions: 1000, ctr: 0.15, position: 3 },
      { clicks: 100, impressions: 1000, ctr: 0.1, position: 5 },
    );
    expect(r).toMatchObject({ click_diff: 50, click_pct: 50, position_diff: 2, ctr_diff: 0.05 });
  });
  it("period 1 decline is negative", async () => {
    const r = await compare({ clicks: 50, impressions: 10, position: 8 }, { clicks: 100, impressions: 10, position: 4 });
    expect(r).toMatchObject({ click_diff: -50, click_pct: -50, position_diff: -4 });
  });
  it("zero baseline yields null percentages", async () => {
    const r = await compare({ clicks: 10, impressions: 20, position: 1 }, null);
    expect(r.click_pct).toBeNull();
    expect(r.imp_pct).toBeNull();
    expect(r.click_diff).toBe(10);
  });
  it("sorts by absolute click change and applies the limit", async () => {
    s.searchanalytics.query
      .mockReturnValueOnce(resp({ rows: [{ keys: ["a"], clicks: 1 }, { keys: ["b"], clicks: 100 }] }))
      .mockReturnValueOnce(resp({ rows: [{ keys: ["a"], clicks: 0 }, { keys: ["c"], clicks: 40 }] }));
    const out = JSON.parse(await t.compareDates("https://a.com/", "a", "b", "c", "d", "query", 2));
    expect(out.total_items).toBe(3);
    expect(out.comparison.map((r: any) => r.key[0])).toEqual(["b", "c"]);
  });
});

describe("wsp_find_page_keywords_gsc", () => {
  it("returns totals and filters on the page", async () => {
    s.searchanalytics.query.mockReturnValue(
      resp({ rows: [{ keys: ["x"], clicks: 3, impressions: 30 }, { keys: ["y"], clicks: 1, impressions: 10 }] }),
    );
    const out = JSON.parse(await t.findPageKeywords("https://a.com/", "https://a.com/p"));
    expect(out.totals).toEqual({ clicks: 4, impressions: 40, avg_ctr: 0.1 });
    expect(s.searchanalytics.query.mock.calls[0][0].requestBody.dimensionFilterGroups[0].filters[0].expression).toBe("https://a.com/p");
  });
});

describe("safety guards", () => {
  it("blocks destructive tools by default", async () => {
    expect(await t.addWebsite("x")).toContain("Safety");
    expect(await t.removeWebsite("x")).toContain("Safety");
    expect(await t.removeSitemap("x", "y")).toContain("Safety");
    expect(await t.addSitemap("x", "y")).toContain("read-only scope");
    for (const m of [s.sites.add, s.sites.delete, s.sitemaps.delete, s.sitemaps.submit]) expect(m).not.toHaveBeenCalled();
  });
  it("runs them when WSP_ALLOW_WRITES is set", async () => {
    config.allowDestructive = true;
    s.sites.add.mockReturnValue(resp({}));
    s.sites.delete.mockReturnValue(resp({}));
    s.sitemaps.get.mockReturnValue(resp({ isPending: false }));
    s.sitemaps.delete.mockReturnValue(resp({}));
    s.sitemaps.submit.mockReturnValue(resp({}));
    expect(await t.addWebsite("https://a.com/")).toContain("has been added");
    expect(await t.removeWebsite("https://a.com/")).toContain("has been removed");
    expect(await t.removeSitemap("https://a.com/", "https://a.com/s.xml")).toContain("Successfully deleted");
    expect(await t.addSitemap("https://a.com/", "https://a.com/s.xml")).toContain("Processing started");
  });
  it("maps API errors for add/delete", async () => {
    config.allowDestructive = true;
    s.sites.add.mockRejectedValue(httpError(409));
    s.sites.delete.mockRejectedValue(httpError(404));
    expect(await t.addWebsite("https://a.com/")).toContain("already added");
    expect(await t.removeWebsite("https://a.com/")).toContain("was not found");
  });
  it("wsp_remove_sitemap_gsc reports a missing sitemap without deleting", async () => {
    config.allowDestructive = true;
    s.sitemaps.get.mockRejectedValue(httpError(404));
    expect(await t.removeSitemap("https://a.com/", "https://a.com/s.xml")).toContain("Sitemap not found");
    expect(s.sitemaps.delete).not.toHaveBeenCalled();
  });
});

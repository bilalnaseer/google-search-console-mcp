import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

vi.mock("./auth.js", () => ({
  getGscService: vi.fn(async () => ({
    sites: { list: async () => ({ data: { siteEntry: [{ siteUrl: "https://a.com/", permissionLevel: "siteOwner" }] } }) },
    searchanalytics: { query: async () => ({ data: { rows: [{ keys: ["q"], clicks: 1 }] } }) },
  })),
  loginAgain: vi.fn(async () => "ok"),
}));

import { createServer } from "./server.js";

async function connect() {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer().connect(b);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(a);
  return client;
}

describe("MCP server", () => {
  it("registers every tool with titles and annotations", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((x) => x.name).sort()).toEqual(
      [
        "wsp_add_website_gsc", "wsp_compare_dates_gsc", "wsp_remove_website_gsc", "wsp_remove_sitemap_gsc", "wsp_show_status_gsc", "wsp_find_page_keywords_gsc", "wsp_show_traffic_gsc", "wsp_show_website_gsc", "wsp_show_sitemap_gsc", "wsp_check_url_gsc", "wsp_check_urls_gsc", "wsp_list_websites_gsc", "wsp_show_sitemaps_gsc", "wsp_run_report_gsc", "wsp_login_again_gsc", "wsp_add_sitemap_gsc",
      ].sort(),
    );
    const ro = tools.find((x) => x.name === "wsp_list_websites_gsc")!;
    expect(ro.annotations).toMatchObject({ title: "List Websites", readOnlyHint: true, destructiveHint: false });
    expect(tools.find((x) => x.name === "wsp_remove_website_gsc")!.annotations?.destructiveHint).toBe(true);
    expect(client.getInstructions()).toContain("wsp_show_status_gsc");
  });

  it("calls a tool end to end and applies schema defaults", async () => {
    const client = await connect();
    const list = await client.callTool({ name: "wsp_list_websites_gsc", arguments: {} });
    expect((list.content as any)[0].text).toContain("https://a.com/");
    const res = await client.callTool({ name: "wsp_show_traffic_gsc", arguments: { site_url: "https://a.com/" } });
    expect(JSON.parse((res.content as any)[0].text).date_range.days).toBe(28);
  });

  it("accepts explicit null for optional arguments", async () => {
    const client = await connect();
    const res = await client.callTool({
      name: "wsp_run_report_gsc",
      arguments: { site_url: "https://a.com/", start_date: null, filters: null },
    });
    expect(res.isError).toBeFalsy();
  });
});

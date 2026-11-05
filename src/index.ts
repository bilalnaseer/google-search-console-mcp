#!/usr/bin/env node
import http from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer } from "./server.js";

/** Entry point. Supports stdio (default) and SSE transports via WSP_TRANSPORT. */
async function main() {
  const transport = (process.env.WSP_TRANSPORT ?? "stdio").toLowerCase();
  const host = process.env.WSP_HOST ?? "127.0.0.1";
  const port = Number(process.env.WSP_PORT ?? "3001");
  if (!Number.isInteger(port)) throw new Error("WSP_PORT must be an integer");

  if (transport === "stdio") {
    await createServer().connect(new StdioServerTransport());
    return;
  }

  if (transport === "sse" || transport === "http") {
    // One McpServer + SSE transport per client connection; POSTs are routed by sessionId.
    const sessions = new Map<string, SSEServerTransport>();
    const httpServer = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      try {
        if (req.method === "GET" && url.pathname === "/sse") {
          const sse = new SSEServerTransport("/messages", res);
          sessions.set(sse.sessionId, sse);
          res.on("close", () => sessions.delete(sse.sessionId));
          await createServer().connect(sse);
        } else if (req.method === "POST" && url.pathname === "/messages") {
          const sse = sessions.get(url.searchParams.get("sessionId") ?? "");
          if (!sse) {
            res.writeHead(404).end("Unknown session");
            return;
          }
          await sse.handlePostMessage(req, res);
        } else {
          res.writeHead(404).end("Not found");
        }
      } catch (e) {
        console.error("[google-search-console-mcp] request failed:", e);
        if (!res.headersSent) res.writeHead(500).end("Internal error");
      }
    });
    httpServer.listen(port, host, () => console.error(`[google-search-console-mcp] SSE server listening on http://${host}:${port}/sse`));
    return;
  }

  throw new Error(`Unknown WSP_TRANSPORT '${transport}'. Use 'stdio' (default) or 'sse'.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

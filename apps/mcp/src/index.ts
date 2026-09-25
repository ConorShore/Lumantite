#!/usr/bin/env node
/** Lumantite MCP server entry point (stdio transport). */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

await createServer().connect(new StdioServerTransport());

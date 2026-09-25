import { promises as fs } from "node:fs";
import { buildServer } from "./app.js";
import { bootstrapStarterContent } from "./bootstrap.js";
import { loadConfig } from "./config.js";

const config = await loadConfig();

console.log("[lumantite-server] resolved config:\n" + JSON.stringify(config, null, 2));

await fs.mkdir(config.paths.projects, { recursive: true });
await fs.mkdir(config.paths.catalog, { recursive: true });

const fastify = await buildServer(config);

await bootstrapStarterContent(config.paths, fastify.log);

await fastify.listen({ port: config.server.port, host: config.server.host });

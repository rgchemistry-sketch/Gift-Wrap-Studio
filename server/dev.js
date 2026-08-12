import "dotenv/config";

const [{ default: apiApp }, { disconnectDatabase }, { env }, { ensureCatalogSeeded }] =
  await Promise.all([
    import("./app.js"),
    import("./config/database.js"),
    import("./config/env.js"),
    import("./services/store.js"),
  ]);

await ensureCatalogSeeded();

const serveClient = process.argv.includes("--serve-client");
const app = serveClient
  ? (await import("./web-app.js")).createWebApp({ apiApp })
  : apiApp;

const server = app.listen(env.port, () => {
  console.log(
    `[server] Gift N Wrap ${serveClient ? "app" : "API"} listening on http://localhost:${env.port}`,
  );
});

const shutdown = (signal) => {
  console.log(`[server] ${signal} received; closing gracefully.`);
  server.close(async () => {
    await disconnectDatabase();
    process.exit(0);
  });
};

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

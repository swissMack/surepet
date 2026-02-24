import Fastify from "fastify";
import cors from "@fastify/cors";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { getDb, closeDb } from "./db/connection.js";
import { runMigrations } from "./db/migrate.js";
import { CatRepository } from "./db/repositories/cat.repository.js";
import { DeviceRepository } from "./db/repositories/device.repository.js";
import { EventRepository } from "./db/repositories/event.repository.js";
import { ScheduleRepository } from "./db/repositories/schedule.repository.js";
import { CacheRepository } from "./db/repositories/cache.repository.js";
import { SurePetClient } from "./surepet-client/client.js";
import { StateManager } from "./services/state-manager.js";
import { CurfewService } from "./services/curfew.service.js";
import { Scheduler } from "./services/scheduler.js";
import { MqttService } from "./services/mqtt.service.js";
import { statusRoutes } from "./routes/status.routes.js";
import { catsRoutes } from "./routes/cats.routes.js";
import { curfewRoutes } from "./routes/curfew.routes.js";
import { devicesRoutes } from "./routes/devices.routes.js";
import { settingsRoutes } from "./routes/settings.routes.js";

async function main() {
  const config = loadConfig();
  const startTime = new Date();

  // Set timezone
  process.env.TZ = config.timezone;

  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info",
    },
  });

  await fastify.register(cors, { origin: true });

  // Optional API key auth
  if (config.server.apiKey) {
    fastify.addHook("onRequest", async (request, reply) => {
      // Skip auth for /health
      if (request.url === "/health") return;

      // Skip auth for HA ingress requests (Supervisor strips prefix before forwarding)
      if (request.headers["x-ingress-path"]) return;

      const apiKey =
        request.headers["x-api-key"] ||
        request.headers.authorization?.replace("Bearer ", "");

      if (apiKey !== config.server.apiKey) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
    });
  }

  // Database
  const db = getDb(config.db.path);
  runMigrations(db);

  // Repositories
  const catRepo = new CatRepository(db);
  const deviceRepo = new DeviceRepository(db);
  const eventRepo = new EventRepository(db);
  const scheduleRepo = new ScheduleRepository(db);
  const cacheRepo = new CacheRepository(db);

  // Sure Petcare client
  const client = new SurePetClient(
    config.surepet.email,
    config.surepet.password,
    cacheRepo,
    fastify.log
  );

  // Services
  const stateManager = new StateManager(
    client,
    deviceRepo,
    catRepo,
    eventRepo,
    cacheRepo,
    config.surepet.pollIntervalSeconds * 1000,
    fastify.log
  );

  const curfewService = new CurfewService(
    client,
    catRepo,
    eventRepo,
    fastify.log
  );

  const scheduler = new Scheduler(
    scheduleRepo,
    curfewService,
    eventRepo,
    config.timezone,
    fastify.log
  );

  const mqttService = new MqttService(
    config.mqtt,
    catRepo,
    deviceRepo,
    fastify.log
  );

  // Wire CurfewService into MQTT for bidirectional HA control
  mqttService.setCurfewService(curfewService);

  // Register routes
  statusRoutes(fastify, {
    cats: catRepo,
    devices: deviceRepo,
    events: eventRepo,
    schedules: scheduleRepo,
    cache: cacheRepo,
    stateManager,
    scheduler,
    mqtt: mqttService,
    startTime,
  });

  catsRoutes(fastify, {
    cats: catRepo,
    events: eventRepo,
    schedules: scheduleRepo,
    curfewService,
    mqtt: mqttService,
  });

  curfewRoutes(fastify, {
    schedules: scheduleRepo,
    cats: catRepo,
    scheduler,
  });

  devicesRoutes(fastify, {
    devices: deviceRepo,
    events: eventRepo,
    client,
  });

  settingsRoutes(fastify, {
    isHomeAssistant: config.isHomeAssistant,
  });

  // Serve dashboard
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const publicDir = join(__dirname, "..", "public");
  const dashboardPath = join(publicDir, "index.html");
  if (existsSync(dashboardPath)) {
    fastify.get("/", async (req, reply) => {
      let html = readFileSync(dashboardPath, "utf-8");
      // Inject HA ingress base path so frontend API calls route correctly
      const ingressPath = (req.headers["x-ingress-path"] as string) || "";
      html = html.replace("__INGRESS_PATH__", ingressPath);
      return reply.header("Cache-Control", "no-cache").type("text/html").send(html);
    });
  }

  // Serve static files from public/
  fastify.get("/paw-logo.png", async (_req, reply) => {
    const filePath = join(publicDir, "paw-logo.png");
    if (existsSync(filePath)) {
      const content = readFileSync(filePath);
      return reply.header("Cache-Control", "public, max-age=86400").type("image/png").send(content);
    }
    return reply.status(404).send();
  });

  fastify.get("/favicon.svg", async (_req, reply) => {
    const filePath = join(publicDir, "favicon.svg");
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, "utf-8");
      return reply.header("Cache-Control", "public, max-age=86400").type("image/svg+xml").send(content);
    }
    return reply.status(404).send();
  });

  fastify.get("/favicon.ico", async (_req, reply) => {
    const filePath = join(publicDir, "favicon.ico");
    if (existsSync(filePath)) {
      const content = readFileSync(filePath);
      return reply.header("Cache-Control", "public, max-age=86400").type("image/x-icon").send(content);
    }
    return reply.status(404).send();
  });

  fastify.get("/favicon.png", async (_req, reply) => {
    const filePath = join(publicDir, "favicon.png");
    if (existsSync(filePath)) {
      const content = readFileSync(filePath);
      return reply.header("Cache-Control", "public, max-age=86400").type("image/png").send(content);
    }
    return reply.status(404).send();
  });

  // Startup sequence
  try {
    // 1. Authenticate and sync state
    await stateManager.initialSync();
    fastify.log.info("Sure Petcare data synced");

    // 2. Connect MQTT (if enabled)
    if (config.mqtt.enabled) {
      try {
        await mqttService.connect();
        mqttService.publishState();
      } catch (err) {
        fastify.log.warn({ err }, "MQTT connection failed, continuing without MQTT");
      }
    }

    // 3. Initialize scheduler and apply current curfew state
    scheduler.initialize();
    await scheduler.applyCurrentState();

    // 4. Start poll loop
    stateManager.startPolling();

    // 5. Start HTTP server
    await fastify.listen({
      host: config.server.host,
      port: config.server.port,
    });

    fastify.log.info(
      `Surepet Curfew Service running on http://${config.server.host}:${config.server.port}`
    );
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async () => {
    fastify.log.info("Shutting down...");
    stateManager.stopPolling();
    scheduler.stopAll();
    await mqttService.disconnect();
    await fastify.close();
    closeDb();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main();

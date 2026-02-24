import type { FastifyInstance } from "fastify";
import type { CatRepository } from "../db/repositories/cat.repository.js";
import type { DeviceRepository } from "../db/repositories/device.repository.js";
import type { EventRepository } from "../db/repositories/event.repository.js";
import type { ScheduleRepository } from "../db/repositories/schedule.repository.js";
import type { CacheRepository } from "../db/repositories/cache.repository.js";
import type { StateManager } from "../services/state-manager.js";
import type { Scheduler } from "../services/scheduler.js";
import type { MqttService } from "../services/mqtt.service.js";

interface StatusDeps {
  cats: CatRepository;
  devices: DeviceRepository;
  events: EventRepository;
  schedules: ScheduleRepository;
  cache: CacheRepository;
  stateManager: StateManager;
  scheduler: Scheduler;
  mqtt: MqttService;
  startTime: Date;
}

export function statusRoutes(fastify: FastifyInstance, deps: StatusDeps): void {
  const {
    cats,
    devices,
    events,
    schedules,
    cache,
    stateManager,
    scheduler,
    mqtt,
    startTime,
  } = deps;

  fastify.get("/health", async () => {
    const lastPoll = cache.get("last_poll");
    return {
      status: "ok",
      uptime: Math.floor((Date.now() - startTime.getTime()) / 1000),
      lastPoll,
      mqttConnected: mqtt.isConnected(),
      activeSchedules: scheduler.getActiveJobCount(),
    };
  });

  fastify.get("/api/status", async () => {
    const allCats = cats.getAll();
    const allDevices = devices.getAll();
    const allSchedules = schedules.getAll();
    const lastPoll = cache.get("last_poll");

    return {
      cats: allCats.map((cat) => {
        let lastActivity: string | null = null;
        try {
          const raw = cat.raw_data ? JSON.parse(cat.raw_data) : null;
          lastActivity = raw?.status?.activity?.since ?? null;
        } catch { /* ignore */ }
        return {
          ...cat,
          curfew_active: !!cat.curfew_active,
          last_activity: lastActivity,
          schedules: allSchedules
            .filter((s) => s.cat_id === cat.id)
            .map((s) => ({
              ...s,
              days_of_week: JSON.parse(s.days_of_week),
              enabled: !!s.enabled,
            })),
        };
      }),
      devices: allDevices.map((d) => {
        let lastSeenAt: string | null = null;
        try {
          const raw = d.raw_data ? JSON.parse(d.raw_data) : null;
          lastSeenAt = raw?.updated_at ?? null;
        } catch { /* ignore */ }
        return {
          ...d,
          online: !!d.online,
          last_seen_at: lastSeenAt,
        };
      }),
      lastPoll,
      mqttConnected: mqtt.isConnected(),
      activeSchedules: scheduler.getActiveJobCount(),
    };
  });

  fastify.get<{
    Querystring: {
      limit?: string;
      offset?: string;
      type?: string;
      cat_id?: string;
    };
  }>("/api/events", async (request) => {
    const limit = Number(request.query.limit) || 100;
    const offset = Number(request.query.offset) || 0;
    const eventType = request.query.type;
    const catId = request.query.cat_id ? Number(request.query.cat_id) : undefined;

    const rows = events.getAll(limit, offset, eventType, catId);
    const total = events.count(eventType, catId);
    return {
      events: rows.map((e) => ({
        ...e,
        details: e.details ? JSON.parse(e.details) : null,
      })),
      total,
      limit,
      offset,
    };
  });

  fastify.post("/api/sync", async () => {
    await stateManager.poll();
    mqtt.publishState();
    return { status: "synced", timestamp: new Date().toISOString() };
  });
}

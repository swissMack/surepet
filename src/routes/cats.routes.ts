import type { FastifyInstance } from "fastify";
import type { CatRepository } from "../db/repositories/cat.repository.js";
import type { EventRepository } from "../db/repositories/event.repository.js";
import type { ScheduleRepository } from "../db/repositories/schedule.repository.js";
import type { CurfewService } from "../services/curfew.service.js";
import type { MqttService } from "../services/mqtt.service.js";

interface CatsDeps {
  cats: CatRepository;
  events: EventRepository;
  schedules: ScheduleRepository;
  curfewService: CurfewService;
  mqtt: MqttService;
}

export function catsRoutes(fastify: FastifyInstance, deps: CatsDeps): void {
  const { cats, events, schedules, curfewService, mqtt } = deps;

  fastify.get("/api/cats", async () => {
    const allCats = cats.getAll();
    return allCats.map((cat) => ({
      ...cat,
      curfew_active: !!cat.curfew_active,
      schedules: schedules.getByCatId(cat.id).map((s) => ({
        ...s,
        days_of_week: JSON.parse(s.days_of_week),
        enabled: !!s.enabled,
      })),
    }));
  });

  fastify.get<{ Params: { id: string } }>("/api/cats/:id", async (request, reply) => {
    const cat = cats.getById(Number(request.params.id));
    if (!cat) {
      return reply.status(404).send({ error: "Cat not found" });
    }
    return {
      ...cat,
      curfew_active: !!cat.curfew_active,
      schedules: schedules.getByCatId(cat.id).map((s) => ({
        ...s,
        days_of_week: JSON.parse(s.days_of_week),
        enabled: !!s.enabled,
      })),
    };
  });

  fastify.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    "/api/cats/:id/history",
    async (request, reply) => {
      const catId = Number(request.params.id);
      const cat = cats.getById(catId);
      if (!cat) {
        return reply.status(404).send({ error: "Cat not found" });
      }
      const limit = Number(request.query.limit) || 50;
      const rows = events.getByCatId(catId, limit);
      return rows.map((e) => ({
        ...e,
        details: e.details ? JSON.parse(e.details) : null,
      }));
    }
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/cats/:id/curfew/activate",
    async (request, reply) => {
      const catId = Number(request.params.id);
      const success = await curfewService.activateCurfew(catId);
      if (!success) {
        return reply
          .status(400)
          .send({ error: "Failed to activate curfew" });
      }
      mqtt.publishState();
      return { status: "curfew_activated", catId };
    }
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/cats/:id/curfew/deactivate",
    async (request, reply) => {
      const catId = Number(request.params.id);
      const success = await curfewService.deactivateCurfew(catId);
      if (!success) {
        return reply
          .status(400)
          .send({ error: "Failed to deactivate curfew" });
      }
      mqtt.publishState();
      return { status: "curfew_deactivated", catId };
    }
  );
}

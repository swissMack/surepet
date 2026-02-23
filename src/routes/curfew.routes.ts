import type { FastifyInstance } from "fastify";
import type { ScheduleRepository, CreateSchedule } from "../db/repositories/schedule.repository.js";
import type { CatRepository } from "../db/repositories/cat.repository.js";
import type { Scheduler } from "../services/scheduler.js";

interface CurfewDeps {
  schedules: ScheduleRepository;
  cats: CatRepository;
  scheduler: Scheduler;
}

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const VALID_DAYS = [0, 1, 2, 3, 4, 5, 6];

function validateScheduleBody(
  body: Record<string, unknown>
): string | null {
  if (body.lock_time && !TIME_REGEX.test(body.lock_time as string)) {
    return "lock_time must be HH:MM format";
  }
  if (body.unlock_time && !TIME_REGEX.test(body.unlock_time as string)) {
    return "unlock_time must be HH:MM format";
  }
  if (body.days_of_week) {
    const days = body.days_of_week as number[];
    if (!Array.isArray(days) || !days.every((d) => VALID_DAYS.includes(d))) {
      return "days_of_week must be array of 0-6 (Sun-Sat)";
    }
  }
  return null;
}

export function curfewRoutes(fastify: FastifyInstance, deps: CurfewDeps): void {
  const { schedules, cats, scheduler } = deps;

  fastify.get("/api/curfew", async () => {
    return schedules.getAll().map((s) => ({
      ...s,
      days_of_week: JSON.parse(s.days_of_week),
      enabled: !!s.enabled,
    }));
  });

  fastify.post<{
    Body: {
      cat_id: number;
      name: string;
      days_of_week: number[];
      lock_time: string;
      unlock_time: string;
    };
  }>("/api/curfew", async (request, reply) => {
    const body = request.body;

    if (!body.cat_id || !body.name || !body.lock_time || !body.unlock_time) {
      return reply
        .status(400)
        .send({ error: "cat_id, name, lock_time, unlock_time are required" });
    }

    const cat = cats.getById(body.cat_id);
    if (!cat) {
      return reply.status(404).send({ error: "Cat not found" });
    }

    const validationError = validateScheduleBody(body as Record<string, unknown>);
    if (validationError) {
      return reply.status(400).send({ error: validationError });
    }

    const created = schedules.create({
      cat_id: body.cat_id,
      name: body.name,
      days_of_week: body.days_of_week || [0, 1, 2, 3, 4, 5, 6],
      lock_time: body.lock_time,
      unlock_time: body.unlock_time,
    });

    scheduler.createJobs(created.id);

    return reply.status(201).send({
      ...created,
      days_of_week: JSON.parse(created.days_of_week),
      enabled: !!created.enabled,
    });
  });

  fastify.put<{
    Params: { id: string };
    Body: {
      name?: string;
      days_of_week?: number[];
      lock_time?: string;
      unlock_time?: string;
    };
  }>("/api/curfew/:id", async (request, reply) => {
    const id = Number(request.params.id);
    const body = request.body;

    const validationError = validateScheduleBody(body as Record<string, unknown>);
    if (validationError) {
      return reply.status(400).send({ error: validationError });
    }

    const updated = schedules.update(id, body);
    if (!updated) {
      return reply.status(404).send({ error: "Schedule not found" });
    }

    scheduler.createJobs(id);

    return {
      ...updated,
      days_of_week: JSON.parse(updated.days_of_week),
      enabled: !!updated.enabled,
    };
  });

  fastify.delete<{ Params: { id: string } }>(
    "/api/curfew/:id",
    async (request, reply) => {
      const id = Number(request.params.id);
      scheduler.stopJobs(id);
      const deleted = schedules.delete(id);
      if (!deleted) {
        return reply.status(404).send({ error: "Schedule not found" });
      }
      return { status: "deleted", id };
    }
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/curfew/:id/toggle",
    async (request, reply) => {
      const id = Number(request.params.id);
      const toggled = schedules.toggle(id);
      if (!toggled) {
        return reply.status(404).send({ error: "Schedule not found" });
      }

      if (toggled.enabled) {
        scheduler.createJobs(id);
      } else {
        scheduler.stopJobs(id);
      }

      return {
        ...toggled,
        days_of_week: JSON.parse(toggled.days_of_week),
        enabled: !!toggled.enabled,
      };
    }
  );
}

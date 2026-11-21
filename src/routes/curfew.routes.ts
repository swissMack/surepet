import type { FastifyInstance } from "fastify";
import type { ScheduleRepository } from "../db/repositories/schedule.repository.js";
import type { CatRepository } from "../db/repositories/cat.repository.js";
import type { Scheduler } from "../services/scheduler.js";
import type { ScheduleRow } from "../db/repositories/schedule.repository.js";

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
  if (
    body.lock_offset_min !== undefined &&
    (!Number.isInteger(body.lock_offset_min) ||
      Math.abs(body.lock_offset_min as number) > 180)
  ) {
    return "lock_offset_min must be a whole number of minutes between -180 and 180";
  }
  if (body.days_of_week) {
    const days = body.days_of_week as number[];
    if (!Array.isArray(days) || !days.every((d) => VALID_DAYS.includes(d))) {
      return "days_of_week must be array of 0-6 (Sun-Sat)";
    }
  }
  return null;
}

function toApi(s: ScheduleRow) {
  return {
    ...s,
    days_of_week: JSON.parse(s.days_of_week),
    enabled: !!s.enabled,
    lock_at_sunset: !!s.lock_at_sunset,
  };
}

export function curfewRoutes(fastify: FastifyInstance, deps: CurfewDeps): void {
  const { schedules, cats, scheduler } = deps;

  fastify.get("/api/curfew", async () => {
    return schedules.getAll().map(toApi);
  });

  fastify.post<{
    Body: {
      cat_id: number;
      name: string;
      days_of_week: number[];
      lock_time?: string;
      unlock_time: string;
      lock_at_sunset?: boolean;
      lock_offset_min?: number;
    };
  }>("/api/curfew", async (request, reply) => {
    const body = request.body;

    if (!body.cat_id || !body.name || !body.unlock_time || (!body.lock_time && !body.lock_at_sunset)) {
      return reply.status(400).send({
        error: "cat_id, name, unlock_time and lock_time (or lock_at_sunset) are required",
      });
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
      // Placeholder until the sunset refresh below fills in today's time
      lock_time: body.lock_time || "20:00",
      unlock_time: body.unlock_time,
      lock_at_sunset: !!body.lock_at_sunset,
      lock_offset_min: body.lock_offset_min ?? 0,
    });

    scheduler.refreshSunsetTimes(created.id);
    scheduler.createJobs(created.id);

    return reply.status(201).send(toApi(schedules.getById(created.id)!));
  });

  fastify.put<{
    Params: { id: string };
    Body: {
      name?: string;
      days_of_week?: number[];
      lock_time?: string;
      unlock_time?: string;
      lock_at_sunset?: boolean;
      lock_offset_min?: number;
    };
  }>("/api/curfew/:id", async (request, reply) => {
    const id = Number(request.params.id);
    const body = { ...request.body };
    // An explicit lock_time without lock_at_sunset means "fixed time from now on"
    if (body.lock_time !== undefined && body.lock_at_sunset === undefined) {
      body.lock_at_sunset = false;
    }
    if (body.lock_at_sunset) delete body.lock_time;

    const validationError = validateScheduleBody(body as Record<string, unknown>);
    if (validationError) {
      return reply.status(400).send({ error: validationError });
    }

    const updated = schedules.update(id, body);
    if (!updated) {
      return reply.status(404).send({ error: "Schedule not found" });
    }

    scheduler.refreshSunsetTimes(id);
    scheduler.createJobs(id);

    return toApi(schedules.getById(id)!);
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

      return toApi(toggled);
    }
  );
}

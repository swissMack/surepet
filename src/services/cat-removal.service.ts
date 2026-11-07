import type { FastifyBaseLogger } from "fastify";
import type { CatRepository, CatRow } from "../db/repositories/cat.repository.js";
import type { ScheduleRepository } from "../db/repositories/schedule.repository.js";
import type { EventRepository } from "../db/repositories/event.repository.js";
import type { Scheduler } from "./scheduler.js";
import type { MqttService } from "./mqtt.service.js";

/**
 * Removes a pet that no longer exists in the Sure Petcare account:
 * stops and deletes its schedules, deletes the DB row (history kept),
 * and clears its retained MQTT discovery/state so HA drops the entities.
 */
export class CatRemovalService {
  private log: FastifyBaseLogger;

  constructor(
    private cats: CatRepository,
    private schedules: ScheduleRepository,
    private events: EventRepository,
    private scheduler: Scheduler,
    private mqtt: MqttService,
    log: FastifyBaseLogger
  ) {
    this.log = log.child({ module: "cat-removal" });
  }

  /** Auto-removal is only safe when deleting the pet won't drop a live curfew. */
  hasEnabledSchedules(catId: number): boolean {
    return this.schedules.getByCatId(catId).some((s) => !!s.enabled);
  }

  remove(cat: CatRow, reason: "auto" | "manual"): number[] {
    const before = this.schedules.getByCatId(cat.id).map((s) => s.id);
    for (const id of before) this.scheduler.stopJobs(id);

    const deletedSchedules = this.cats.remove(cat.id);
    this.mqtt.removeCat(cat.id);

    this.events.log(
      "cat_removed",
      { name: cat.name, cat_id: cat.id, reason, schedules_deleted: deletedSchedules.length },
      undefined,
      cat.device_id ?? undefined
    );
    this.log.info(
      { catId: cat.id, name: cat.name, reason, schedulesDeleted: deletedSchedules },
      "Cat removed"
    );
    return deletedSchedules;
  }
}

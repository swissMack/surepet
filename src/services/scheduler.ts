import cron from "node-cron";
import type { FastifyBaseLogger } from "fastify";
import { ScheduleRepository } from "../db/repositories/schedule.repository.js";
import { EventRepository } from "../db/repositories/event.repository.js";
import type { CurfewService } from "./curfew.service.js";

interface ActiveJob {
  scheduleId: number;
  lockJob: cron.ScheduledTask;
  unlockJob: cron.ScheduledTask;
}

export class Scheduler {
  private jobs = new Map<number, ActiveJob>();
  private log: FastifyBaseLogger;

  constructor(
    private schedules: ScheduleRepository,
    private curfewService: CurfewService,
    private eventRepo: EventRepository,
    private timezone: string,
    log: FastifyBaseLogger
  ) {
    this.log = log.child({ module: "scheduler" });
  }

  /** Load all enabled schedules and create cron jobs */
  initialize(): void {
    this.log.info("Initializing scheduler");
    this.stopAll();

    const enabled = this.schedules.getEnabled();
    for (const schedule of enabled) {
      this.createJobs(schedule.id);
    }

    this.log.info(
      { activeJobs: this.jobs.size },
      "Scheduler initialized"
    );
  }

  /** Evaluate all schedules right now and apply correct profiles */
  async applyCurrentState(): Promise<void> {
    this.log.info("Evaluating current curfew state on startup");
    const enabled = this.schedules.getEnabled();
    const now = new Date();
    const currentDay = now.getDay(); // 0=Sun, 1=Mon, ...
    const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    // Group schedules by cat
    const catSchedules = new Map<number, typeof enabled>();
    for (const s of enabled) {
      const list = catSchedules.get(s.cat_id) || [];
      list.push(s);
      catSchedules.set(s.cat_id, list);
    }

    for (const [catId, scheduleList] of catSchedules) {
      let shouldBeLocked = false;

      for (const schedule of scheduleList) {
        const days: number[] = JSON.parse(schedule.days_of_week);

        if (this.isInCurfewWindow(days, schedule.lock_time, schedule.unlock_time, currentDay, currentTime)) {
          shouldBeLocked = true;
          break;
        }
      }

      if (shouldBeLocked) {
        this.log.info({ catId }, "Startup: curfew should be active now");
        await this.curfewService.activateCurfew(catId);
      } else {
        this.log.info({ catId }, "Startup: curfew should be inactive now");
        await this.curfewService.deactivateCurfew(catId);
      }
    }
  }

  /** Check if the current time falls within a curfew window */
  private isInCurfewWindow(
    days: number[],
    lockTime: string,
    unlockTime: string,
    currentDay: number,
    currentTime: string
  ): boolean {
    const isOvernight = lockTime > unlockTime;

    if (isOvernight) {
      // e.g., lock 21:00, unlock 07:00
      // Active if: (today is a curfew day AND time >= lockTime) OR
      //            (yesterday was a curfew day AND time < unlockTime)
      const yesterday = (currentDay + 6) % 7;

      if (days.includes(currentDay) && currentTime >= lockTime) {
        return true;
      }
      if (days.includes(yesterday) && currentTime < unlockTime) {
        return true;
      }
    } else {
      // Same-day: e.g., lock 08:00, unlock 17:00
      if (
        days.includes(currentDay) &&
        currentTime >= lockTime &&
        currentTime < unlockTime
      ) {
        return true;
      }
    }

    return false;
  }

  /** Create lock and unlock cron jobs for a schedule */
  createJobs(scheduleId: number): void {
    const schedule = this.schedules.getById(scheduleId);
    if (!schedule || !schedule.enabled) return;

    // Stop existing jobs if any
    this.stopJobs(scheduleId);

    const days: number[] = JSON.parse(schedule.days_of_week);
    if (days.length === 0) return;

    const [lockHour, lockMinute] = schedule.lock_time.split(":").map(Number);
    const [unlockHour, unlockMinute] = schedule.unlock_time
      .split(":")
      .map(Number);

    // Cron day-of-week: 0=Sun, 1=Mon, ... 6=Sat (same as JS)
    const lockDaysCron = days.join(",");

    // For overnight schedules, unlock days are shifted +1
    const isOvernight = schedule.lock_time > schedule.unlock_time;
    const unlockDays = isOvernight
      ? days.map((d) => (d + 1) % 7)
      : days;
    const unlockDaysCron = unlockDays.join(",");

    const lockCron = `${lockMinute} ${lockHour} * * ${lockDaysCron}`;
    const unlockCron = `${unlockMinute} ${unlockHour} * * ${unlockDaysCron}`;

    this.log.info(
      {
        scheduleId,
        catId: schedule.cat_id,
        name: schedule.name,
        lockCron,
        unlockCron,
      },
      "Creating cron jobs"
    );

    const lockJob = cron.schedule(
      lockCron,
      async () => {
        this.log.info(
          { scheduleId, catId: schedule.cat_id, name: schedule.name },
          "Cron: activating curfew"
        );
        const success = await this.curfewService.activateCurfew(schedule.cat_id);
        this.eventRepo.log(
          "cron_lock",
          { scheduleId, name: schedule.name, success },
          schedule.cat_id
        );
      },
      { timezone: this.timezone }
    );

    const unlockJob = cron.schedule(
      unlockCron,
      async () => {
        this.log.info(
          { scheduleId, catId: schedule.cat_id, name: schedule.name },
          "Cron: deactivating curfew"
        );
        const success = await this.curfewService.deactivateCurfew(
          schedule.cat_id
        );
        this.eventRepo.log(
          "cron_unlock",
          { scheduleId, name: schedule.name, success },
          schedule.cat_id
        );
      },
      { timezone: this.timezone }
    );

    this.jobs.set(scheduleId, { scheduleId, lockJob, unlockJob });
  }

  /** Stop and remove cron jobs for a schedule */
  stopJobs(scheduleId: number): void {
    const existing = this.jobs.get(scheduleId);
    if (existing) {
      existing.lockJob.stop();
      existing.unlockJob.stop();
      this.jobs.delete(scheduleId);
    }
  }

  /** Stop all cron jobs */
  stopAll(): void {
    for (const [id] of this.jobs) {
      this.stopJobs(id);
    }
  }

  /** Reload all jobs (e.g., after schedule CRUD) */
  reload(): void {
    this.initialize();
  }

  getActiveJobCount(): number {
    return this.jobs.size;
  }
}

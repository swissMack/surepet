import cron from "node-cron";
import type { FastifyBaseLogger } from "fastify";
import { ScheduleRepository } from "../db/repositories/schedule.repository.js";
import { EventRepository } from "../db/repositories/event.repository.js";
import type { CurfewService } from "./curfew.service.js";
import { sunsetLockTime } from "./sun.js";

export interface HomeLocation {
  latitude: number;
  longitude: number;
  elevation: number;
}

interface ActiveJob {
  scheduleId: number;
  lockJob: cron.ScheduledTask;
  unlockJob: cron.ScheduledTask;
}

export class Scheduler {
  private jobs = new Map<number, ActiveJob>();
  private log: FastifyBaseLogger;
  private sunsetJob: cron.ScheduledTask | null = null;
  private location: HomeLocation | null = null;

  constructor(
    private schedules: ScheduleRepository,
    private curfewService: CurfewService,
    private eventRepo: EventRepository,
    private timezone: string,
    log: FastifyBaseLogger
  ) {
    this.log = log.child({ module: "scheduler" });
  }

  /** Home location for sunset schedules; without it they keep their last lock_time */
  setLocation(location: HomeLocation | null): void {
    this.location = location;
  }

  /**
   * Rewrite lock_time of every sunset schedule to today's sunset + offset.
   * Returns true if any lock_time changed. Leaves cron jobs to the caller.
   */
  refreshSunsetTimes(scheduleId?: number): boolean {
    const targets = this.schedules
      .getAll()
      .filter((s) => s.lock_at_sunset && (scheduleId === undefined || s.id === scheduleId));
    if (targets.length === 0) return false;
    if (!this.location) {
      this.log.warn("No home location — sunset schedules keep their last lock time");
      return false;
    }
    let changed = false;
    for (const s of targets) {
      const lockTime = sunsetLockTime(
        this.location.latitude,
        this.location.longitude,
        this.timezone,
        s.lock_offset_min,
        this.location.elevation
      );
      if (!lockTime) {
        this.log.warn({ scheduleId: s.id }, "No sunset today at this location — lock time unchanged");
        continue;
      }
      if (lockTime !== s.lock_time) {
        this.schedules.update(s.id, { lock_time: lockTime });
        this.log.info(
          { scheduleId: s.id, name: s.name, from: s.lock_time, to: lockTime, offset: s.lock_offset_min },
          "Sunset lock time updated"
        );
        changed = true;
      }
    }
    return changed;
  }

  /** Load all enabled schedules and create cron jobs */
  initialize(): void {
    this.log.info("Initializing scheduler");
    this.stopAll();
    this.refreshSunsetTimes();

    // Recompute sunset lock times shortly after midnight (local time)
    if (!this.sunsetJob) {
      this.sunsetJob = cron.schedule(
        "1 0 * * *",
        () => {
          if (this.refreshSunsetTimes()) this.initialize();
        },
        { timezone: this.timezone }
      );
    }

    const enabled = this.schedules.getEnabled();
    for (const schedule of enabled) {
      this.createJobs(schedule.id);
    }

    this.log.info(
      { activeJobs: this.jobs.size },
      "Scheduler initialized"
    );
  }

  /** Day of week (0=Sun) and "HH:MM" right now in the add-on's timezone */
  private nowInTz(now: Date = new Date()): { day: number; time: string } {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: this.timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
    return { day, time: `${get("hour")}:${get("minute")}` };
  }

  /**
   * Should this cat be locked in right now, judged from ALL its enabled
   * schedules?
   *  - "curfew" schedule: locked in from lock_time to unlock_time.
   *  - "out" schedule: allowed out from unlock_time to lock_time; a cat with
   *    any enabled "out" schedule is locked in outside all of its out windows.
   * Being inside any curfew window always wins.
   * Returns null when the cat has no enabled schedule (manual state is kept).
   */
  shouldBeLocked(catId: number, now: Date = new Date()): boolean | null {
    const list = this.schedules.getEnabled().filter((s) => s.cat_id === catId);
    if (list.length === 0) return null;
    const { day, time } = this.nowInTz(now);

    const curfews = list.filter((s) => s.mode !== "out");
    const outs = list.filter((s) => s.mode === "out");

    const inCurfew = curfews.some((s) =>
      this.isInWindow(JSON.parse(s.days_of_week), s.lock_time, s.unlock_time, day, time)
    );
    if (inCurfew) return true;
    if (outs.length === 0) return false;
    const inOut = outs.some((s) =>
      this.isInWindow(JSON.parse(s.days_of_week), s.unlock_time, s.lock_time, day, time)
    );
    return !inOut;
  }

  /** Apply the state shouldBeLocked() wants for one cat (after a schedule change). */
  async applyCat(catId: number): Promise<void> {
    const { locked, success } = await this.reconcile(catId);
    if (locked !== null) {
      this.log.info({ catId, locked, success }, "Applied schedules after change");
    }
  }

  /** Apply the state shouldBeLocked() wants for one cat. */
  private async reconcile(catId: number): Promise<{ locked: boolean | null; success: boolean }> {
    const locked = this.shouldBeLocked(catId);
    if (locked === null) return { locked, success: true };
    const success = locked
      ? await this.curfewService.activateCurfew(catId)
      : await this.curfewService.deactivateCurfew(catId);
    return { locked, success };
  }

  /** Evaluate all schedules right now and apply correct profiles */
  async applyCurrentState(): Promise<void> {
    this.log.info("Evaluating current curfew state on startup");
    const catIds = [...new Set(this.schedules.getEnabled().map((s) => s.cat_id))];
    for (const catId of catIds) {
      const locked = this.shouldBeLocked(catId);
      this.log.info(
        { catId },
        locked ? "Startup: curfew should be active now" : "Startup: curfew should be inactive now"
      );
      await this.reconcile(catId);
    }
  }

  /**
   * Is (day, time) inside a window that starts at `start` and ends at `end`
   * on the given days? A window with start > end runs past midnight into the
   * next day.
   */
  private isInWindow(
    days: number[],
    start: string,
    end: string,
    currentDay: number,
    currentTime: string
  ): boolean {
    if (start > end) {
      const yesterday = (currentDay + 6) % 7;
      if (days.includes(currentDay) && currentTime >= start) return true;
      if (days.includes(yesterday) && currentTime < end) return true;
      return false;
    }
    return days.includes(currentDay) && currentTime >= start && currentTime < end;
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

    // The window's END fires on the next day when the window runs past
    // midnight. Curfew window: lock → unlock. Out window: unlock → lock.
    const shift = (ds: number[]) => ds.map((d) => (d + 1) % 7);
    const isOut = schedule.mode === "out";
    const crossesMidnight = isOut
      ? schedule.unlock_time > schedule.lock_time
      : schedule.lock_time > schedule.unlock_time;
    const lockDays = isOut && crossesMidnight ? shift(days) : days;
    const unlockDays = !isOut && crossesMidnight ? shift(days) : days;
    const lockDaysCron = lockDays.join(",");
    const unlockDaysCron = unlockDays.join(",");

    const lockCron = `${lockMinute} ${lockHour} * * ${lockDaysCron}`;
    const unlockCron = `${unlockMinute} ${unlockHour} * * ${unlockDaysCron}`;

    this.log.info(
      {
        scheduleId,
        catId: schedule.cat_id,
        name: schedule.name,
        mode: schedule.mode,
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
          "Cron: lock time reached"
        );
        // Judge from all of the cat's schedules, not just this one
        const { locked, success } = await this.reconcile(schedule.cat_id);
        this.eventRepo.log(
          locked === false ? "cron_unlock" : "cron_lock",
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
          "Cron: unlock time reached"
        );
        // Judge from all of the cat's schedules, not just this one
        const { locked, success } = await this.reconcile(schedule.cat_id);
        this.eventRepo.log(
          locked === true ? "cron_lock" : "cron_unlock",
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

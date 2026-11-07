import type { FastifyBaseLogger } from "fastify";
import type { SurePetClient } from "../surepet-client/client.js";
import { DeviceRepository } from "../db/repositories/device.repository.js";
import { CatRepository } from "../db/repositories/cat.repository.js";
import { EventRepository } from "../db/repositories/event.repository.js";
import { CacheRepository } from "../db/repositories/cache.repository.js";
import { PRODUCTS, PET_LOCATION } from "../surepet-client/constants.js";
import type { Device, Pet } from "../surepet-client/types.js";
import type { CatRemovalService } from "./cat-removal.service.js";

/** Consecutive polls a pet must be absent before it is auto-removed. */
const MISSING_POLLS_BEFORE_REMOVAL = 3;

export class StateManager {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private log: FastifyBaseLogger;
  private householdId: number | null = null;
  private removal: CatRemovalService | null = null;
  /** catId → consecutive polls the pet has been absent from the API */
  private missingPolls = new Map<number, number>();

  constructor(
    private client: SurePetClient,
    private devices: DeviceRepository,
    private cats: CatRepository,
    private events: EventRepository,
    private cache: CacheRepository,
    private pollIntervalMs: number,
    log: FastifyBaseLogger
  ) {
    this.log = log.child({ module: "state-manager" });
  }

  setRemovalService(service: CatRemovalService): void {
    this.removal = service;
  }

  async initialSync(): Promise<void> {
    this.log.info("Starting initial sync with Sure Petcare API");
    await this.poll();
    this.log.info("Initial sync complete");
  }

  startPolling(): void {
    if (this.pollTimer) return;
    this.log.info(
      { intervalMs: this.pollIntervalMs },
      "Starting poll loop"
    );
    this.pollTimer = setInterval(() => {
      this.log.debug("Poll tick");
      this.poll().catch((err) => {
        this.log.error({ err: err?.message ?? err, stack: err?.stack }, "Poll failed");
      });
    }, this.pollIntervalMs);
  }

  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      this.log.info("Poll loop stopped");
    }
  }

  async poll(): Promise<void> {
    const dashboard = await this.client.getDashboard();
    const { households, devices, pets } = dashboard.data;

    if (households.length > 0) {
      this.householdId = households[0].id;
      this.cache.set("household_id", String(this.householdId));
    }

    // Sync devices — only cat flaps and pet flaps
    for (const device of devices) {
      if (
        device.product_id === PRODUCTS.CAT_FLAP_CONNECT ||
        device.product_id === PRODUCTS.PET_FLAP_CONNECT ||
        device.product_id === PRODUCTS.PET_FLAP
      ) {
        this.syncDevice(device);
      }
    }

    // Sync pets/cats
    const catStates: Record<string, string> = {};
    for (const pet of pets) {
      this.syncPet(pet, devices);
      const loc =
        pet.status?.activity?.where === PET_LOCATION.INSIDE
          ? "inside"
          : pet.status?.activity?.where === PET_LOCATION.OUTSIDE
            ? "outside"
            : "unknown";
      catStates[pet.name] = loc;
    }

    this.reconcileRemovedPets(pets, households.length > 0);

    this.log.info({ cats: catStates, deviceCount: devices.length }, "Poll complete");
    this.cache.set("last_poll", new Date().toISOString());
  }

  private syncDevice(device: Device): void {
    const existing = this.devices.getById(device.id);
    const batteryVoltage = device.status?.battery ?? null;
    // Calculate battery percentage from voltage (4xAA: ~4.0V dead, ~6.4V new)
    const battery = batteryVoltage
      ? Math.max(0, Math.min(100, Math.round(((batteryVoltage - 4.0) / 2.4) * 100)))
      : null;
    const online = device.status?.online ? 1 : 0;
    const lockMode = device.control?.locking ?? 0;
    const signal =
      device.status?.signal?.device_rssi ?? null;

    this.devices.upsert({
      id: device.id,
      name: device.name,
      product_id: device.product_id,
      battery_level: battery,
      battery_voltage: batteryVoltage,
      online,
      lock_mode: lockMode,
      signal_strength: signal,
      raw_data: JSON.stringify(device),
    });

    if (existing) {
      if (existing.online !== online) {
        this.events.log(
          online ? "device_online" : "device_offline",
          { name: device.name },
          undefined,
          device.id
        );
        this.log.info(
          { deviceId: device.id, name: device.name, online: !!online },
          "Device status changed"
        );
      }
    } else {
      this.log.info(
        { deviceId: device.id, name: device.name, battery, online: !!online },
        "Device discovered"
      );
      this.events.log(
        "device_discovered",
        { name: device.name, product_id: device.product_id },
        undefined,
        device.id
      );
    }
  }

  private syncPet(pet: Pet, devices: Device[]): void {
    const existing = this.cats.getById(pet.id);
    const location =
      pet.status?.activity?.where === PET_LOCATION.INSIDE
        ? "inside"
        : pet.status?.activity?.where === PET_LOCATION.OUTSIDE
          ? "outside"
          : "unknown";

    // Find which device this pet is associated with (via tag)
    let deviceId: number | null = null;
    let currentProfile = 2; // default: full access
    for (const device of devices) {
      if (device.tags) {
        const tagMatch = device.tags.find((t) => t.id === pet.tag_id);
        if (tagMatch) {
          deviceId = device.id;
          currentProfile = tagMatch.profile;
          break;
        }
      }
    }

    this.cats.upsert({
      id: pet.id,
      name: pet.name,
      tag_id: pet.tag_id,
      device_id: deviceId,
      location,
      current_profile: currentProfile,
      curfew_active: currentProfile === 3 ? 1 : 0,
      raw_data: JSON.stringify(pet),
    });

    if (existing) {
      if (existing.location !== location) {
        this.events.log(
          "cat_movement",
          { name: pet.name, from: existing.location, to: location },
          pet.id,
          deviceId ?? undefined
        );
        this.log.info(
          { catId: pet.id, name: pet.name, from: existing.location, to: location },
          "Cat movement detected"
        );
      }
    } else {
      this.log.info(
        { catId: pet.id, name: pet.name, tagId: pet.tag_id, location, deviceId },
        "Cat discovered"
      );
      this.events.log(
        "cat_discovered",
        { name: pet.name, tag_id: pet.tag_id },
        pet.id,
        deviceId ?? undefined
      );
    }
  }

  /**
   * Pets deleted in the official app simply stop appearing in the dashboard.
   * Flag them as missing; after MISSING_POLLS_BEFORE_REMOVAL consecutive
   * absences remove them — unless they still have an enabled schedule, in
   * which case they stay flagged for the user to remove by hand.
   */
  private reconcileRemovedPets(pets: Pet[], householdOk: boolean): void {
    // A response with no household or no pets at all looks like an API glitch,
    // not a real removal — never prune on it.
    if (!householdOk || !Array.isArray(pets) || pets.length === 0) {
      if (this.cats.getAll().length > 0) {
        this.log.warn(
          { households: householdOk, pets: Array.isArray(pets) ? pets.length : null },
          "Dashboard returned no pets — skipping removed-pet check"
        );
      }
      return;
    }

    const seen = new Set(pets.map((p) => p.id));
    for (const id of this.missingPolls.keys()) {
      if (seen.has(id)) this.missingPolls.delete(id);
    }

    for (const cat of this.cats.getAll()) {
      if (seen.has(cat.id)) continue;

      if (!cat.missing_since) {
        this.cats.markMissing(cat.id);
        this.log.info(
          { catId: cat.id, name: cat.name },
          "Cat no longer in Sure Petcare account"
        );
      }

      const count = (this.missingPolls.get(cat.id) ?? 0) + 1;
      this.missingPolls.set(cat.id, count);
      if (count < MISSING_POLLS_BEFORE_REMOVAL || !this.removal) continue;

      if (this.removal.hasEnabledSchedules(cat.id)) {
        if (count === MISSING_POLLS_BEFORE_REMOVAL) {
          this.log.warn(
            { catId: cat.id, name: cat.name },
            "Cat removed from Sure Petcare but has enabled schedules — kept; remove it in the UI"
          );
        }
        continue;
      }

      this.removal.remove(cat, "auto");
      this.missingPolls.delete(cat.id);
    }
  }

  getHouseholdId(): number | null {
    if (this.householdId) return this.householdId;
    const cached = this.cache.get("household_id");
    return cached ? Number(cached) : null;
  }
}

import type { FastifyBaseLogger } from "fastify";
import type { SurePetClient } from "../surepet-client/client.js";
import { CatRepository } from "../db/repositories/cat.repository.js";
import { EventRepository } from "../db/repositories/event.repository.js";
import { TAG_PROFILES } from "../surepet-client/constants.js";

export class CurfewService {
  private log: FastifyBaseLogger;

  constructor(
    private client: SurePetClient,
    private cats: CatRepository,
    private events: EventRepository,
    log: FastifyBaseLogger
  ) {
    this.log = log.child({ module: "curfew-service" });
  }

  /** Activate curfew for a cat: set profile to indoor-only (3) */
  async activateCurfew(catId: number): Promise<boolean> {
    const cat = this.cats.getById(catId);
    if (!cat) {
      this.log.warn({ catId }, "Cat not found");
      return false;
    }

    if (!cat.device_id) {
      this.log.warn({ catId, name: cat.name }, "Cat has no associated device");
      return false;
    }

    if (cat.current_profile === TAG_PROFILES.INDOOR_ONLY) {
      this.log.info(
        { catId, name: cat.name },
        "Curfew already active, skipping"
      );
      return true;
    }

    try {
      await this.client.setTagProfile(
        cat.device_id,
        cat.tag_id,
        TAG_PROFILES.INDOOR_ONLY
      );
      this.cats.updateProfile(catId, TAG_PROFILES.INDOOR_ONLY, true);
      this.events.log(
        "curfew_activated",
        { name: cat.name, profile: TAG_PROFILES.INDOOR_ONLY },
        catId,
        cat.device_id
      );
      this.log.info(
        { catId, name: cat.name, deviceId: cat.device_id, tagId: cat.tag_id },
        "Curfew activated (indoor only)"
      );
      return true;
    } catch (err) {
      this.log.error(
        { err, catId, name: cat.name },
        "Failed to activate curfew"
      );
      this.events.log(
        "curfew_error",
        { name: cat.name, action: "activate", error: String(err) },
        catId,
        cat.device_id
      );
      return false;
    }
  }

  /** Deactivate curfew for a cat: set profile to full access (2) */
  async deactivateCurfew(catId: number): Promise<boolean> {
    const cat = this.cats.getById(catId);
    if (!cat) {
      this.log.warn({ catId }, "Cat not found");
      return false;
    }

    if (!cat.device_id) {
      this.log.warn({ catId, name: cat.name }, "Cat has no associated device");
      return false;
    }

    if (cat.current_profile === TAG_PROFILES.FULL_ACCESS) {
      this.log.info(
        { catId, name: cat.name },
        "Curfew already inactive, skipping"
      );
      return true;
    }

    try {
      await this.client.setTagProfile(
        cat.device_id,
        cat.tag_id,
        TAG_PROFILES.FULL_ACCESS
      );
      this.cats.updateProfile(catId, TAG_PROFILES.FULL_ACCESS, false);
      this.events.log(
        "curfew_deactivated",
        { name: cat.name, profile: TAG_PROFILES.FULL_ACCESS },
        catId,
        cat.device_id
      );
      this.log.info(
        { catId, name: cat.name, deviceId: cat.device_id, tagId: cat.tag_id },
        "Curfew deactivated (full access)"
      );
      return true;
    } catch (err) {
      this.log.error(
        { err, catId, name: cat.name },
        "Failed to deactivate curfew"
      );
      this.events.log(
        "curfew_error",
        { name: cat.name, action: "deactivate", error: String(err) },
        catId,
        cat.device_id
      );
      return false;
    }
  }
}

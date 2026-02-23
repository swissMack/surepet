import type { FastifyInstance } from "fastify";
import type { DeviceRepository } from "../db/repositories/device.repository.js";
import type { EventRepository } from "../db/repositories/event.repository.js";
import type { SurePetClient } from "../surepet-client/client.js";
import { LOCK_MODES, LOCK_MODE_NAMES } from "../surepet-client/constants.js";

interface DevicesDeps {
  devices: DeviceRepository;
  events: EventRepository;
  client: SurePetClient;
}

const LOCK_MODE_MAP: Record<string, number> = {
  unlocked: LOCK_MODES.UNLOCKED,
  locked_in: LOCK_MODES.LOCKED_IN,
  locked_out: LOCK_MODES.LOCKED_OUT,
  locked_all: LOCK_MODES.LOCKED_ALL,
};

export function devicesRoutes(
  fastify: FastifyInstance,
  deps: DevicesDeps
): void {
  const { devices, events, client } = deps;

  fastify.get("/api/devices", async () => {
    return devices.getAll().map((d) => ({
      ...d,
      online: !!d.online,
      lock_mode_name: LOCK_MODE_NAMES[d.lock_mode] || "unknown",
    }));
  });

  fastify.post<{
    Params: { id: string };
    Body: { mode: string };
  }>("/api/devices/:id/lock", async (request, reply) => {
    const deviceId = Number(request.params.id);
    const { mode } = request.body;

    if (!mode || !(mode in LOCK_MODE_MAP)) {
      return reply.status(400).send({
        error: `mode must be one of: ${Object.keys(LOCK_MODE_MAP).join(", ")}`,
      });
    }

    const device = devices.getById(deviceId);
    if (!device) {
      return reply.status(404).send({ error: "Device not found" });
    }

    const lockMode = LOCK_MODE_MAP[mode];
    await client.setDeviceLock(deviceId, lockMode);
    devices.updateLockMode(deviceId, lockMode);
    events.log(
      "device_lock_changed",
      { name: device.name, mode, lockMode },
      undefined,
      deviceId
    );

    return {
      status: "ok",
      deviceId,
      mode,
      lockMode,
    };
  });
}

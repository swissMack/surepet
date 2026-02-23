import mqtt from "mqtt";
import type { FastifyBaseLogger } from "fastify";
import type { Config } from "../config.js";
import type { CatRepository } from "../db/repositories/cat.repository.js";
import type { DeviceRepository } from "../db/repositories/device.repository.js";

export class MqttService {
  private mqttClient: mqtt.MqttClient | null = null;
  private log: FastifyBaseLogger;
  private prefix: string;
  private connected = false;

  constructor(
    private config: Config["mqtt"],
    private cats: CatRepository,
    private devices: DeviceRepository,
    log: FastifyBaseLogger
  ) {
    this.log = log.child({ module: "mqtt" });
    this.prefix = config.topicPrefix;
  }

  async connect(): Promise<void> {
    if (!this.config.enabled) {
      this.log.info("MQTT disabled, skipping");
      return;
    }

    const url = `mqtt://${this.config.host}:${this.config.port}`;
    this.log.info({ url }, "Connecting to MQTT broker");

    this.mqttClient = mqtt.connect(url, {
      username: this.config.username,
      password: this.config.password,
      clientId: `surepet-curfew-${Date.now()}`,
      will: {
        topic: `${this.prefix}/status`,
        payload: Buffer.from("offline"),
        retain: true,
        qos: 1,
      },
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("MQTT connection timeout"));
      }, 10000);

      this.mqttClient!.on("connect", () => {
        clearTimeout(timeout);
        this.connected = true;
        this.log.info("MQTT connected");
        this.publish(`${this.prefix}/status`, "online", true);
        this.publishDiscovery();
        resolve();
      });

      this.mqttClient!.on("error", (err) => {
        clearTimeout(timeout);
        this.log.error({ err }, "MQTT error");
        reject(err);
      });

      this.mqttClient!.on("close", () => {
        this.connected = false;
        this.log.warn("MQTT disconnected");
      });

      this.mqttClient!.on("reconnect", () => {
        this.log.info("MQTT reconnecting");
      });
    });
  }

  /** Publish HA MQTT auto-discovery messages */
  private publishDiscovery(): void {
    const allCats = this.cats.getAll();
    const allDevices = this.devices.getAll();

    for (const cat of allCats) {
      const slugName = cat.name.toLowerCase().replace(/\s+/g, "_");

      // Curfew binary sensor
      this.publishDiscoveryConfig("binary_sensor", `cat_${cat.id}_curfew`, {
        name: `${cat.name} Curfew`,
        unique_id: `surepet_cat_${cat.id}_curfew`,
        state_topic: `${this.prefix}/cats/${cat.id}/curfew`,
        payload_on: "ON",
        payload_off: "OFF",
        device_class: "lock",
        icon: "mdi:cat",
        device: this.catDevice(cat.id, cat.name),
      });

      // Location sensor
      this.publishDiscoveryConfig("sensor", `cat_${cat.id}_location`, {
        name: `${cat.name} Location`,
        unique_id: `surepet_cat_${cat.id}_location`,
        state_topic: `${this.prefix}/cats/${cat.id}/location`,
        icon: "mdi:map-marker",
        device: this.catDevice(cat.id, cat.name),
      });
    }

    for (const device of allDevices) {
      // Battery sensor
      this.publishDiscoveryConfig("sensor", `device_${device.id}_battery`, {
        name: `${device.name} Battery`,
        unique_id: `surepet_device_${device.id}_battery`,
        state_topic: `${this.prefix}/devices/${device.id}/battery`,
        unit_of_measurement: "%",
        device_class: "battery",
        device: this.deviceDevice(device.id, device.name),
      });

      // Signal sensor
      this.publishDiscoveryConfig("sensor", `device_${device.id}_signal`, {
        name: `${device.name} Signal`,
        unique_id: `surepet_device_${device.id}_signal`,
        state_topic: `${this.prefix}/devices/${device.id}/signal`,
        unit_of_measurement: "dBm",
        device_class: "signal_strength",
        device: this.deviceDevice(device.id, device.name),
      });

      // Online binary sensor
      this.publishDiscoveryConfig(
        "binary_sensor",
        `device_${device.id}_online`,
        {
          name: `${device.name} Online`,
          unique_id: `surepet_device_${device.id}_online`,
          state_topic: `${this.prefix}/devices/${device.id}/online`,
          payload_on: "ON",
          payload_off: "OFF",
          device_class: "connectivity",
          device: this.deviceDevice(device.id, device.name),
        }
      );
    }

    this.log.info(
      { cats: allCats.length, devices: allDevices.length },
      "MQTT discovery published"
    );
  }

  private publishDiscoveryConfig(
    component: string,
    objectId: string,
    config: Record<string, unknown>
  ): void {
    const topic = `homeassistant/${component}/${objectId}/config`;
    this.publish(topic, JSON.stringify(config), true);
  }

  private catDevice(catId: number, catName: string) {
    return {
      identifiers: [`surepet_cat_${catId}`],
      name: `${catName} (SurePet)`,
      manufacturer: "Sure Petcare",
      model: "Cat",
    };
  }

  private deviceDevice(deviceId: number, deviceName: string) {
    return {
      identifiers: [`surepet_device_${deviceId}`],
      name: `${deviceName} (SurePet)`,
      manufacturer: "Sure Petcare",
      model: "Cat Flap Connect",
    };
  }

  /** Publish all current state to MQTT topics */
  publishState(): void {
    if (!this.connected) return;

    const allCats = this.cats.getAll();
    const allDevices = this.devices.getAll();

    for (const cat of allCats) {
      this.publish(
        `${this.prefix}/cats/${cat.id}/curfew`,
        cat.curfew_active ? "ON" : "OFF",
        true
      );
      this.publish(
        `${this.prefix}/cats/${cat.id}/location`,
        cat.location,
        true
      );
    }

    for (const device of allDevices) {
      this.publish(
        `${this.prefix}/devices/${device.id}/battery`,
        String(device.battery_level ?? 0),
        true
      );
      this.publish(
        `${this.prefix}/devices/${device.id}/signal`,
        String(device.signal_strength ?? 0),
        true
      );
      this.publish(
        `${this.prefix}/devices/${device.id}/online`,
        device.online ? "ON" : "OFF",
        true
      );
    }
  }

  private publish(topic: string, payload: string, retain = false): void {
    if (!this.mqttClient || !this.connected) return;
    this.mqttClient.publish(topic, payload, { retain, qos: 1 });
  }

  async disconnect(): Promise<void> {
    if (this.mqttClient) {
      this.publish(`${this.prefix}/status`, "offline", true);
      await this.mqttClient.endAsync();
      this.connected = false;
      this.log.info("MQTT disconnected");
    }
  }

  isConnected(): boolean {
    return this.connected;
  }
}

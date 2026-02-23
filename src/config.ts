import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import dotenv from "dotenv";

export interface Config {
  surepet: {
    email: string;
    password: string;
    pollIntervalSeconds: number;
  };
  server: {
    host: string;
    port: number;
    apiKey?: string;
  };
  mqtt: {
    enabled: boolean;
    host: string;
    port: number;
    username?: string;
    password?: string;
    topicPrefix: string;
  };
  db: {
    path: string;
  };
  timezone: string;
  isHomeAssistant: boolean;
}

function loadHAOptions(): Record<string, unknown> | null {
  const optionsPath = "/data/options.json";
  if (existsSync(optionsPath) && process.env.SUPERVISOR_TOKEN) {
    try {
      return JSON.parse(readFileSync(optionsPath, "utf-8"));
    } catch {
      return null;
    }
  }
  return null;
}

export function loadConfig(): Config {
  const haOptions = loadHAOptions();
  const isHA = haOptions !== null;

  if (!isHA) {
    const dotenvPath = join(process.cwd(), ".env");
    if (existsSync(dotenvPath)) {
      dotenv.config({ path: dotenvPath });
    }
  }

  if (isHA) {
    return {
      surepet: {
        email: (haOptions.email as string) || "",
        password: (haOptions.password as string) || "",
        pollIntervalSeconds: (haOptions.poll_interval as number) || 60,
      },
      server: {
        host: "0.0.0.0",
        port: 3000,
        apiKey: haOptions.api_key as string | undefined,
      },
      mqtt: {
        enabled: (haOptions.mqtt_enabled as boolean) ?? true,
        host: process.env.MQTT_HOST || "core-mosquitto",
        port: Number(process.env.MQTT_PORT) || 1883,
        username: process.env.MQTT_USERNAME,
        password: process.env.MQTT_PASSWORD,
        topicPrefix: (haOptions.mqtt_topic_prefix as string) || "surepet",
      },
      db: {
        path: "/data/surepet.db",
      },
      timezone: (haOptions.timezone as string) || "Europe/Amsterdam",
      isHomeAssistant: true,
    };
  }

  const email = process.env.SUREPET_EMAIL;
  const password = process.env.SUREPET_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "SUREPET_EMAIL and SUREPET_PASSWORD are required. Set them in .env or as environment variables."
    );
  }

  return {
    surepet: {
      email,
      password,
      pollIntervalSeconds: Number(process.env.POLL_INTERVAL_SECONDS) || 60,
    },
    server: {
      host: process.env.HOST || "0.0.0.0",
      port: Number(process.env.PORT) || 3000,
      apiKey: process.env.API_KEY,
    },
    mqtt: {
      enabled: process.env.MQTT_ENABLED === "true",
      host: process.env.MQTT_HOST || "localhost",
      port: Number(process.env.MQTT_PORT) || 1883,
      username: process.env.MQTT_USERNAME,
      password: process.env.MQTT_PASSWORD,
      topicPrefix: process.env.MQTT_TOPIC_PREFIX || "surepet",
    },
    db: {
      path: process.env.DB_PATH || join(process.cwd(), "data", "surepet.db"),
    },
    timezone: process.env.TZ || "Europe/Amsterdam",
    isHomeAssistant: false,
  };
}

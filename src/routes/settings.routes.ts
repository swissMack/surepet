import type { FastifyInstance } from "fastify";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

interface SettingsDeps {
  isHomeAssistant: boolean;
}

export function settingsRoutes(
  fastify: FastifyInstance,
  deps: SettingsDeps
): void {
  const { isHomeAssistant } = deps;

  fastify.get("/api/settings", async () => {
    if (isHomeAssistant) {
      const optionsPath = "/data/options.json";
      if (existsSync(optionsPath)) {
        try {
          const opts = JSON.parse(readFileSync(optionsPath, "utf-8"));
          return {
            mode: "homeassistant",
            email: opts.email || "",
            password: maskPassword(opts.password || ""),
            poll_interval: opts.poll_interval ?? 60,
            mqtt_enabled: opts.mqtt_enabled ?? true,
            mqtt_topic_prefix: opts.mqtt_topic_prefix || "surepet",
            timezone: opts.timezone || "Europe/Amsterdam",
            api_key: opts.api_key || "",
            readonly: true,
          };
        } catch {
          return { mode: "homeassistant", readonly: true, error: "Cannot read options" };
        }
      }
      return { mode: "homeassistant", readonly: true };
    }

    // Standalone mode — read from .env
    const envPath = join(process.cwd(), ".env");
    const env = parseEnvFile(envPath);
    return {
      mode: "standalone",
      email: env.SUREPET_EMAIL || "",
      password: maskPassword(env.SUREPET_PASSWORD || ""),
      poll_interval: Number(env.POLL_INTERVAL_SECONDS) || 60,
      mqtt_enabled: env.MQTT_ENABLED === "true",
      mqtt_host: env.MQTT_HOST || "localhost",
      mqtt_port: Number(env.MQTT_PORT) || 1883,
      mqtt_topic_prefix: env.MQTT_TOPIC_PREFIX || "surepet",
      timezone: env.TZ || "Europe/Amsterdam",
      api_key: env.API_KEY || "",
      host: env.HOST || "0.0.0.0",
      port: Number(env.PORT) || 3000,
      readonly: false,
    };
  });

  fastify.put<{
    Body: Record<string, unknown>;
  }>("/api/settings", async (request, reply) => {
    if (isHomeAssistant) {
      return reply
        .status(400)
        .send({ error: "Settings are managed by Home Assistant. Edit them in the addon configuration page." });
    }

    const body = request.body;
    const envPath = join(process.cwd(), ".env");
    const env = parseEnvFile(envPath);

    // Map frontend keys to .env keys
    const keyMap: Record<string, string> = {
      email: "SUREPET_EMAIL",
      password: "SUREPET_PASSWORD",
      poll_interval: "POLL_INTERVAL_SECONDS",
      mqtt_enabled: "MQTT_ENABLED",
      mqtt_host: "MQTT_HOST",
      mqtt_port: "MQTT_PORT",
      mqtt_topic_prefix: "MQTT_TOPIC_PREFIX",
      timezone: "TZ",
      api_key: "API_KEY",
      host: "HOST",
      port: "PORT",
    };

    for (const [feKey, envKey] of Object.entries(keyMap)) {
      if (body[feKey] !== undefined) {
        const val = String(body[feKey]);
        // Don't overwrite password if masked value is sent back
        if (feKey === "password" && val.startsWith("****")) continue;
        env[envKey] = val;
      }
    }

    writeEnvFile(envPath, env);

    return {
      status: "updated",
      restart_required: true,
      message: "Settings saved. Restart the service to apply credential/config changes.",
    };
  });
}

function maskPassword(pw: string): string {
  if (!pw || pw.length < 3) return "****";
  return "****" + pw.slice(-2);
}

function parseEnvFile(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!existsSync(path)) return env;
  const content = readFileSync(path, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

function writeEnvFile(path: string, env: Record<string, string>): void {
  const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  writeFileSync(path, lines.join("\n") + "\n", "utf-8");
}

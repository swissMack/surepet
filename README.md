# SurePet Per-Cat Curfew

Independent curfew schedules per cat for Sure Petcare DualScan cat flaps, with Home Assistant integration.

Sure Petcare's official app only supports a single curfew schedule that applies to **all** cats on a device. This project lets you set individual lock/unlock times for each cat — so one cat can be kept in at night while another roams free.

## How It Works

The app connects to the Sure Petcare cloud API and controls **per-cat tag profiles** rather than locking the entire flap. When a cat's curfew activates, its microchip tag is set to "indoor only" (can enter, cannot exit). Other cats on the same flap remain unaffected.

### Features

- **Per-cat curfew schedules** — each cat gets its own lock/unlock times and days of the week
- **Overnight schedules** — lock Friday 21:00, unlock Saturday 07:00 works correctly
- **Web dashboard** — manage schedules, view cat locations, device battery/signal, event log
- **Home Assistant MQTT integration** — auto-discovered entities for each cat and device
- **Bidirectional control** — toggle curfew from the web UI, HA switches, or automations
- **Event audit log** — every curfew change, device status change, and cat movement is logged

### Supported Devices

- Sure Petcare DualScan Cat Flap Connect
- Sure Petcare Pet Flap Connect
- Sure Petcare Pet Flap

## Installation — Home Assistant Addon

### Prerequisites

- Home Assistant OS or Supervised installation
- A Sure Petcare account with at least one DualScan cat flap
- Mosquitto MQTT broker addon (recommended, for HA entity integration)

### Steps

1. In Home Assistant, go to **Settings → Add-ons → Add-on Store**
2. Click the **three dots (⋮)** menu → **Repositories**
3. Add this repository URL:
   ```
   https://github.com/swissMack/Surepet
   ```
4. Find **SurePet Per-Cat Curfew** in the addon list and click **Install**
5. Go to the **Configuration** tab and enter your Sure Petcare credentials
6. Click **Start**
7. The addon appears in the HA sidebar with a cat paw icon

### Configuration

| Option | Description | Default |
|--------|-------------|---------|
| `email` | Sure Petcare account email | *(required)* |
| `password` | Sure Petcare account password | *(required)* |
| `poll_interval` | API poll interval in seconds (10–3600) | `60` |
| `mqtt_enabled` | Publish state to MQTT for HA auto-discovery | `true` |
| `mqtt_topic_prefix` | MQTT topic prefix | `surepet` |
| `timezone` | Timezone for curfew schedules (e.g. `Europe/London`) | `Europe/Amsterdam` |
| `api_key` | Optional API key to protect the REST API | *(empty)* |

### MQTT Entities

When MQTT is enabled, the addon automatically discovers the Mosquitto broker and publishes HA auto-discovery messages. Entities are created per cat and per device:

**Per cat:**
| Entity | Type | Description |
|--------|------|-------------|
| `binary_sensor.{cat}_curfew` | Binary Sensor | Curfew active/inactive |
| `switch.{cat}_curfew_control` | Switch | Toggle curfew on/off |
| `sensor.{cat}_location` | Sensor | inside / outside / unknown |

**Per device:**
| Entity | Type | Description |
|--------|------|-------------|
| `sensor.{device}_battery` | Sensor | Battery percentage |
| `sensor.{device}_signal` | Sensor | WiFi signal strength (dBm) |
| `binary_sensor.{device}_online` | Binary Sensor | Device connectivity |

These entities can be used in HA automations, dashboards, and scripts.

## Installation — Standalone

Run directly on any machine with Node.js 22+.

```bash
git clone https://github.com/swissMack/Surepet.git
cd Surepet
npm ci
cp .env.example .env
# Edit .env with your Sure Petcare credentials
npm run build
npm start
```

The web dashboard is available at `http://localhost:3000`.

### Environment Variables

See [`.env.example`](.env.example) for all available options including MQTT broker settings, database path, and log level.

## Architecture

```
src/
├── index.ts                 # Fastify server, startup orchestration
├── config.ts                # Config loader (HA addon or .env)
├── surepet-client/          # Sure Petcare API client
├── services/
│   ├── state-manager.ts     # Polls API, syncs cats & devices to DB
│   ├── curfew.service.ts    # Activates/deactivates per-cat tag profiles
│   ├── scheduler.ts         # node-cron jobs for scheduled curfews
│   └── mqtt.service.ts      # MQTT pub/sub with HA auto-discovery
├── routes/                  # REST API endpoints
└── db/                      # SQLite database, migrations, repositories
public/
└── index.html               # Embedded single-file SPA dashboard
ha-addon/                    # Home Assistant addon packaging
```

**Tech stack:** TypeScript, Fastify, SQLite (better-sqlite3), node-cron, MQTT.js, Pino

## License

MIT

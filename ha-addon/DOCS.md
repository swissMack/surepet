# SurePet Per-Cat Curfew — Home Assistant Addon

## Overview

This addon lets you create independent curfew schedules per cat for Sure Petcare DualScan cat flaps. Each cat can have its own lock/unlock times, managed via a web dashboard or Home Assistant entities.

## Installation

1. Add this repository to your Home Assistant addon store:
   - Go to **Settings → Add-ons → Add-on Store → ⋮ → Repositories**
   - Add: `https://github.com/swissMack/Surepet`
2. Find **SurePet Per-Cat Curfew** in the addon list and click **Install**
3. Configure your Sure Petcare credentials in the **Configuration** tab
4. Start the addon

## Configuration

| Option | Description | Default |
|--------|-------------|---------|
| `email` | Sure Petcare account email | (required) |
| `password` | Sure Petcare account password | (required) |
| `poll_interval` | API poll interval in seconds (10-3600) | `60` |
| `mqtt_enabled` | Publish state via MQTT for HA auto-discovery | `true` |
| `mqtt_topic_prefix` | MQTT topic prefix | `surepet` |
| `timezone` | Timezone for curfew schedules | `Europe/Amsterdam` |
| `api_key` | Optional API key (ingress requests bypass this) | (empty) |

## MQTT Integration

When MQTT is enabled, the addon automatically:

- **Discovers** the HA MQTT broker (Mosquitto) from Supervisor
- **Publishes** auto-discovery configs for Home Assistant
- **Creates entities** for each cat and device:
  - `binary_sensor.{cat}_curfew` — Curfew state (ON/OFF)
  - `switch.{cat}_curfew_control` — Toggle curfew from HA
  - `sensor.{cat}_location` — Inside/outside/unknown
  - `sensor.{device}_battery` — Battery percentage
  - `sensor.{device}_signal` — WiFi signal strength (dBm)
  - `binary_sensor.{device}_online` — Connectivity status

## Web Dashboard

The addon provides a web UI accessible via the HA sidebar (panel icon: cat). Features:

- Cat cards with location, profile, curfew status
- Lock/Free buttons for manual curfew control
- Schedule management (create, edit, delete, enable/disable)
- Device status (battery, signal, lock mode)
- Event log with pagination
- Settings page (read-only in HA mode — configure via addon settings)
- Help page with documentation

## Testing

1. After starting the addon, click **Open Web UI** in the addon info panel
2. Verify cats and devices are shown (click Sync if needed)
3. Check **Developer Tools → States** in HA for MQTT entities
4. Test toggling curfew from:
   - The web dashboard (Lock In / Free buttons)
   - HA switch entity (`switch.{cat_name}_curfew_control`)
5. Create a test schedule and verify it runs at the configured time

## Troubleshooting

- **No cats shown:** Check Sure Petcare credentials in addon configuration
- **MQTT entities missing:** Verify Mosquitto addon is running, check addon logs
- **Curfew not activating:** Ensure cat has an associated DualScan device, check event log for errors
- **Addon won't start:** Check logs via **Log** tab for startup errors

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SurePet Per-Cat Curfew — a Node.js/TypeScript application that manages independent curfew schedules for Sure Petcare DualScan cat flaps. Dual deployment: standalone service or Home Assistant addon with MQTT integration.

## Commands

```bash
npm run dev          # Live-reload dev server (tsx watch)
npm run build        # Compile TypeScript → dist/
npm start            # Run compiled server (node dist/index.js)
npm run lint         # ESLint check src/
npm run typecheck    # Type-check without emitting
```

No test framework is configured.

### Deploy Standalone (pve)

```bash
npm run build
rsync -avz --exclude node_modules --exclude .env --exclude data . pve:/opt/surepet/
ssh pve "systemctl restart surepet"
```

### Deploy HA Addon

Commit and push, bump version in `ha-addon/config.yaml` if Dockerfile changed, then reinstall addon in HA UI.

## Architecture

**Stack**: Fastify 5 server, TypeScript (strict, ES2022 modules), SQLite (better-sqlite3, WAL mode), node-cron, MQTT (mqtt.js), Pino logging.

### Server Entry Point — `src/index.ts`

Startup sequence: load config → init DB & migrations → create repositories → create services (StateManager, CurfewService, Scheduler, MqttService) → register routes → serve static SPA from `public/` → initial API sync → start MQTT → initialize scheduler → begin polling.

All services are instantiated in index.ts and injected into routes via closures (no DI container).

### Config — `src/config.ts`

Two modes detected via `SUPERVISOR_TOKEN` env var:
- **HA mode**: reads `/data/options.json`, MQTT auto-discovered from Supervisor API in `run.sh`
- **Standalone**: reads `.env` file (see `.env.example`)

### Database — `src/db/`

- `connection.ts`: SQLite singleton (WAL mode, foreign keys on)
- `migrate.ts`: Sequential migrations in `migrations` array — add new migrations to end, never modify existing
- `repositories/`: Cat, Device, Event, Schedule, Cache — plain functions over better-sqlite3 prepared statements

Tables: `devices`, `cats`, `curfew_schedules`, `event_log`, `state_cache`, `_migrations`

### Sure Petcare API Client — `src/surepet-client/`

- `client.ts`: Auth (token cached in state_cache), dashboard polling, tag profile control, device lock control
- `constants.ts`: Lock modes (0–3), tag profiles (2=full access, 3=indoor only), product IDs for cat flaps (3, 6, 13)
- Auto-retries on 401 (re-authenticates once)

### Services — `src/services/`

- **StateManager**: Polls Sure Petcare API at configurable interval, syncs devices/cats to DB, filters by product_id (cat flaps only), calculates battery % from voltage
- **CurfewService**: Activates/deactivates per-cat curfew by setting tag profile (3=indoor, 2=full access) via API, updates DB, logs events
- **Scheduler**: Creates node-cron jobs from `curfew_schedules` table. Handles overnight schedules (lock day N → unlock day N+1). On startup, `applyCurrentState()` evaluates all schedules against current time
- **MqttService**: Publishes cat/device state, subscribes to command topics, sends HA MQTT auto-discovery configs. Topic prefix configurable (default `surepet`)

### Routes — `src/routes/`

REST API under `/api/`: status, cats (CRUD + curfew control), curfew (schedule CRUD + toggle), devices (list + lock mode), settings (config read/write). Optional API key auth (skips `/health` and HA ingress requests).

### Frontend — `public/index.html`

Single-file embedded SPA (vanilla HTML/CSS/JS, no build step). Server injects `X-Ingress-Path` header value as `__INGRESS_PATH__` token for HA ingress routing. Modify this file directly.

### HA Addon — `ha-addon/`

- `config.yaml`: Addon metadata, options schema, version (bump to force rebuild)
- `Dockerfile`: Downloads source tarball from GitHub, compiles TypeScript, prunes dev deps
- `run.sh`: Auto-discovers MQTT broker from HA Supervisor API, sets env vars, runs `node dist/index.js`
- Docker builds on Proxmox host fail (kernel blocks `spawn sh`) — use HA Supervisor to build

## Key Patterns

- **Overnight curfew logic**: Lock at 21:00 Friday creates cron for day 5; unlock at 07:00 shifts to day 6 (Saturday). This is in `scheduler.ts` — be careful with day-of-week arithmetic.
- **Battery calculation**: `((voltage - 4.0) / 2.4) * 100` clamped 0–100 (4xAA batteries: 4.0V dead, 6.4V full).
- **MQTT state publishing**: After any curfew change (manual or scheduled), call `mqtt.publishState()` to keep HA in sync.
- **HA ingress**: The server reads `X-Ingress-Path` header and string-replaces `__INGRESS_PATH__` in the HTML response. All frontend API calls must prepend this path.
- **Migrations are append-only**: Add new objects to the `migrations` array in `migrate.ts`. Never modify existing migration entries.

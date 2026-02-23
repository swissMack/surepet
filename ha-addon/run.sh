#!/usr/bin/with-contenv bashio

# Discover MQTT from Supervisor
if bashio::services.available "mqtt"; then
  export MQTT_HOST=$(bashio::services mqtt "host")
  export MQTT_PORT=$(bashio::services mqtt "port")
  export MQTT_USERNAME=$(bashio::services mqtt "username")
  export MQTT_PASSWORD=$(bashio::services mqtt "password")
  bashio::log.info "MQTT discovered: ${MQTT_HOST}:${MQTT_PORT}"
fi

bashio::log.info "Starting SurePet Curfew Service..."
cd /app
exec node dist/index.js

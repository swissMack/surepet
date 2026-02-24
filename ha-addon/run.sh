#!/bin/sh
set -e

# Discover MQTT from HA Supervisor API (if available)
if [ -n "$SUPERVISOR_TOKEN" ]; then
  MQTT_INFO=$(curl -s -H "Authorization: Bearer $SUPERVISOR_TOKEN" http://supervisor/services/mqtt 2>/dev/null || echo "{}")
  export MQTT_HOST=$(echo "$MQTT_INFO" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.data?.host||'')}catch{console.log('')}})")
  export MQTT_PORT=$(echo "$MQTT_INFO" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.data?.port||1883)}catch{console.log(1883)}})")
  export MQTT_USERNAME=$(echo "$MQTT_INFO" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.data?.username||'')}catch{console.log('')}})")
  export MQTT_PASSWORD=$(echo "$MQTT_INFO" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.data?.password||'')}catch{console.log('')}})")
  echo "MQTT discovered: ${MQTT_HOST}:${MQTT_PORT}"
fi

echo "Starting SurePet Curfew Service..."
cd /app
exec node dist/index.js

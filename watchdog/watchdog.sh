#!/bin/sh
set -eu

: "${CLOUD_URL:?CLOUD_URL is required}"
: "${CRON_SECRET:?CRON_SECRET is required}"

curl --fail --silent --show-error --max-time 45 \
  --header "Authorization: Bearer ${CRON_SECRET}" \
  "${CLOUD_URL%/}/api/cron/watchdog"

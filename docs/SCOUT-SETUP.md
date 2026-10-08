# Scout setup

The current deployment is documented in [RAILWAY-MIGRATION.md](RAILWAY-MIGRATION.md).
Apify has been removed from the active Scout code and routes. Instagram scraping
is disabled on Railway by default until the default outbound IP is validated
against a single burner session.

When scraping is approved for activation, configure **two independent burner
account cookie jars** as Railway secrets: `SCOUT_COOKIE_JAR` and
`SCOUT_BACKUP_COOKIE_JAR`. Each value is the full Netscape-format cookie-file
contents, not an individual cookie value. Never paste either jar into chat or
commit it. Keep personal/model accounts out of the automation.

The Railway watchdog checks stored freshness every two hours without making
Instagram requests. It alerts the configured Discord webhook when daily
snapshots are over 26 hours old or a full sweep is over eight days old.

For the implementation and data flow, see [SCOUT.md](SCOUT.md). Older setup
notes in archived handoff documents describe the retired Apify/Mac deployment.

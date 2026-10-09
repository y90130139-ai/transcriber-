@echo off
rem Reddit Trends monitoring scheduler, run by Windows Task Scheduler.
rem Installed as the task "Gosian - Reddit Trends collector" (every 10
rem minutes, budget 40 requests per run). At the 5 req/min throttle a full
rem run takes ~8 minutes; overlapping runs are safe by construction (the
rem queue claims with SKIP LOCKED and enqueue is idempotent). Output
rem appends to .reddit-pull.log. Remove it with:
rem   schtasks /delete /tn "Gosian - Reddit Trends collector" /f
cd /d "%~dp0.."
node --import ./test/ts-resolve.mjs scripts/reddit-pull.mjs 40 >> .reddit-pull.log 2>&1

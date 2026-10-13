@echo off
rem Reddit Trends monitoring scheduler, run by Windows Task Scheduler.
rem Installed as the task "Gosian - Reddit Trends collector" (every 10
rem minutes, budget 350 requests per run). The shared client paces itself
rem from Reddit's own rate-limit headers at the configured safety ratio —
rem roughly 50 requests a minute — so a full run takes about seven minutes;
rem overlapping runs are safe by construction (the queue claims with SKIP
rem LOCKED and enqueue is idempotent). Output appends to .reddit-pull.log.
rem Remove it with:
rem   schtasks /delete /tn "Gosian - Reddit Trends collector" /f
cd /d "%~dp0.."
node --import ./test/ts-resolve.mjs scripts/reddit-pull.mjs 350 >> .reddit-pull.log 2>&1

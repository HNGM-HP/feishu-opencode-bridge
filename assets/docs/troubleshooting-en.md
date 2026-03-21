# Troubleshooting Guide

## Feishu Related

| Symptom | Priority Check |
|---|---|
| No response from OpenCode after sending Feishu message | Carefully check Feishu permissions; confirm [Feishu Backend Configuration](feishu-config-en.md) is correct |
| No response from OpenCode after clicking permission card | Check logs for permission response failure; confirm response value is `once/always/reject` |
| Permission card or question card fails to send to group | Check if `sessionId -> chatId` mapping exists in `.chat-sessions.json` |
| Card update fails | Check if message type matches; whether fallback to resend card after failure |

## Discord Related

| Symptom | Priority Check |
|---|---|
| No response from OpenCode after sending Discord message | Check if `DISCORD_ENABLED` is `true`; check if `DISCORD_TOKEN` is correct |
| Bot shows offline | Check if Bot Token is valid; check network connection |
| Commands not working | Ensure Message Content Intent is enabled; check bot permissions |
| File sending failed | Check if file size exceeds Discord limits (8MB/50MB) |

## WeCom Related

| Symptom | Priority Check |
|---|---|
| No response from OpenCode after sending WeCom message | Check if `WECOM_ENABLED` is `true`; check if `WECOM_BOT_ID` and `WECOM_SECRET` are correct |
| Message receiving URL configured incorrectly | Confirm Webhook URL is configured correctly |
| Insufficient application permissions | Check WeCom application permission settings |

## OpenCode Related

| Symptom | Priority Check |
|---|---|
| `/compact` fails | Check if OpenCode available models are normal; if necessary, `/model <provider:model>` first and retry |
| Shell commands like `!ls` fail | Check if current session Agent is available; can execute `/agent general` first and retry |
| OpenCode connection failed | Check `OPENCODE_HOST` and `OPENCODE_PORT` configuration; check if OpenCode is running |
| Authentication failure (401/403) | Check `OPENCODE_SERVER_USERNAME` and `OPENCODE_SERVER_PASSWORD` configuration |
| OpenCode version > `v1.2.15` no response to Feishu messages | Check `~/.config/opencode/opencode.json` (linux/mac is `config.json`) for `"default_agent": "companion"`, delete if present |

## Reliability Related

| Symptom | Priority Check |
|---|---|
| Heartbeat seems not executing | Check if `HEARTBEAT.md` has check items marked as `- [ ]`; check if `memory/heartbeat-state.json` `lastRunAt` is updated |
| Auto-rescue not triggered | Check if `OPENCODE_HOST` is loopback, if `RELIABILITY_LOOPBACK_ONLY` is enabled, if failure count/window reached threshold |
| Auto-rescue rejected (manual) | Check `logs/reliability-audit.jsonl` `reason` field (common: `loopback_only_blocked`, `repair_budget_exhausted`) |
| Cannot find backup config | Check `logs/reliability-audit.jsonl` `backupPath`; backup file naming is `.bak.<timestamp>.<sha256>` |
| Cron tasks not executing | Check if `RELIABILITY_CRON_ENABLED` is `true`; check Cron task status |

## Web Configuration Panel Related

| Symptom | Priority Check |
|---|---|
| Web configuration panel inaccessible | Check `ADMIN_PORT` configuration; check firewall settings; check if service is running |
| Configuration changes not effective | Check if it's sensitive configuration (requires service restart); view service logs |
| Password incorrect | Check `ADMIN_PASSWORD` configuration in `.env` file |
| Configuration lost | Check if `data/config.db` exists; check for backup files |

## Session Related

| Symptom | Priority Check |
|---|---|
| Private chat first-time pushes multiple guide messages | This is first-time flow (group creation card + `/help` + `/panel`); will converse normally as bound session afterwards |
| `/send <path>` reports "file not found" | Confirm path is correct and absolute path; Windows paths use `\` or `/` |
| `/send` reports "refused to send sensitive file" | Built-in security blacklist intercepted .env, keys and other sensitive files |
| File send fails with size limit exceeded | Feishu image limit 10MB, file limit 30MB; compress and retry |
| Session binding failed | Check `ENABLE_MANUAL_SESSION_BIND` configuration; check if session ID is correct |

## Background Service Related

| Symptom | Priority Check |
|---|---|
| Background mode cannot stop | Check if `logs/bridge.pid` remains; use `node scripts/stop.mjs` to cleanup |
| Service startup failed | Check port occupation; view `logs/service.err` |
| Log files too large | Regularly clean `logs/` directory; configure log rotation |

## General Troubleshooting Steps

1. **View service logs**: `logs/service.log` and `logs/service.err`
2. **Check configuration**: Check configuration through Web panel or `data/config.db`
3. **Restart service**: Through Web panel or `node scripts/stop.mjs && npm run start`
4. **Check network**: Ensure server can access platform APIs
5. **Check permissions**: Ensure application/bot has sufficient permissions

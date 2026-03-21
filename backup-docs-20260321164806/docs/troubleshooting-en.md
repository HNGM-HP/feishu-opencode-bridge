# Troubleshooting Guide

| Symptom | Priority Check |
|---|---|
| No response from OpenCode after sending Feishu message | Carefully check Feishu permissions; confirm [Feishu Backend Configuration](feishu-config-en.md) is correct |
| No response from OpenCode after clicking permission card | Check logs for permission response failure; confirm response value is `once/always/reject` |
| Permission card or question card fails to send to group | Check if `sessionId -> chatId` mapping exists in `.chat-sessions.json` |
| Card update fails | Check if message type matches; whether fallback to resend card after failure |
| `/compact` fails | Check if OpenCode available models are normal; if necessary, `/model <provider:model>` first and retry |
| Shell commands like `!ls` fail | Check if current session Agent is available; can execute `/agent general` first and retry |
| Background mode cannot stop | Check if `logs/bridge.pid` remains; use `node scripts/stop.mjs` to cleanup |
| Heartbeat seems not executing | Check if `HEARTBEAT.md` has check items marked as `- [ ]`; check if `memory/heartbeat-state.json` `lastRunAt` is updated |
| Auto-rescue not triggered | Check if `OPENCODE_HOST` is loopback, if `RELIABILITY_LOOPBACK_ONLY` is enabled, if failure count/window reached threshold |
| Auto-rescue rejected (manual) | Check `logs/reliability-audit.jsonl` `reason` field (common: `loopback_only_blocked`, `repair_budget_exhausted`) |
| Cannot find backup config | Check `logs/reliability-audit.jsonl` `backupPath`; backup file naming is `.bak.<timestamp>.<sha256>` |
| Private chat first-time pushes multiple guide messages | This is first-time flow (group creation card + `/help` + `/panel`); will converse normally as bound session afterwards |
| `/send <path>` reports "file not found" | Confirm path is correct and absolute path; Windows paths use `\` or `/` |
| `/send` reports "refused to send sensitive file" | Built-in security blacklist intercepted .env, keys and other sensitive files |
| File send fails with size limit exceeded | Feishu image limit 10MB, file limit 30MB; compress and retry |
| OpenCode version > `v1.2.15` no response to Feishu messages | Check `~/.config/opencode/opencode.json` (linux/mac is `config.json`) for `"default_agent": "companion"`, delete if present |

# Troubleshooting Guide

**Version**: v2.9.57
**Last Updated**: 2026-03-23

---

## Quick Diagnostic Flow

```
Problem Occurs
    │
    ▼
1. Check service logs → logs/service.log, logs/service.err
    │
    ▼
2. Check configuration → Web panel or data/config.db
    │
    ▼
3. Check platform status → Bot/application status on each platform
    │
    ▼
4. Check OpenCode → Running? Accessible?
    │
    ▼
5. Restart service → Many issues temporarily resolved
```

---

## 1. Feishu Issues

| Symptom | Priority Check |
|---------|----------------|
| No response after sending Feishu message | Check Feishu permissions; verify [Feishu Config](feishu-config.md) |
| No response after clicking permission card | Check logs for permission response failure; confirm response is `once/always/reject` |
| Permission/question card fails to send to group | Check `.chat-sessions.json` for `sessionId → chatId` mapping |
| Card update fails | Check message type matches; fallback to resend card |

---

## 2. Discord Issues

| Symptom | Priority Check |
|---------|----------------|
| No response after sending Discord message | Check `DISCORD_ENABLED` is `true`; check `DISCORD_TOKEN` is correct |
| Bot shows offline | Check Bot Token is valid; check network connection |
| Commands not working | Ensure Message Content Intent is enabled; check bot permissions |
| File sending failed | Check file size doesn't exceed Discord limits (8MB/50MB) |

---

## 3. WeCom Issues

| Symptom | Priority Check |
|---------|----------------|
| No response after sending WeCom message | Check `WECOM_ENABLED` is `true`; check `WECOM_BOT_ID` and `WECOM_SECRET` |
| Message receive URL misconfigured | Confirm Webhook URL is configured correctly |
| Insufficient application permissions | Check WeCom application permission settings |

---

## 4. Telegram Issues

| Symptom | Priority Check |
|---------|----------------|
| No response after sending message | Check `TELEGRAM_ENABLED` is `true`; check `TELEGRAM_BOT_TOKEN` |
| Bot shows offline | Check Bot Token is valid; check network connection |

---

## 5. QQ Issues

| Symptom | Priority Check |
|---------|----------------|
| No response after sending message | Check `QQ_ENABLED` is `true`; check OneBot connection |
| OneBot connection failed | Check `QQ_ONEBOT_HTTP_URL` and `QQ_ONEBOT_WS_URL` |

---

## 6. WhatsApp Issues

| Symptom | Priority Check |
|---------|----------------|
| Cannot generate QR code | Network issue; check network connection |
| Disconnects immediately after login | Account restricted; wait and retry |
| Session expired | Long inactivity; re-scan QR code to login |

---

## 7. WeChat Personal Account Issues

| Symptom | Priority Check |
|---------|----------------|
| Account auto-paused | Session expired (errcode -14); check token validity |
| Message send failed | context_token invalid; ensure received message from peer |
| Not receiving messages | Account not enabled; check `enabled` field is 1 |

---

## 8. OpenCode Issues

| Symptom | Priority Check |
|---------|----------------|
| `/compact` fails | Check OpenCode available models; try `/model <provider:model>` first |
| `!ls` shell command fails | Check current session Agent; try `/agent general` first |
| OpenCode connection failed | Check `OPENCODE_HOST` and `OPENCODE_PORT` configuration |
| Authentication fails (401/403) | Check `OPENCODE_SERVER_USERNAME` and `OPENCODE_SERVER_PASSWORD` |
| OpenCode > v1.2.15 no response | Check `~/.config/opencode/opencode.json` for `"default_agent": "companion"` and remove it |

---

## 9. Reliability Issues

| Symptom | Priority Check |
|---------|----------------|
| Heartbeat doesn't seem to execute | Check `HEARTBEAT.md` has items marked as `- [ ]`; check `memory/heartbeat-state.json` `lastRunAt` |
| Auto-rescue doesn't trigger | Check `OPENCODE_HOST` is loopback; `RELIABILITY_LOOPBACK_ONLY` enabled; failure count/window reached threshold |
| Auto-rescue rejected | Check `logs/reliability-audit.jsonl` `reason` field |
| Backup config not found | Check `logs/reliability-audit.jsonl` `backupPath` |
| Cron task doesn't execute | Check `RELIABILITY_CRON_ENABLED` is `true`; check Cron task status |

---

## 10. Web Panel Issues

| Symptom | Priority Check |
|---------|----------------|
| Web panel inaccessible | Check `ADMIN_PORT` configuration; check firewall; check service started |
| Config changes not taking effect | Check if sensitive config (needs restart); view service logs |
| Password error | Check Web panel password set correctly |
| Config lost | Check `data/config.db` exists; check for backup files |

---

## 11. Session Issues

| Symptom | Priority Check |
|---------|----------------|
| Private chat sends multiple guide messages on first chat | Expected first-time flow (create group card + `/help` + `/panel`); subsequent chats work normally |
| `/send <path>` reports "file not found" | Confirm path is correct and absolute; Windows paths can use `\` or `/` |
| `/send` reports "sensitive file rejected" | Built-in security blacklist blocks .env, keys, etc. |
| File send fails with size limit | Feishu image limit 10MB, file limit 30MB; compress and retry |
| Session binding fails | Check `ENABLE_MANUAL_SESSION_BIND` configuration; check session ID is correct |

---

## 12. Background Service Issues

| Symptom | Priority Check |
|---------|----------------|
| Background mode can't stop | Check `logs/bridge.pid` is residual; use `node scripts/stop.mjs` to cleanup |
| Service fails to start | Check port in use; view `logs/service.err` |
| Log files too large | Periodically clean `logs/` directory; configure log rotation |

---

## 13. General Troubleshooting Steps

### 13.1 View Service Logs

```bash
# View standard output logs
tail -f logs/service.log

# View error logs
tail -f logs/service.err

# View reliability audit logs
tail -f logs/reliability-audit.jsonl
```

### 13.2 Check Configuration

Via Web panel `http://localhost:4098` or SQLite:

```bash
sqlite3 data/config.db "SELECT * FROM config_store;"
```

### 13.3 Restart Service

```bash
# Stop service
node scripts/stop.mjs

# Start service
npm run start
```

### 13.4 Check Network

```bash
# Check OpenCode accessibility
curl http://localhost:4096

# Check platform API connectivity
ping api.feishu.cn
ping discord.com
```

### 13.5 Check Processes

```bash
# Check Bridge process
ps aux | grep opencode-bridge

# Check OpenCode process
ps aux | grep opencode
```

---

## 14. Get Help

If above methods don't resolve the issue:

1. **Check detailed logs** for error messages
2. **Search [GitHub Issues](https://github.com/HNGM-HP/opencode-bridge/issues)** for similar problems
3. **Submit new Issue** with:
   - Problem description
   - Relevant logs
   - Configuration (hide sensitive data)
   - Reproduction steps

---

## Related Documentation

- [Deployment Guide](deployment-en.md) - Service deployment and operations
- [Configuration Center](environment-en.md) - Configuration parameters
- [Platform Configs](feishu-config-en.md) - Platform-specific configuration guides

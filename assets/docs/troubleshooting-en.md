# Troubleshooting Guide

**Version**: v2.9.59
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

## 1. Desktop App Installation Issues

### 1.1 macOS: "App is damaged" Error

**Problem**:
```
"OpenCode Bridge" is damaged and can't be opened. You should move it to the Trash.
```

**Reason**:
- macOS security mechanism (Gatekeeper) blocks unsigned apps
- This is a free open-source project without Apple Developer certificate
- This is normal macOS protection behavior for all unsigned apps

**Solutions** (choose one):

#### Method 1: Right-click to Open (Simplest)
```
1. Find "OpenCode Bridge.app" in Finder
2. Right-click on the app icon
3. Hold the "Option" (⌥) key on your keyboard
4. Double-click the "Open" menu item
5. Click "Open" in the confirmation dialog
```

**After this one-time operation**, you can launch normally by double-clicking.

#### Method 2: System Settings Override
```
1. Click "Cancel" to close the error dialog
2. Open "System Settings" → "Privacy & Security"
3. Scroll down to find "OpenCode Bridge was blocked" message
4. Click "Open Anyway" button
5. Enter administrator password to confirm again
```

#### Method 3: Command Line Remove Quarantine
```bash
# Open Terminal and execute
xattr -cr /Applications/OpenCode\ Bridge.app

# If app is in another location, replace with actual path
xattr -cr "/path/to/OpenCode Bridge.app"
```

**How it works**:
- `xattr` command views and modifies file extended attributes
- `-c` flag clears all extended attributes
- `-r` flag recursively processes all files in the app bundle
- macOS marks downloaded files with `com.apple.quarantine` attribute; removing it bypasses Gatekeeper

#### Method 4: Launch from Terminal
```bash
# Execute in Terminal (no arguments needed)
open /Applications/OpenCode\ Bridge.app
```

---

### 1.2 Windows: "Unrecognized App" Warning

**Problem**:
```
Windows protected your PC
Microsoft Defender SmartScreen blocked an unrecognized app from starting. Running this app might put your PC at risk.
```

**Solution**:
```
1. Click "More info" link
2. Click "Run anyway" button
```

**Explanation**:
- Windows Defender SmartScreen shows this warning for apps without digital signatures
- This is normal protection mechanism, not a virus or malware
- After confirming once, SmartScreen will remember this app and won't prompt again

---

### 1.3 Can't Access Management Panel After Launch

**Symptom**: Desktop app is running, but browser cannot access `http://localhost:4098`

**Troubleshooting Steps**:

#### 1. Confirm app is running
- **Windows**: Check system tray (bottom-right notification area) for OpenCode Bridge icon
- **macOS**: Check top menu bar for tray icon

#### 2. Check if port is in use
```bash
# Windows PowerShell
netstat -ano | findstr :4098

# macOS/Linux
lsof -i :4098
```

If port is occupied, you can:
1. Stop the process occupying the port
2. Or modify `ADMIN_PORT` in `.env` file

#### 3. Manually open management panel
Enter directly in browser address bar:
```
http://localhost:4098
```

#### 4. Check log files
- **Windows**:
  ```
  %APPDATA%\opencode-bridge\logs\service.log
  %APPDATA%\opencode-bridge\logs\service.err
  ```
- **macOS**:
  ```
  ~/Library/Application Support/opencode-bridge/logs/service.log
  ~/Library/Application Support/opencode-bridge/logs/service.err
  ```

#### 5. Restart app
- Right-click tray icon → Select "Stop Service" → Wait 3 seconds → Select "Start Service"
- Or exit the app completely and restart

---

### 1.4 App Launches But Exits Immediately

**Possible Causes**:

#### Cause 1: Corrupted configuration file
```bash
# Delete config file (will lose all settings, be careful)
# Windows
del %APPDATA%\opencode-bridge\data\config.db

# macOS
rm ~/Library/Application\ Support/opencode-bridge/data/config.db
```

#### Cause 2: OpenCode service not running
1. Confirm OpenCode is installed and running
2. Check if OpenCode default port (4096) is accessible
```bash
curl http://localhost:4096
```

#### Cause 3: Node.js version incompatibility
- Ensure Node.js 20.0.0 or higher is installed
- Download: https://nodejs.org/

---

### 1.5 How to Completely Uninstall

**Windows**:
```
1. Uninstall via "Settings" → "Apps" → "OpenCode Bridge" → "Uninstall"
2. Manually delete remaining files:
   - %APPDATA%\opencode-bridge
   - %LOCALAPPDATA%\opencode-bridge
```

**macOS**:
```bash
# 1. Quit app (right-click tray icon → Quit)
# 2. Delete app
sudo rm -rf /Applications/OpenCode\ Bridge.app

# 3. Delete config files (optional)
rm -rf ~/Library/Application\ Support/opencode-bridge
rm -rf ~/Library/Caches/opencode-bridge
rm -rf ~/Library/Preferences/com.github.hngm-hp.opencode-bridge.plist
```

---

## 2. Feishu Issues

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

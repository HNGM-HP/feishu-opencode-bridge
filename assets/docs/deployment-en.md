# Deployment and Operations

**Version**: v2.9.57
**Last Updated**: 2026-03-23

---

## 1. Requirements

| Component | Requirement | Notes |
|-----------|-------------|-------|
| **Node.js** | >= 20.0.0 | Required for running the bridge |
| **pnpm** | >= 8.0.0 | Package manager (recommended) |
| **OS** | Linux / macOS / Windows | All platforms supported |
| **OpenCode** | Installed and running | AI assistant backend |

---

## 2. Quick Start

### One-Command Deployment

```bash
# Clone repository
git clone https://github.com/HNGM-HP/opencode-bridge.git
cd opencode-bridge

# One-click deploy (clean install, build, start)
node scripts/deploy.mjs deploy

# Or use interactive management menu
npm run manage:bridge
```

### Available Commands

| Command | Description |
|---------|-------------|
| `node scripts/deploy.mjs deploy` | Clean install, dependencies, build |
| `node scripts/deploy.mjs start` | Start bridge (background) |
| `node scripts/deploy.mjs stop` | Stop background process |
| `node scripts/deploy.mjs reset-password` | Reset admin password |
| `node scripts/deploy.mjs menu` | Interactive management menu (default) |

---

## 3. Web Configuration Panel

### Access

After service startup, access via browser:

```
http://localhost:4098
```

### Features

| Feature | Description |
|---------|-------------|
| **Config Management** | Real-time modification of all platform configs |
| **Cron Management** | Create, enable/disable, delete scheduled tasks |
| **Service Status** | Uptime, version, database path |
| **Model List** | Get OpenCode available models |
| **Service Control** | Remote restart service |
| **Platform Status** | Connection status for each platform |
| **OpenCode Control** | Install, start, check OpenCode status |

### Access Password

- Set on first access
- Stored in SQLite database (`data/config.db`)
- Can be changed in Web panel

---

## 4. Configuration Storage

### SQLite Database

All business configuration stored in SQLite:

- **Database Path**: `data/config.db`
- **First Migration**: Auto-migrate from `.env` on startup
- **Backup**: Original `.env` backed up as `.env.backup`

### Modification Methods

| Method | Description |
|--------|-------------|
| **Web Panel** | Visual modification at `http://localhost:4098` (recommended) |
| **SQLite Tool** | Direct database editing |
| **.env File** | Pre-startup config (auto-migrates on first run) |

---

## 5. Deployment Modes

### 5.1 Source Deployment (Recommended for Production)

```bash
# Clone and install
git clone https://github.com/HNGM-HP/opencode-bridge.git
cd opencode-bridge
pnpm install

# Build
pnpm build

# Start
npm run start
```

### 5.2 npm Global Installation

```bash
# Install globally
npm install -g opencode-bridge

# Start service
opencode-bridge

# Specify config directory
opencode-bridge --config-dir ~/.config/opencode-bridge
```

### Config Directory Priority

1. `.env` in current working directory
2. `~/.config/opencode-bridge/.env`
3. Directory specified by `--config-dir`

---

## 6. systemd Service (Linux)

### Install via Menu

```bash
npm run manage:bridge
# Select "Install and start systemd service"
```

### Manual Installation

Create service file `/etc/systemd/system/opencode-bridge.service`:

```ini
[Unit]
Description=OpenCode Bridge Service
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/path/to/opencode-bridge
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### Enable and Start

```bash
sudo systemctl daemon-reload
sudo systemctl enable opencode-bridge
sudo systemctl start opencode-bridge

# Check status
sudo systemctl status opencode-bridge
```

---

## 7. Windows Service

### Using NSSM

```powershell
# Download NSSM
nssm install opencode-bridge

# Configure
nssm set opencode-bridge Application "C:\path\to\node.exe"
nssm set opencode-bridge ApplicationParameters "dist\index.js"
nssm set opencode-bridge AppDirectory "C:\path\to\opencode-bridge"
nssm set opencode-bridge DisplayName "OpenCode Bridge"
nssm set opencode-bridge StartService SERVICE_AUTO_START

# Start
nssm start opencode-bridge
```

### Using PM2

```powershell
# Install PM2
npm install -g pm2

# Add service
pm2 start dist/index.js --name "opencode-bridge"

# Startup on boot
pm2 startup
pm2 save
```

---

## 8. Platform Configuration

### Quick Setup via Web Panel

1. Access `http://localhost:4098`
2. Navigate to "Platform Config"
3. Configure credentials for each platform
4. Enable platforms in "Core Routing"

### Platform-Specific Guides

| Platform | Guide |
|----------|-------|
| **Feishu** | [Feishu Config Guide](feishu-config-en.md) |
| **Discord** | [Discord Config Guide](discord-config-en.md) |
| **WeCom** | [WeCom Config Guide](wecom-config-en.md) |
| **Telegram** | [Telegram Config Guide](telegram-config-en.md) |
| **QQ** | [QQ Config Guide](qq-config-en.md) |
| **WhatsApp** | [WhatsApp Config Guide](whatsapp-config-en.md) |
| **WeChat** | [WeChat Config Guide](weixin-config-en.md) |

---

## 9. Reliability Configuration

Configure reliability features in Web panel or `.env`:

```env
# Cron API
RELIABILITY_CRON_ENABLED=true
RELIABILITY_CRON_API_ENABLED=true
RELIABILITY_CRON_API_PORT=4097

# Heartbeat
RELIABILITY_PROACTIVE_HEARTBEAT_ENABLED=false
RELIABILITY_HEARTBEAT_INTERVAL_MS=1800000

# Auto-Rescue
RELIABILITY_FAILURE_THRESHOLD=3
RELIABILITY_WINDOW_MS=90000
RELIABILITY_COOLDOWN_MS=300000
RELIABILITY_REPAIR_BUDGET=3
RELIABILITY_LOOPBACK_ONLY=true
```

See [Reliability Guide](reliability-en.md) for details.

---

## 10. Upgrade Guide

### Source Deployment Upgrade

```bash
# Method 1: Upgrade script
node scripts/deploy.mjs upgrade

# Method 2: Manual upgrade
git pull origin main
pnpm install
pnpm build
node scripts/stop.mjs
npm run start
```

### npm Installation Upgrade

```bash
npm update -g opencode-bridge
```

### Gray Release (Router Mode)

For router mode upgrades, follow gray release process:

```bash
# Phase 1: Legacy (stable)
ROUTER_MODE=legacy npm run start

# Phase 2: Dual (observe 24h)
ROUTER_MODE=dual npm run start

# Phase 3: Router (full deployment)
ROUTER_MODE=router npm run start
```

See [Rollout SOP](rollout-en.md) for details.

---

## 11. Log Management

### Log Files

| File | Description |
|------|-------------|
| `logs/service.log` | Service standard output |
| `logs/service.err` | Service error output |
| `logs/bridge.pid` | Background process PID |
| `logs/reliability-audit.jsonl` | Reliability audit log |

### View Logs

```bash
# Real-time logs
tail -f logs/service.log

# Error logs
tail -f logs/service.err

# Last 100 lines
tail -n 100 logs/service.log
```

### Log Rotation

Configure `logrotate` on Linux:

```conf
# /etc/logrotate.d/opencode-bridge
/path/to/opencode-bridge/logs/*.log {
    daily
    rotate 7
    compress
    missingok
    notifempty
}
```

---

## 12. Backup and Recovery

### Backup

```bash
# Backup data directory
tar -czvf opencode-bridge-backup.tar.gz data/

# Backup config only
cp data/config.db data/config.db.backup.$(date +%Y%m%d)
```

### Recovery

```bash
# Restore data directory
tar -xzvf opencode-bridge-backup.tar.gz

# Restore config
cp data/config.db.backup.YYYYMMDD data/config.db
```

---

## 13. Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| **Service won't start** | Check port usage (`lsof -i :4098`), view `logs/service.err` |
| **Web panel inaccessible** | Check firewall, confirm service started |
| **Platform not responding** | Check platform config, view service logs |
| **OpenCode connection failed** | Verify `OPENCODE_HOST` and `OPENCODE_PORT` |
| **Permission stuck** | Check `TOOL_WHITELIST`, session binding |
| **Directory validation failed** | Verify `ALLOWED_DIRECTORIES` config |

### Diagnostic Commands

```bash
# Check OpenCode
node scripts/deploy.mjs opencode-check

# Test OpenCode connection
curl http://localhost:4096

# Check bridge status
ps aux | grep opencode-bridge

# View service logs
tail -f logs/service.log
```

### Get Help

1. Check [Troubleshooting Guide](troubleshooting-en.md)
2. Search [GitHub Issues](https://github.com/HNGM-HP/opencode-bridge/issues)
3. Submit new issue with:
   - Problem description
   - Relevant logs
   - Configuration (hide sensitive data)
   - Reproduction steps

---

## 14. Environment Variables Reference

### Admin Panel (`.env` only)

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_PORT` | `4098` | Web panel listen port |
| `ADMIN_PASSWORD` | Auto | Web panel access password |

### Business Configuration (SQLite)

See [Configuration Center](environment-en.md) for complete parameter reference.

---

## 15. Security Best Practices

### Network Security

- Bind to loopback only (`127.0.0.1`) for local deployments
- Use reverse proxy (nginx) for external access
- Enable HTTPS for remote connections
- Configure firewall rules

### Authentication

- Set strong Web panel password
- Configure `OPENCODE_SERVER_USERNAME`/`PASSWORD` if OpenCode requires auth
- Use `RELIABILITY_CRON_API_TOKEN` for Cron API protection
- Configure `ALLOWED_USERS` for Feishu whitelist

### Secrets Management

- Never commit `.env` files to version control
- Use environment variables for sensitive data
- Rotate tokens and secrets periodically
- Backup config database regularly

---

## 16. Performance Tuning

### Memory Optimization

```env
# Node.js memory limit (if needed)
NODE_OPTIONS="--max-old-space-size=512"
```

### Connection Pooling

- Reuse HTTP connections to platforms
- Configure appropriate timeouts
- Enable keep-alive

### Log Management

- Configure log rotation to prevent disk exhaustion
- Archive old logs to cold storage
- Use log aggregation tools for production

---

## 17. Monitoring and Alerting

### Health Checks

```bash
# Web panel health
curl http://localhost:4098/api/admin/status

# Cron API health
curl http://localhost:4097/health

# OpenCode health
curl http://localhost:4096/health
```

### Metrics to Monitor

- Service uptime
- Message latency
- Error rate
- Platform connection status
- Cron task execution status
- Heartbeat probe results

### Alerting

Configure alerts for:

- Service downtime
- Platform disconnection
- Consecutive OpenCode failures
- Cron task failures
- Heartbeat alerts (`RELIABILITY_HEARTBEAT_ALERT_CHATS`)

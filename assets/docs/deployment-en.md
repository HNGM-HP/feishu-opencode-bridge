# Deployment and Operations

## Available Commands After Node.js Installation

| Goal | Command | Description |
|---|---|---|
| One-click Deploy | `node scripts/deploy.mjs deploy` | Clean install by default, then install dependencies and build |
| One-click Update/Upgrade | `node scripts/deploy.mjs upgrade` | Clean upgrade by default: uninstall/cleanup first, then pull and redeploy |
| Install/Upgrade OpenCode | `node scripts/deploy.mjs opencode-install` | Execute `npm i -g opencode-ai` |
| Check OpenCode Environment | `node scripts/deploy.mjs opencode-check` | Check opencode command and port listening |
| Start OpenCode CLI | `node scripts/deploy.mjs opencode-start` | Auto-write `opencode.json` then execute `opencode` in foreground |
| First-time Guide | `node scripts/deploy.mjs guide` | Integrated flow for install/deploy/guide startup |
| Management Menu | `npm run manage:bridge` | Interactive menu (default entry) |
| Start Background | `npm run start` | Start in background (auto-detect/supplement build) |
| Stop Background | `node scripts/stop.mjs` | Stop background process by PID |

**Note**: The menu includes OpenCode installation/check/startup and first-time guide; deployment will additionally provide strong prompts for OpenCode installation and port check (non-blocking).

## Web Configuration Panel

### Access Configuration Panel

After service startup, access via browser:

```
http://localhost:4098
```

### Panel Features

- **Configuration Management**: Real-time modification of Feishu, Discord, WeCom, OpenCode, reliability and other configuration parameters
- **Cron Tasks**: Create, enable/disable, delete scheduled tasks
- **Service Status**: View uptime, version, database path
- **Model List**: Get OpenCode available models
- **Service Control**: Remote restart service
- **Platform Status**: View platform connection status

### Access Password

The access password is stored in the `ADMIN_PASSWORD` field of `.env` file:

- Random password automatically generated on first startup
- Can manually modify `.env` file to change password
- If `ADMIN_PASSWORD` is empty, no password required for access

### Configuration Storage

Configuration parameters are stored in SQLite database:

- Database path: `data/config.db`
- Automatically migrated from `.env` on first startup
- Original `.env` backed up to `.env.backup`

## Linux Resident (systemd)

The management menu provides the following operations:

- Install and start systemd service
- Stop and disable systemd service
- Uninstall systemd service
- View running status

Logs default to `logs/service.log` and `logs/service.err`.

## npm CLI Installation (More Suitable for Local Resident Operation)

```bash
npm install -g opencode-bridge
opencode-bridge
```

**Notes**:
- npm package mainly provides CLI distribution and version management convenience, does not replace OpenCode local service and Feishu/Discord/WeCom configuration.
- After running, complete business configuration through Web configuration panel (`http://localhost:4098`).
- CLI defaults to reading `.env` from current working directory; if no `.env` in current directory, automatically falls back to `~/.config/opencode-bridge/.env`.
- You can also explicitly specify config directory: `opencode-bridge --config-dir /path/to/config`.
- If you prefer source code deployment, continuing to use `scripts/deploy.*` / `scripts/start.*` from the repository is perfectly fine.

## npm CLI Configuration

```bash
mkdir -p ~/.config/opencode-bridge

# If installed globally via npm:
cp "$(npm root -g)/opencode-bridge/.env.example" ~/.config/opencode-bridge/.env

# If running from source repository:
# cp .env.example ~/.config/opencode-bridge/.env

# Start directly with default config directory
opencode-bridge

# After startup, visit http://localhost:4098 to access configuration panel

# Or place independent .env in current directory
mkdir -p ~/opencode-bridge-prod
cp .env.example ~/opencode-bridge-prod/.env
cd ~/opencode-bridge-prod
opencode-bridge

# Or explicitly specify config directory
opencode-bridge --config-dir ~/.config/opencode-bridge
```

## Configuration File Notes

### .env File (Startup Parameters)

After v2.9.3-beta, `.env` file only stores Admin panel startup parameters:

```dotenv
# Admin panel port (default 4098)
ADMIN_PORT=4098

# Admin panel access password (empty means no password required)
ADMIN_PASSWORD=your-admin-password
```

### SQLite Database (Business Configuration)

All business configurations are stored in SQLite database:

- **Database Path**: `data/config.db`
- **First Migration**: Business configuration automatically migrated from `.env` on startup
- **Backup Location**: Original `.env` backed up to `.env.backup`

### Configuration Modification Methods

| Method | Description |
|---|---|
| Web Panel | Visit `http://localhost:4098` for visual modification |
| SQLite Tool | Directly edit `data/config.db` database |
| Config File | Configure in `.env` before first startup (will auto-migrate) |

## Platform Configuration

### Feishu Configuration

See [Feishu Configuration Document](feishu-config-en.md).

### Discord Configuration

See [Discord Configuration Document](discord-config-en.md).

### WeCom Configuration

See [WeCom Configuration Document](wecom-config-en.md).

## Reliability Configuration

See [Reliability Guide](reliability-en.md).

## Troubleshooting

See [Troubleshooting Document](troubleshooting-en.md).

### Common Issues

| Issue | Solution |
|---|---|
| Service cannot start | Check port occupation, view `logs/service.err` |
| Web panel inaccessible | Check firewall settings, confirm `ADMIN_PORT` configuration |
| Platform not responding | Check platform configuration, view service logs |
| OpenCode connection failed | Check `OPENCODE_HOST` and `OPENCODE_PORT` configuration |

# Working Directory and Project Strategy Guide

**Version**: v2.9.57
**Last Updated**: 2026-03-23

---

## 1. Design Goals

| Goal | Description |
|------|-------------|
| **Secure directory selection** | Allow users to securely select working directories from chat interface |
| **Cross-platform consistency** | Maintain consistent behavior across all platforms |
| **Prevent instance mismatch** | Avoid "task stuck after directory switch" issues |

---

## 2. Directory Priority

When creating or switching sessions, directory sources are resolved in this priority:

```
1. Explicit input (command argument / card input)
          ↓
2. Project aliases (PROJECT_ALIASES)
          ↓
3. Group default (session-bound storage)
          ↓
4. Global default (DEFAULT_WORK_DIRECTORY)
          ↓
5. OpenCode server default
```

**Implementation**: `src/utils/directory-policy.ts`

---

## 3. Security Rules

### Validation Pipeline

Directory decisions go through a complete validation pipeline:

| Stage | Check |
|-------|-------|
| 1 | Path format and length checks |
| 2 | Dangerous path interception |
| 3 | Whitelist checks (`ALLOWED_DIRECTORIES`) |
| 4 | Existence and accessibility checks |
| 5 | realpath resolution and secondary whitelist check |
| 6 | Git root normalization and re-validation |

### Security Defaults

| Default | Description |
|---------|-------------|
| Generic error messages | Users see sanitized messages; full paths only in server logs |
| Whitelist required | Unconfigured `ALLOWED_DIRECTORIES` blocks custom paths |

---

## 4. Directory Sources for /create_chat

The "working project (optional)" dropdown in Feishu private chat `create_chat` panel combines:

| Source | Description |
|--------|-------------|
| `DEFAULT_WORK_DIRECTORY` | Global default directory |
| `ALLOWED_DIRECTORIES` | Whitelisted directories |
| Existing session directories | Historical and bound sessions |
| `PROJECT_ALIASES` | Project alias mappings |

**Note**: Even without historical projects, the dropdown retains a "follow default project" option.

---

## 5. Platform Command Entry Points

### Feishu

| Command | Description |
|---------|-------------|
| `/project list` | List available projects |
| `/project default` | View current group default |
| `/project default set <path\|alias>` | Set group default |
| `/project default clear` | Clear group default |
| `/session new <path\|alias>` | Create session with directory |
| `/create_chat` | Card-based session/directory selection |

### Discord

| Command | Description |
|---------|-------------|
| `///workdir` | View current working directory |
| `///workdir <path\|alias>` | Set working directory |
| `///workdir clear` | Clear working directory |
| `///new [name] [--dir path\|alias]` | Create session with directory |
| `///new-channel [name] [--dir path\|alias]` | Create channel with directory |
| `///create_chat` | Dropdown session control |

---

## 6. Environment Variables

### Minimum Recommended Configuration

```env
ALLOWED_DIRECTORIES=/path/to/projects,/path/to/repos
DEFAULT_WORK_DIRECTORY=/path/to/projects/default
PROJECT_ALIASES={"bridge":"/path/to/opencode-bridge"}
GIT_ROOT_NORMALIZATION=true
```

### Configuration Notes

| Variable | Note |
|----------|------|
| `ALLOWED_DIRECTORIES` | Unconfigured restricts user custom path capability |
| `PROJECT_ALIASES` | Should only contain commonly used projects to avoid dropdown clutter |
| `GIT_ROOT_NORMALIZATION` | Paths are validated against whitelist after normalization |

---

## 7. Permission and Directory Consistency

Permission responses include directory candidates to reduce deadlocks:

| Priority | Source |
|----------|--------|
| 1 | Current session directory (`resolvedDirectory/defaultDirectory`) |
| 2 | Known directory list |
| 3 | Default directory instance |

This reduces "permission allowed but task stuck" issues after directory switches.

---

## 8. Common Issues

### Q: Why is my directory not allowed?

| Check | Action |
|-------|--------|
| Whitelist | Verify path is within `ALLOWED_DIRECTORIES` |
| Symlinks | Check realpath-resolved path is still within whitelist |

### Q: Why can't I see historical projects in /create_chat?

| Check | Action |
|-------|--------|
| Whitelist filter | Directory may be filtered by whitelist |
| Existence | Non-existent or unreadable directories are automatically excluded |

### Q: Directory switched but permission "allowed" yet task didn't continue?

| Check | Action |
|-------|--------|
| Logs | Check if permission response hit directory candidates |
| Instance match | Confirm OpenCode instance matches current session directory |

---

## 9. Maintenance Recommendations

| Recommendation | Description |
|----------------|-------------|
| **Tests required** | Directory changes must include tests (policy + panel options + permission response) |
| **Pre-release check** | Run `npm run build` and `npm test` before release |
| **Documentation sync** | Update `.env.example` and README environment variable sections |

---

## 10. Related Documentation

- [Implementation Details](implementation-en.md) - Directory policy implementation
- [Configuration Center](environment-en.md) - Directory-related configuration
- [Commands Reference](commands-en.md) - Directory-related commands

# Gray Deployment and Rollback SOP

**Version**: v2.9.57
**Last Updated**: 2026-03-23

---

## 1. Overview

This document describes the gray deployment and rollback procedures for router mode upgrades (v2.9.1+).

---

## 2. Router Mode Configuration

### Mode Comparison

| Mode | Description | Use Case | Risk |
|------|-------------|----------|------|
| `legacy` | Legacy direct routing | Default, stable production | 🟢 Low |
| `dual` | Dual-track (log comparison) | Gray testing phase | 🟡 Medium |
| `router` | New root router | Full deployment after validation | 🟢 Low |

### Configuration

```bash
# Temporary (command line)
ROUTER_MODE=legacy node scripts/start.mjs
ROUTER_MODE=dual node scripts/start.mjs
ROUTER_MODE=router node scripts/start.mjs

# Permanent (.env file)
echo "ROUTER_MODE=dual" >> .env
```

### Startup Logs

**Legacy Mode:**
```
[Config] Router mode: legacy
```

**Dual Mode:**
```
[Config] Router mode: dual
[Config] ⚠️ Dual-track mode: Will record new/old router comparison logs
[Config] 📝 To rollback to legacy router, set ROUTER_MODE=legacy and restart
```

**Router Mode:**
```
[Config] Router mode: router
```

---

## 3. Gray Release Flow

### Three-Phase Verification

```
Legacy Mode → Dual Mode → Router Mode → Full Deployment
              ↓              ↓
           Observe 24h    No Issues
```

### Phase 1: Legacy Verification

| Item | Description |
|------|-------------|
| **Configuration** | `ROUTER_MODE=legacy` |
| **Verification** | Basic message flow, permission flow, card flow |
| **Pass Criteria** | 53 unit tests 100% pass |

### Phase 2: Dual Verification

| Item | Description |
|------|-------------|
| **Configuration** | `ROUTER_MODE=dual` |
| **Verification** | Dual-track log comparison, behavior consistency |
| **Key Logs** | `type: "[Router][dual]"` field completeness |
| **Observation Time** | ≥ 24 hours |

### Phase 3: Router Verification

| Item | Description |
|------|-------------|
| **Configuration** | `ROUTER_MODE=router` |
| **Verification** | New router event distribution, functional equivalence |
| **Pass Criteria** | Behavior consistent with legacy mode |

---

## 4. Verification Suite

### Functional Verification

- [ ] Private chat message send/receive
- [ ] Group chat message send/receive
- [ ] Permission card confirmation
- [ ] Question card handling
- [ ] Message recall sync
- [ ] Session binding migration

### Performance Verification

- [ ] Message latency < 500ms
- [ ] Error rate < 0.1%
- [ ] Card.update success rate > 99%

### Log Verification

- [ ] Dual-track log fields complete
- [ ] No abnormal error output

---

## 5. Rollback SOP

### Trigger Conditions

Execute rollback immediately when any of the following occurs:

| Condition | Level | Description |
|-----------|-------|-------------|
| Message latency > 2s | P0 | Seriously affects user experience |
| Error rate > 5% | P0 | System abnormal rate too high |
| Permission/question card失效 | P0 | Severe functional degradation |
| Session binding failure rate > 10% | P1 | Affects multi-session management |

### Rollback Steps

```bash
# 1. Stop service
node scripts/stop.mjs

# 2. Set rollback mode
echo "ROUTER_MODE=legacy" > .env

# 3. Restart service
node scripts/start.mjs

# 4. Verify rollback success
grep "Router mode" logs/service.log
# Expected: [Config] Router mode: legacy
```

### Post-Rollback Retest

Must verify after rollback:

- [ ] Normal message send/receive
- [ ] Permission cards display correctly
- [ ] Question cards handled correctly
- [ ] Recall operation sync
- [ ] Session binding function normal

---

## 6. Log Diagnosis

### Dual-Track Log Format (dual mode)

```json
{
  "type": "[Router][dual]",
  "event": "onMessage",
  "platform": "feishu",
  "conversationKey": "feishu:chat_id_xxx",
  "sessionId": "session_id_xxx",
  "routeDecision": "group",
  "chatType": "group",
  "chatId": "chat_id_xxx"
}
```

### Field Descriptions

| Field | Description |
|-------|-------------|
| `conversationKey` | Session key (format: `{platform}:{chatId}`) |
| `sessionId` | OpenCode session ID |
| `routeDecision` | Routing decision (p2p/group/card_action/opencode_event) |

### Diagnostic Commands

```bash
# Check router mode
grep "Router mode" logs/service.log

# Check dual-track logs (dual mode)
grep "\[Router\]\[dual\]" logs/service.log

# Check error logs
tail -n 100 logs/service.err | grep -i error
```

---

## 7. Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `ROUTER_MODE` | `legacy` | Router mode: `legacy` \| `dual` \| `router` |
| `ENABLED_PLATFORMS` | `*` | Enabled platform list (comma-separated) |

**Note**: `ROUTER_MODE` only accepts three values: `legacy`, `dual`, `router`. Other values fallback to `legacy`.

---

## 8. Related Documentation

| Document | Description |
|----------|-------------|
| `.sisyphus/evidence/task-16-rollout-gate.txt` | Three-phase verification evidence |
| `.sisyphus/evidence/task-16-fallback-recovery.txt` | Detailed rollback SOP |
| `src/config.ts` | Router mode configuration implementation |
| `src/router/root-router.ts` | Root router implementation |
| [Deployment Guide](deployment-en.md) | Service deployment and operations |

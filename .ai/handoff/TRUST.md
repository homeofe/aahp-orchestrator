# aahp-orchestrator: Trust Register

> Tracks verification status of critical system properties.
> In multi-agent pipelines, hallucinations and drift are real risks.
> Every claim here has a confidence level tied to how it was verified.

---

## Confidence Levels

| Level | Meaning |
|-------|---------|
| **verified** | An agent executed code, ran tests, or observed output to confirm this |
| **assumed** | Derived from docs, config files, or chat, not directly tested |
| **untested** | Status unknown; needs verification |

---

## Build System

| Property | Status | Last Verified | Agent | Notes |
|----------|--------|---------------|-------|-------|
| `npm run compile` passes | assumed | 2026-02-27 | Copilot | .vsix v0.2.0 exists, implies compile worked |
| `npm run lint` passes | untested | - | - | |
| Extension activates in VS Code | untested | - | - | |
| `vsce package` produces valid .vsix | verified | 2026-02-27 | Human | aahp-orchestrator-0.2.0.vsix exists |

---

## Extension Functionality

| Property | Status | Last Verified | Agent | Notes |
|----------|--------|---------------|-------|-------|
| `@aahp /status` responds | untested | - | - | |
| `@aahp /tasks` lists tasks | untested | - | - | |
| `@aahp /next` recommends task | untested | - | - | |
| Context injected into Copilot chat | untested | - | - | |
| Sidebar webview loads | untested | - | - | |
| Status bar shows phase | untested | - | - | |
| Multi-root scan works | untested | - | - | `aahp.developmentRoot` mode |
| Agent spawner launches Claude | untested | - | - | |
| Agent spawner launches Copilot | untested | - | - | |

---

## Configuration

| Property | Status | Last Verified | Agent | Notes |
|----------|--------|---------------|-------|-------|
| `aahp.developmentRoot` setting exists | verified | 2026-02-27 | Copilot | In package.json contributes.configuration |
| `aahp.agentBackend` setting exists | verified | 2026-02-27 | Copilot | auto/claude/copilot options |
| `aahp.agentConcurrencyLimit` exists | verified | 2026-02-27 | Copilot | In package.json |

---

## Security

| Property | Status | Last Verified | Agent | Notes |
|----------|--------|---------------|-------|-------|
| No secrets in source | assumed | - | - | .aiignore patterns enforced |
| Webview CSP configured | untested | - | - | |
| No external network calls in extension | untested | - | - | |
| .aiignore blocks PII from handoff reads | assumed | - | - | Pattern file exists |

---

## Update Rules (for agents)

- Change `untested` to `verified` only after **running actual code/tests**
- Change `assumed` to `verified` after direct confirmation
- Never downgrade `verified` without explaining why in `LOG.md`
- Add new rows when new system properties become critical

---

*Trust degrades over time. Re-verify periodically, especially after major refactors.*

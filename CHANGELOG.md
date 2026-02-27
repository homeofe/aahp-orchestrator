# Changelog

All notable changes to the **AAHP Orchestrator** VS Code extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned

- Aggregated all-repos open task view in sidebar (T-005)
- Task creation from dashboard (T-006)
- Agent retry on failure with exponential backoff (T-007)
- GitHub release workflow, tag-triggered (T-008)
- Unit tests for chat-participant and context-injector (T-009)
- Integration tests with VS Code extension host (T-010)
- Dashboard task filtering and sorting (T-011)
- Publish to VS Code Marketplace (T-003)

## [0.2.0] - 2026-02-27

### Added

- AAHP v3 handoff protocol structure (`.ai/handoff/` with MANIFEST.json, STATUS.md,
  NEXT_ACTIONS.md, LOG.md, DASHBOARD.md, TRUST.md, CONVENTIONS.md, WORKFLOW.md)
- GitHub Actions CI pipeline - compile, lint, and test on push/PR to main
- 72 unit tests with Vitest across 5 suites (aahp-reader, agent-spawner,
  session-monitor, statusbar, security)
- Redesigned sidebar dashboard with multi-repo overview and card-based UI
- Comprehensive task audit with 8 new development tasks (T-004 through T-011)

### Fixed

- Replaced inline `onclick`/`onchange` handlers with event delegation for CSP compliance
- Run-all-agents button now correctly launches agent processes

### Changed

- Dashboard synced with MANIFEST.json task state for consistency

## [0.1.0] - 2026-02-27

### Added

- Initial release of the AAHP Orchestrator VS Code extension
- AAHP file reader (`aahp-reader.ts`) - reads `.ai/handoff/` manifest and context files
- Context injector (`context-injector.ts`) - prepends AAHP context to Copilot and
  Claude Code prompts
- Chat participant (`@aahp`) with slash commands: `/help`, `/status`, `/tasks`,
  `/next`, `/context`, `/phase`, `/done`
- Sidebar webview dashboard (`aahp.dashboard`) with activity bar icon
- Status bar integration showing current AAHP phase and task count
- `developmentRoot` setting and smart one-time prompt for multi-repo workspaces
- Smart AAHP manifest discovery - walk up from active file, scan subdirectories
- Dual-backend agent spawner supporting both Claude Code CLI and GitHub Copilot LM API
- Token tracking for agent sessions
- Concurrency limiter with configurable `agentConcurrencyLimit` setting
- Session monitor wired into extension activation and commands
- Commands: Update Manifest Checksums, Commit Session, Set Phase, Open Dashboard,
  Copy Context to Clipboard, Run All Agents, Run Agent for Current Repo,
  Focus Repo in Dashboard, Set Task Status
- Keyboard shortcuts: `Ctrl+Alt+A` (copy context), `Ctrl+Alt+D` (open dashboard),
  `Ctrl+Alt+R` (run all agents), `Ctrl+Alt+S` (run single repo)
- `.aiignore` support for excluding sensitive files from handoff context

### Fixed

- Removed SVG icon (unsupported by vsce), restored engines/repository fields
- Resolved 5 critical security issues and 7 bugs in agent spawner
- Replaced all synchronous blocking calls with async for true parallelism
- Windows compatibility: `shell: true` for spawning .cmd files
- Nested Claude CLI sessions: unset `CLAUDECODE` env var before spawn

### Changed

- Removed em dashes from all source files and documentation (style convention)

[unreleased]: https://github.com/homeofe/aahp-orchestrator/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/homeofe/aahp-orchestrator/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/homeofe/aahp-orchestrator/releases/tag/v0.1.0

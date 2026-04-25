# Changelog

All notable changes to the **AAHP Orchestrator** VS Code extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned

- Unit tests for chat-participant and context-injector (T-009)
- Integration tests with VS Code extension host (T-010)
- Dashboard task filtering and sorting (T-011)

## [0.3.6] - 2026-04-25

### Changed

- Updated README: VS Code badge/requirement ^1.90 -> ^1.116, license MIT -> Apache-2.0
- Updated README: `aahp.agentBackend` setting documents all 6 backends (auto/claude/gemini/codex/copilot/sdk)
- Updated README: Requirements section lists all agent CLI install options
- Updated README: Toolchain table mentions Gemini/Codex/Copilot backends in aahp-runner description
- Updated README: .vsix install example uses current version

## [0.3.5] - 2026-04-25

### Fixed

- Bumped `engines.vscode` from `^1.90.0` to `^1.116.0` to match `@types/vscode ^1.116.0`
  (CI was failing with "engines.vscode must be >= @types/vscode version")
- Bumped `postcss` transitive dep to 8.5.10 via lockfile update (#31)

## [0.3.4] - 2026-04-25

### Fixed

- `aahp.agentBackend` description for `claude`: removed incorrect "requires VS Code extension" -
  Claude Code is a standalone CLI: `npm install -g @anthropic-ai/claude-code`

## [0.3.3] - 2026-04-25

### Changed

- Bumped `typescript` to 6.0.3
- Bumped `@types/node` to 25.6.0
- Bumped `@vscode/vsce` to 3.9.1
- Expanded `aahp.agentBackend` setting: added `gemini`, `codex`, and `sdk` options
  to match the new backends available in aahp-runner >= 0.2.4

## [0.3.2] - 2026-04-14

### Changed

- Bumped `typescript` to 6.0.2 (major upgrade from 5.9.3)
- Added `"types": ["node"]` to `tsconfig.json` - required for TypeScript 6 which no
  longer auto-includes `@types/node`; harmless on TypeScript 5

## [0.3.1] - 2026-04-14

### Security

- Bumped `lodash` to 4.18.1 - fixes prototype pollution via array path bypass
  (medium) and code injection via `_.template` imports key names (high)
- Bumped `vite` to 8.0.5 - fixes path traversal in optimized deps `.map` handling
  (medium), arbitrary file read via dev server WebSocket (high), and
  `server.fs.deny` bypass with queries (high)
- Added `overrides.serialize-javascript` to 7.0.5 - fixes CPU exhaustion DoS via
  crafted array-like objects (medium) and RCE via `RegExp.flags` and
  `Date.prototype.toISOString()` (high)
- Added `overrides.diff` to 8.0.4 - fixes jsdiff DoS vulnerability in `parsePatch`
  and `applyPatch` (low)
- Applied `npm audit fix` to resolve transitive `brace-expansion` moderate severity
  vulnerability - result: 0 vulnerabilities

### Changed

- Bumped `eslint` to 10.2.0
- Bumped `typescript-eslint` to 8.58.0
- Bumped `@types/node` to 25.5.2
- Bumped `vitest` to 4.1.2

## [0.3.0] - 2026-02-28

### Added

- GitHub release workflow - tag-triggered CI/CD that builds .vsix, creates GitHub
  Release with asset, extracts CHANGELOG notes, and optionally publishes to
  VS Code Marketplace when VSCE_PAT secret is set (T-008)
- VS Code Marketplace publishing support with extension icon, gallery metadata,
  and `npm run publish` script (T-003)
- Aggregated all-repos open task view in sidebar (T-005)
- Task creation from dashboard with title, priority, and depends_on (T-006)
- Agent retry on failure with configurable exponential backoff (T-007)
- Extension icon (128x128 robot) for Marketplace listing
- `homepage` and `bugs` URLs in package.json
- `Chat` category for Marketplace discoverability

### Changed

- Updated CHANGELOG to reflect all completed work since v0.2.0
- LICENSE copyright holder corrected to elvatis

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

[unreleased]: https://github.com/homeofe/aahp-orchestrator/compare/v0.3.2...HEAD
[0.3.2]: https://github.com/homeofe/aahp-orchestrator/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/homeofe/aahp-orchestrator/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/homeofe/aahp-orchestrator/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/homeofe/aahp-orchestrator/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/homeofe/aahp-orchestrator/releases/tag/v0.1.0

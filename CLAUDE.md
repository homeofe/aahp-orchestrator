# CLAUDE.md - aahp-orchestrator

VS Code extension (v0.3.0) that injects AAHP context into GitHub Copilot and Claude Code.
Publisher: `elvatis` | Repo: `homeofe/aahp-orchestrator`

## Quick Start

```bash
npm run compile        # TypeScript compile (must pass before every commit)
npm run lint           # ESLint (must pass before every commit)
npm run test           # Vitest unit tests (248 tests, 14 suites)
npm run test:integration  # VS Code extension host tests (26 tests, 5 suites, needs xvfb on Linux)
npm run package        # Build .vsix with vsce
npm run publish        # Publish to Marketplace (requires VSCE_PAT)
```

## Project Structure

```
src/
  extension.ts          - Activation/deactivation lifecycle (onStartupFinished)
  aahp-reader.ts        - Reads .ai/handoff/ files, builds system prompts
  agent-spawner.ts      - Scans repos, picks backend, builds agent prompts
  session-monitor.ts    - Session state, queue, and notifications
  chat-participant.ts   - @aahp slash commands (help/status/tasks/next/done/phase)
  context-injector.ts   - Prepends AAHP context to AI prompts
  commands.ts           - VS Code command palette entries
  sidebar.ts            - Activity bar webview (All Open Tasks tree view)
  statusbar.ts          - Status bar item
  webview/              - Webview HTML/CSS (must pass CSP validation)
src/test/               - Vitest unit tests
src/test/integration/   - @vscode/test-electron integration tests
.ai/handoff/            - AAHP protocol files (MANIFEST.json, STATUS.md, etc.)
```

## AAHP Handoff

Task tracking lives in `.ai/handoff/MANIFEST.json`. Always read it at the start of a session.
Handoff docs: `STATUS.md`, `CONVENTIONS.md`, `WORKFLOW.md`, `LOG.md`, `NEXT_ACTIONS.md`.

When completing a task, update its status in `MANIFEST.json` to `"done"` with a `"completed"` timestamp.

## Code Conventions

- **TypeScript 5.5+ strict mode** - no implicit any, `exactOptionalPropertyTypes`
- **Prettier**: no semicolons, single quotes, trailing commas, 100 char width
- **No em dashes** - use a regular hyphen (`-`) instead
- All code and comments in **English only**
- VS Code API calls must use `vscode.*` namespace - wrap all calls in try/catch
- Webview HTML must use `getNonce()` for CSP - no inline scripts, no external resources
- New commands must be registered in both `package.json#contributes.commands` and `src/commands.ts`

## Architecture Principles

- **Read-only by default** - extension reads `.ai/handoff/`, never writes without explicit user action
- **Activation**: `onStartupFinished` only - no eager activation
- **Workspace isolation**: multi-root via `aahp.developmentRoot` - one extension, many repos
- **No PII in handoff** - `.aiignore` patterns enforced before any handoff file is read or injected
- **Context injection not replacement** - AAHP context prepends to prompts, never overrides user input

## Branching & Commits

```
feat/<scope>-<name>    - new feature
fix/<scope>-<name>     - bug fix
docs/<scope>-<name>    - documentation only

Commit: feat(scope): description [AAHP-auto]
```

Do not push directly to `main`. Use feature branches and PRs.

## What Agents Must NOT Do

- Push directly to `main`
- Mutate `.ai/handoff/` files without user confirmation
- Add npm dependencies without documenting the reason in `LOG.md`
- Write secrets or credentials into source files
- Delete existing tests (fix or replace instead)
- Use em dashes anywhere
- Call `vscode.workspace.fs.writeFile` outside `.ai/handoff/` without explicit user command
- Publish to VS Code Marketplace without human approval

## Publishing

Set `VSCE_PAT` secret in GitHub Actions, then either:
- Run `npm run publish` locally (with `VSCE_PAT` env var set)
- Push a `v*` tag to trigger the release workflow (`.github/workflows/release.yml`)

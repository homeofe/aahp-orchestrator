# aahp-orchestrator: Agent Conventions

> Every agent working on this project must read and follow these conventions.
> Update this file whenever a new standard is established.

---

## The Three Laws (Our Motto)

> **First Law:** A robot may not injure a human being or, through inaction, allow a human being to come to harm.
>
> **Second Law:** A robot must obey the orders given it by human beings except where such orders would conflict with the First Law.
>
> **Third Law:** A robot must protect its own existence as long as such protection does not conflict with the First or Second Laws.
>
> *- Isaac Asimov*

We are human beings and will remain human beings. Tasks are delegated to AI only when we choose to delegate them. **Do no damage** is the highest rule. Agents must never take autonomous action that could harm data, systems, or people.

---

## Language

- All code, comments, commits, and documentation in **English only**
- i18n/translation keys in camelCase English

## Code Style

- **TypeScript 5.5+**: strict mode, no implicit any, `exactOptionalPropertyTypes`
- **Prettier**: no semicolons, single quotes, trailing commas, 100 char width
- VS Code extension APIs must use `vscode.*` namespace - no direct Node.js IO on the main thread
- Webview HTML/CSS lives in `src/webview/` and must pass CSP validation
- All user-facing strings in `package.json` `contributes.*` for i18n readiness

## Branching & Commits

```
feat/<scope>-<short-name>    - new feature
fix/<scope>-<short-name>     - bug fix
docs/<scope>-<name>          - documentation only
refactor/<scope>-<name>      - no behaviour change

Commit format:
  feat(scope): add description [AAHP-auto]
  fix(scope): resolve issue [AAHP-auto]
```

## Architecture Principles

- **Read-only by default**: extension reads `.ai/handoff/` files, never writes without explicit user action
- **Human-in-the-Loop**: agents propose, humans approve - no silent file mutations
- **Context injection not replacement**: AAHP context is prepended to Copilot/Claude prompts, never overrides user input
- **Workspace isolation**: multi-root support via `aahp.developmentRoot` - one extension instance, many repos
- **No PII in handoff**: `.aiignore` patterns enforced before any handoff file is read or injected

## VS Code Extension Specifics

- Activation event: `onStartupFinished` only - no eager activation
- Commands must be registered in both `package.json#contributes.commands` and `src/commands.ts`
- Chat participant (`@aahp`) must handle errors gracefully - never throw to VS Code's error reporter
- Webview must use `getNonce()` for CSP and never load external resources
- `aahp.developmentRoot` mode: scan subdirectories, switch context on active file change

## Testing

- `npm run compile` must pass before every commit
- `npm run lint` must pass (ESLint with TypeScript rules)
- Manual smoke test: activate extension, open a repo with `.ai/handoff/`, verify `@aahp /status` responds

## Formatting

- **No em dashes (`-`)**: Never use Unicode em dashes in any file. Use a regular hyphen (`-`) instead.

## What Agents Must NOT Do

- **Violate the Three Laws** - never cause damage to data, systems, or people; never act beyond delegated scope
- Push directly to `main`
- Mutate `.ai/handoff/` files without user confirmation
- Add new npm dependencies without documenting the reason in LOG.md
- Write secrets or credentials into source files
- Delete existing tests (fix or replace instead)
- Use em dashes (`-`) anywhere in the codebase
- Call `vscode.workspace.fs.writeFile` on files outside `.ai/handoff/` without explicit user command

---

*This file is maintained by agents and humans together. Update it when conventions evolve.*

---

## 🚨 Release-Regel: Erst fertig, dann publishen (gilt für ALLE Plattformen)

**IMMER erst alles fertigstellen, danach publishen. Kein einziger Commit mehr dazwischen.**
Gilt für GitHub, npm, ClawHub, PyPI — egal ob ein Projekt auf einer oder mehreren Plattformen ist.
Sonst divergieren die Tarballs/Releases zwangsläufig.

### Reihenfolge (nie abweichen)
1. Alle Änderungen + Versionsbumps in **einem einzigen Commit** abschließen
2. `git push` → Plattform 1 (z.B. GitHub)
3. `npm publish` / `clawhub publish` / etc. — alle weiteren Plattformen
4. Kein weiterer Commit bis zum nächsten Release (außer reine interne Doku)

### Vor jedem Release: Alle Versionsstellen prüfen
```bash
grep -rn "X\.Y\.Z\|Current version\|Version:" \
  --include="*.md" --include="*.json" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git
```
Typische vergessene Stellen: `README.md` Header, `SKILL.md` Footer, `package.json`,
`openclaw.plugin.json`, `.ai/handoff/STATUS.md` (Header + Plattform-Zeilen), Changelog-Eintrag.

### Secrets & private Pfade — NIEMALS in Repos
- Keine API Keys, Tokens, Passwörter, Secrets in Code oder Docs
- Keine absoluten lokalen Pfade (`/home/user/...`) in publizierten Dateien
- Keine `.env`-Dateien committen — immer in `.gitignore`
- Vor jedem Push: `git diff --staged` auf Secrets prüfen

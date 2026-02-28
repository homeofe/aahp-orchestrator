import * as vscode from 'vscode'
import { AahpContext, AahpTask, NextActionItem, RepoOverview, getTopTask } from './aahp-reader'
import { AgentRun, sessionTokens } from './agent-spawner'
import { ActiveSession, QueuedTask } from './session-monitor'

export class AahpDashboardProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView
  private _ctx: AahpContext | undefined
  private _agentRuns: AgentRun[] = []
  private _repoOverviews: RepoOverview[] = []
  private _focusedRepoPath: string | undefined
  private _focusedCtx: AahpContext | undefined
  private _collapsedSections: Set<string> = new Set()
  private _activeSessions: ActiveSession[] = []
  private _queuedTasks: QueuedTask[] = []

  constructor(private readonly extensionUri: vscode.Uri) {}

  public update(ctx: AahpContext | undefined): void {
    this._ctx = ctx
    this._render()
  }

  public updateAgentRuns(runs: AgentRun[]): void {
    this._agentRuns = runs
    this._render()
  }

  public updateRepoOverviews(overviews: RepoOverview[]): void {
    this._repoOverviews = overviews
    this._render()
  }

  public updateFocusedRepo(repoPath: string | undefined, ctx: AahpContext | undefined): void {
    this._focusedRepoPath = repoPath
    this._focusedCtx = ctx
    this._render()
  }

  public getFocusedRepoPath(): string | undefined {
    return this._focusedRepoPath
  }

  public updateSessionState(sessions: ActiveSession[], queue: QueuedTask[]): void {
    this._activeSessions = sessions
    this._queuedTasks = queue
    this._render()
  }

  private _render(): void {
    if (this._view) {
      this._view.webview.html = this._getHtml(this._view.webview)
    }
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView
    webviewView.webview.options = { enableScripts: true }
    webviewView.webview.html = this._getHtml(webviewView.webview)

    webviewView.webview.onDidReceiveMessage(msg => {
      switch (msg.command) {
        case 'updateManifest': vscode.commands.executeCommand('aahp.updateManifest'); break
        case 'commitSession': vscode.commands.executeCommand('aahp.commitSession'); break
        case 'setPhase': vscode.commands.executeCommand('aahp.setPhase'); break
        case 'copyContext': vscode.commands.executeCommand('aahp.copyContext'); break
        case 'runAll': vscode.commands.executeCommand('aahp.runAll'); break
        case 'focusRepo':
          vscode.commands.executeCommand('aahp.focusRepo', msg.repoPath)
          break
        case 'runSingleRepo':
          vscode.commands.executeCommand('aahp.runSingleRepo', msg.repoPath)
          break
        case 'retryAgent':
          vscode.commands.executeCommand('aahp.retryAgent', msg.repoPath, msg.taskId)
          break
        case 'toggleSection':
          if (this._collapsedSections.has(msg.section)) {
            this._collapsedSections.delete(msg.section)
          } else {
            this._collapsedSections.add(msg.section)
          }
          this._render()
          break
        case 'setTaskStatus':
          vscode.commands.executeCommand('aahp.setTaskStatus', msg.repoPath, msg.taskId, msg.status)
          break
        case 'createTask':
          vscode.commands.executeCommand('aahp.createTask', msg.repoPath)
          break
        case 'fixTask':
          vscode.commands.executeCommand('aahp.fixTask', msg.repoPath, msg.taskId)
          break
        case 'refreshNextActions':
          vscode.commands.executeCommand('aahp.refreshAll')
          break
        case 'openUrl':
          if (msg.url && typeof msg.url === 'string' && msg.url.startsWith('https://')) {
            vscode.env.openExternal(vscode.Uri.parse(msg.url))
          }
          break
      }
    })
  }

  // ── HTML Generation ──────────────────────────────────────────────────────────

  private _getHtml(_webview: vscode.Webview): string {
    const nonce = getNonce()

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
<style>${this._renderStyles()}</style>
</head>
<body>
  ${this._renderAgentControl()}
  ${this._renderRepoGrid()}
  ${this._renderNextSteps()}
  ${this._renderFocusedProject()}
  ${this._renderQuickActions()}
<script nonce="${nonce}">${this._renderScript()}</script>
</body></html>`
  }

  // ── Styles ────────────────────────────────────────────────────────────────────

  private _renderStyles(): string {
    return `
body {
  font-family: var(--vscode-font-family);
  font-size: 13px;
  color: var(--vscode-foreground);
  padding: 8px;
  margin: 0;
  line-height: 1.4;
}

/* Card */
.card {
  background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
  border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, rgba(128,128,128,0.2)));
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 6px;
  cursor: pointer;
  transition: border-color 0.15s, opacity 0.15s;
}
.card:hover {
  border-color: var(--vscode-focusBorder);
}
.card.focused {
  border-color: var(--vscode-focusBorder);
  border-width: 2px;
  padding: 7px 9px;
}

/* Section header */
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  text-transform: uppercase;
  opacity: 0.6;
  letter-spacing: 0.5px;
  margin: 14px 0 6px;
  cursor: pointer;
  user-select: none;
}
.section-header:hover { opacity: 0.9; }
.section-header .chevron { transition: transform 0.2s; display: inline-block; }
.section-header.collapsed .chevron { transform: rotate(-90deg); }

/* Repo grid */
.repo-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px;
}
@media (max-width: 300px) {
  .repo-grid { grid-template-columns: 1fr; }
}

/* Repo card mini */
.repo-card {
  padding: 6px 8px;
  font-size: 12px;
}
.repo-card .repo-name {
  font-weight: bold;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 2px;
}
.repo-card .repo-meta {
  font-size: 10px;
  opacity: 0.6;
  display: flex;
  gap: 6px;
  align-items: center;
}

/* Badge */
.badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 10px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  margin: 1px;
  white-space: nowrap;
}
.badge.phase {
  background: var(--vscode-activityBarBadge-background, var(--vscode-badge-background));
  color: var(--vscode-activityBarBadge-foreground, var(--vscode-badge-foreground));
}

/* Health dot */
.dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-right: 4px;
  flex-shrink: 0;
}
.dot-healthy { background: #4ec9b0; }
.dot-stale { background: #cca700; }
.dot-no-tasks { background: #808080; }

/* Task table */
.task-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.task-table td { padding: 3px 4px; vertical-align: top; }
.task-table tr:hover td { background: var(--vscode-list-hoverBackground); }
.task-id { font-family: var(--vscode-editor-font-family, monospace); font-size: 10px; opacity: 0.5; }
.pri-high { color: #f14c4c; }
.pri-medium { color: #cca700; }
.pri-low { color: #4ec9b0; }

/* Status select */
.status-select {
  font-size: 10px;
  background: transparent;
  border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3));
  color: var(--vscode-foreground);
  border-radius: 3px;
  padding: 0 2px;
  cursor: pointer;
}

/* Buttons */
.btn {
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: none;
  border-radius: 3px;
  transition: background 0.15s;
}
.btn:hover { background: var(--vscode-button-hoverBackground); }
.btn-primary {
  width: 100%;
  font-size: 13px;
  padding: 6px 0;
  margin-bottom: 4px;
}
.btn-secondary {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}
.btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
.actions-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 6px 0;
}

/* Agent run card */
.agent-card {
  background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
  border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));
  border-radius: 5px;
  padding: 5px 8px;
  margin-bottom: 4px;
  font-size: 12px;
}
.agent-card.st-running { border-left: 3px solid #569cd6; }
.agent-card.st-done { border-left: 3px solid #4ec9b0; }
.agent-card.st-failed { border-left: 3px solid #f14c4c; }
.agent-card.st-queued { border-left: 3px solid #808080; }
.agent-header { display: flex; align-items: center; gap: 6px; }
.agent-detail { font-size: 10px; opacity: 0.6; margin-top: 2px; }

/* Token bar */
.token-bar {
  background: var(--vscode-progressBar-background, rgba(128,128,128,0.2));
  border-radius: 3px;
  height: 6px;
  overflow: hidden;
  margin: 4px 0 2px;
}
.token-bar-inner { display: flex; height: 100%; }
.tk-claude { background: #f97316; }
.tk-copilot { background: #22c55e; }

/* Misc */
.mono { font-family: var(--vscode-editor-font-family, monospace); }
.dim { opacity: 0.5; font-size: 11px; }
.context-block {
  font-size: 12px;
  opacity: 0.8;
  line-height: 1.5;
  border-left: 2px solid var(--vscode-activityBarBadge-background, var(--vscode-focusBorder));
  padding-left: 8px;
  margin: 6px 0;
}
.empty-state {
  opacity: 0.5;
  font-size: 12px;
  padding: 8px 0;
  text-align: center;
}
h2 { font-size: 14px; margin: 0 0 4px; }

/* GitHub link */
.gh-link {
  display: inline-block;
  font-size: 9px;
  font-weight: bold;
  padding: 0 4px;
  margin-left: 4px;
  border-radius: 3px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  text-decoration: none;
  cursor: pointer;
  vertical-align: middle;
  line-height: 16px;
}
.gh-link:hover {
  background: var(--vscode-focusBorder);
  color: var(--vscode-editor-background);
}

/* Next Steps */
.ns-repo { margin-bottom: 8px; }
.ns-repo-header {
  font-weight: bold;
  font-size: 12px;
  margin-bottom: 3px;
  cursor: pointer;
}
.ns-repo-header:hover { opacity: 0.8; }
.ns-item {
  display: flex;
  align-items: baseline;
  gap: 5px;
  font-size: 12px;
  padding: 2px 0 2px 8px;
  border-left: 2px solid transparent;
}
.ns-item.ns-ready { border-left-color: #4ec9b0; }
.ns-item.ns-in_progress { border-left-color: #569cd6; }
.ns-item.ns-blocked { border-left-color: #f14c4c; }
.ns-item.ns-done { border-left-color: #808080; opacity: 0.5; }
.ns-detail {
  font-size: 10px;
  opacity: 0.5;
  padding-left: 10px;
  margin-bottom: 2px;
}
.ns-more {
  font-size: 10px;
  opacity: 0.4;
  padding-left: 10px;
  cursor: pointer;
}

/* Fix task button */
.fix-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  font-size: 9px;
  padding: 0;
  margin-left: auto;
  flex-shrink: 0;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--vscode-foreground);
  opacity: 0.4;
  cursor: pointer;
  transition: opacity 0.15s, background 0.15s;
}
.fix-btn:hover {
  opacity: 1;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}
`
  }

  // ── Section: Agent Control (top) ──────────────────────────────────────────────

  private _renderAgentControl(): string {
    const runs = this._agentRuns
    const focusedName = this._focusedRepoPath
      ? this._repoOverviews.find(r => r.repoPath === this._focusedRepoPath)?.repoName
      : undefined

    let html = `<button class="btn btn-primary" data-cmd="runAll">Run All Agents</button>`

    if (focusedName && this._focusedRepoPath) {
      html += `<button class="btn btn-primary btn-secondary" data-cmd="runSingleRepo" data-repo-path="${escHtml(this._focusedRepoPath)}">Run ${escHtml(focusedName)}</button>`
    }

    if (runs.length === 0 && this._activeSessions.length === 0 && this._queuedTasks.length === 0) {
      return html
    }

    // Agent run cards
    if (runs.length > 0) {
      const done = runs.filter(r => r.committed).length
      const running = runs.filter(r => r.status === 'running').length
      const total = runs.length

      html += `<div class="section-header" data-cmd="toggleSection" data-section="agents">
        <span>Agent Runs - ${done}/${total} done${running > 0 ? `, ${running} active` : ''}</span>
        <span class="chevron ${this._collapsedSections.has('agents') ? '' : ''}">&#9660;</span>
      </div>`

      if (!this._collapsedSections.has('agents')) {
        for (const r of runs) {
          const statusIcon: Record<string, string> = { queued: '...', running: '>>>', done: 'OK', failed: 'ERR' }
          const icon = statusIcon[r.status] ?? '?'
          const elapsed = r.startedAt
            ? r.finishedAt
              ? `${Math.round((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000)}s`
              : 'running'
            : 'queued'
          const backendLabel = r.backend === 'claude'
            ? `<span style="color:#f97316">claude</span>`
            : `<span style="color:#22c55e">copilot</span>`
          const tokStr = r.tokens.totalTokens > 0 ? ` | ${r.tokens.totalTokens.toLocaleString()}t` : ''

          const retryLabel = r.retryCount > 0 ? ` | retry ${r.retryCount}/${r.maxRetries}` : ''
          const retryBtn = r.status === 'failed'
            ? ` <button class="btn btn-secondary" style="font-size:10px;padding:1px 6px;margin-left:6px" data-cmd="retryAgent" data-repo-path="${escHtml(r.repo.repoPath)}" data-task-id="${escHtml(r.repo.taskId)}">Retry</button>`
            : ''

          html += `<div class="agent-card st-${r.status}">
            <div class="agent-header">
              <span class="mono" style="font-size:10px;opacity:.6">[${icon}]</span>
              <strong>${escHtml(r.repo.repoName)}</strong>
              ${backendLabel}${retryBtn}
            </div>
            <div class="agent-detail">${escHtml(r.repo.taskId)} - ${elapsed}${tokStr}${retryLabel}</div>
          </div>`
        }

        html += this._renderTokenBudget()
      }
    }

    // Queued tasks
    if (this._queuedTasks.length > 0) {
      html += `<div class="dim" style="margin-top:6px">Queued: ${this._queuedTasks.map(q => `${escHtml(q.repoName)}[${escHtml(q.taskId)}]`).join(', ')}</div>`
    }

    return html
  }

  // ── Token Budget ───────────────────────────────────────────────────────────────

  private _renderTokenBudget(): string {
    const tC = sessionTokens.claude
    const tP = sessionTokens.copilot
    const totalAll = tC.totalTokens + tP.totalTokens
    if (totalAll === 0) return ''

    const claudePct = Math.round(tC.totalTokens / totalAll * 100)
    const copilotPct = 100 - claudePct

    return `
      <div style="margin-top:6px;font-size:10px">
        <span style="color:#f97316">Claude ${tC.totalTokens.toLocaleString()}t</span> |
        <span style="color:#22c55e">Copilot ${tP.totalTokens.toLocaleString()}t</span>
      </div>
      <div class="token-bar">
        <div class="token-bar-inner">
          <div class="tk-claude" style="width:${claudePct}%"></div>
          <div class="tk-copilot" style="width:${copilotPct}%"></div>
        </div>
      </div>
      <div class="dim">${claudePct}% Claude | ${copilotPct}% Copilot | ${totalAll.toLocaleString()} total</div>
    `
  }

  // ── Section: Repo Grid ─────────────────────────────────────────────────────────

  private _renderRepoGrid(): string {
    const overviews = this._repoOverviews

    if (overviews.length === 0) {
      // Fall back to showing single context if available
      if (this._ctx) return ''
      return `<div class="empty-state">No AAHP repos found.<br>Set <code>aahp.rootFolderPath</code> in settings.</div>`
    }

    const isCollapsed = this._collapsedSections.has('repos')
    let html = `<div class="section-header${isCollapsed ? ' collapsed' : ''}" data-cmd="toggleSection" data-section="repos">
      <span>Repos (${overviews.length})</span>
      <span class="chevron">&#9660;</span>
    </div>`

    if (isCollapsed) return html

    html += `<div class="repo-grid">`

    for (const r of overviews) {
      const isFocused = this._focusedRepoPath === r.repoPath
      const dotClass = r.health === 'healthy' ? 'dot-healthy' : r.health === 'stale' ? 'dot-stale' : 'dot-no-tasks'
      const phase = r.manifest.last_session?.phase ?? '-'
      const readyCount = r.taskCounts.ready + r.taskCounts.inProgress
      const taskLabel = `${readyCount}/${r.taskCounts.total}`
      const timeAgo = formatTimeAgo(r.lastActivity)

      const ghLink = r.githubUrl
        ? `<a class="gh-link" data-cmd="openUrl" data-url="${escHtml(r.githubUrl)}" title="Open on GitHub">GH</a>`
        : ''

      html += `<div class="card repo-card${isFocused ? ' focused' : ''}" data-cmd="focusRepo" data-repo-path="${escHtml(r.repoPath)}">
        <div class="repo-name"><span class="dot ${dotClass}"></span>${escHtml(r.repoName)}${ghLink}</div>
        <div class="repo-meta">
          <span class="badge phase">${escHtml(phase)}</span>
          <span>${taskLabel}</span>
          <span>${escHtml(timeAgo)}</span>
        </div>
      </div>`
    }

    html += `</div>`
    return html
  }

  // ── Section: Next Steps (from NEXT_ACTIONS.md) ─────────────────────────────────

  private _renderNextSteps(): string {
    const overviews = this._repoOverviews
    if (overviews.length === 0) return ''

    // Collect actionable items (ready, in_progress, blocked) per repo
    const reposWithActions: Array<{ repo: RepoOverview; actionable: NextActionItem[] }> = []
    let totalActionable = 0

    for (const repo of overviews) {
      const actionable = repo.nextActions.filter(
        item => item.section === 'ready' || item.section === 'in_progress' || item.section === 'blocked'
      )
      if (actionable.length > 0) {
        // Sort: in_progress first, then ready, then blocked
        const sectionOrder: Record<string, number> = { in_progress: 0, ready: 1, blocked: 2 }
        const priOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }
        actionable.sort((a, b) => {
          const sa = sectionOrder[a.section] ?? 9
          const sb = sectionOrder[b.section] ?? 9
          if (sa !== sb) return sa - sb
          const pa = priOrder[a.priority ?? 'medium'] ?? 9
          const pb = priOrder[b.priority ?? 'medium'] ?? 9
          return pa - pb
        })
        reposWithActions.push({ repo, actionable })
        totalActionable += actionable.length
      }
    }

    if (totalActionable === 0) return ''

    const isCollapsed = this._collapsedSections.has('nextsteps')
    let html = `<div class="section-header${isCollapsed ? ' collapsed' : ''}" data-cmd="toggleSection" data-section="nextsteps">
      <span>Next Steps (${totalActionable})</span>
      <span style="display:flex;align-items:center;gap:4px">
        <button class="btn btn-secondary" style="font-size:9px;padding:1px 6px;text-transform:none;letter-spacing:0" data-cmd="refreshNextActions">Refresh</button>
        <span class="chevron">&#9660;</span>
      </span>
    </div>`

    if (isCollapsed) return html

    for (const { repo, actionable } of reposWithActions) {
      const nsGhLink = repo.githubUrl
        ? ` <a class="gh-link" data-cmd="openUrl" data-url="${escHtml(repo.githubUrl)}" title="Open on GitHub">GH</a>`
        : ''
      html += `<div class="ns-repo">`
      html += `<div class="ns-repo-header" data-cmd="focusRepo" data-repo-path="${escHtml(repo.repoPath)}"><span class="dot dot-${repo.health}"></span>${escHtml(repo.repoName)}${nsGhLink}</div>`

      const shown = actionable.slice(0, 3)
      const remaining = actionable.length - shown.length

      for (const item of shown) {
        const idLabel = item.taskId ? `<span class="task-id">[${escHtml(item.taskId)}]</span> ` : ''
        const priClass = item.priority === 'high' ? 'pri-high' : item.priority === 'low' ? 'pri-low' : ''
        const priLabel = item.priority ? `<span class="${priClass}" style="font-size:10px">${escHtml(item.priority)}</span>` : ''
        const fixBtn = item.taskId
          ? `<button class="fix-btn" data-cmd="fixTask" data-repo-path="${escHtml(repo.repoPath)}" data-task-id="${escHtml(item.taskId)}" title="Run agent to fix this task">&#9654;</button>`
          : ''
        const ghIssueBtn = (item.taskId && repo.githubUrl)
          ? `<a class="gh-link" data-cmd="openUrl" data-url="${escHtml(repo.githubUrl)}/issues?q=${escHtml(item.taskId)}" title="Search GitHub Issues for ${escHtml(item.taskId)}">GH</a>`
          : ''

        html += `<div class="ns-item ns-${item.section}">
          ${idLabel}<span>${escHtml(item.title)}</span>${priLabel}${ghIssueBtn}${fixBtn}
        </div>`

        if (item.detail) {
          html += `<div class="ns-detail">${escHtml(item.detail)}</div>`
        }
      }

      if (remaining > 0) {
        html += `<div class="ns-more" data-cmd="focusRepo" data-repo-path="${escHtml(repo.repoPath)}">${remaining} more...</div>`
      }

      html += `</div>`
    }

    return html
  }

  // ── Section: Focused Project ───────────────────────────────────────────────────

  private _renderFocusedProject(): string {
    // Prefer focused context from repo card click, fall back to active editor context
    const ctx = this._focusedCtx ?? this._ctx
    if (!ctx) {
      if (this._repoOverviews.length > 0) {
        return `<div class="empty-state">Click a repo card to see details</div>`
      }
      return ''
    }

    const m = ctx.manifest
    const version = m.aahp_version ?? (m as any).version ?? '?'
    const phase = m.last_session?.phase ?? ''
    const topTask = getTopTask(m)

    let html = `<div class="section-header" data-cmd="toggleSection" data-section="project">
      <span>Project</span>
      <span class="chevron${this._collapsedSections.has('project') ? '' : ''}">&#9660;</span>
    </div>`

    if (this._collapsedSections.has('project')) return html

    // Header - include GitHub link if available
    const focusedOverview = this._repoOverviews.find(r => r.repoPath === this._focusedRepoPath)
    const projectGhLink = focusedOverview?.githubUrl
      ? ` <a class="gh-link" data-cmd="openUrl" data-url="${escHtml(focusedOverview.githubUrl)}" title="Open on GitHub">GitHub</a>`
      : ''
    html += `<h2>${escHtml(m.project)}${projectGhLink}</h2>`
    html += `<span class="badge">v${escHtml(version)}</span>`
    html += `<span class="badge phase">${escHtml(phase)}</span>`
    html += `<span class="badge">${escHtml(m.last_session?.agent ?? '')}</span>`

    // Quick context
    if (m.quick_context) {
      html += `<div class="context-block">${escHtml(m.quick_context)}</div>`
    }

    // Active task highlight
    if (topTask) {
      html += `<div style="font-size:12px;padding:4px 0;margin:4px 0;background:var(--vscode-list-hoverBackground);border-radius:4px;padding:6px 8px">
        <strong class="task-id">[${escHtml(topTask[0])}]</strong> ${escHtml(topTask[1].title)}
        <span class="badge phase">${escHtml(topTask[1].status)}</span>
      </div>`
    }

    // Task table
    html += this._renderTaskTable(ctx)

    // STATUS.md summary
    if (ctx.status) {
      const statusLines = ctx.status.split('\n').slice(0, 8).join('\n')
      html += `<div class="dim" style="margin-top:8px;white-space:pre-wrap;font-size:11px;border-left:2px solid rgba(128,128,128,0.3);padding-left:6px">${escHtml(statusLines)}</div>`
    }

    // Last session
    if (m.last_session) {
      const ts = m.last_session.timestamp ? formatTimeAgo(m.last_session.timestamp) : ''
      const dur = m.last_session.duration_minutes ? `${m.last_session.duration_minutes}min` : ''
      const commit = m.last_session.commit ? m.last_session.commit.slice(0, 8) : ''
      html += `<div class="dim" style="margin-top:6px">Last: ${ts}${dur ? ` | ${dur}` : ''}${commit ? ` | <span class="mono">${escHtml(commit)}</span>` : ''}</div>`
    }

    return html
  }

  // ── Task Table ─────────────────────────────────────────────────────────────────

  private _renderTaskTable(ctx: AahpContext): string {
    const m = ctx.manifest
    if (!m.tasks || Object.keys(m.tasks).length === 0) {
      return `<div class="dim" style="margin-top:4px">No tasks</div>`
    }

    const repoPath = this._focusedRepoPath ?? ''
    const repoGhUrl = this._repoOverviews.find(r => r.repoPath === this._focusedRepoPath)?.githubUrl
    const statusIcon: Record<string, string> = {
      done: 'v', in_progress: '>>', ready: '*', blocked: 'x', pending: '~',
    }

    let html = `<table class="task-table">`

    for (const [id, t] of Object.entries(m.tasks) as Array<[string, AahpTask]>) {
      const icon = statusIcon[t.status] ?? '?'
      const priClass = t.priority === 'high' ? 'pri-high' : t.priority === 'medium' ? 'pri-medium' : 'pri-low'

      const fixBtn = t.status !== 'done'
        ? `<button class="fix-btn" data-cmd="fixTask" data-repo-path="${escHtml(repoPath)}" data-task-id="${escHtml(id)}" title="Run agent to fix this task">&#9654;</button>`
        : ''
      const ghIssueBtn = repoGhUrl
        ? `<a class="gh-link" data-cmd="openUrl" data-url="${escHtml(repoGhUrl)}/issues?q=${escHtml(id)}" title="Search GitHub Issues for ${escHtml(id)}">GH</a>`
        : ''

      html += `<tr>
        <td class="task-id">${escHtml(id)}</td>
        <td style="font-size:11px;opacity:.6;width:20px">${icon}</td>
        <td>${escHtml(t.title)}</td>
        <td><span class="${priClass}" style="font-size:10px">${escHtml(t.priority)}</span></td>
        <td>
          <select class="status-select" data-cmd="setTaskStatus" data-repo-path="${escHtml(repoPath)}" data-task-id="${escHtml(id)}">
            ${['ready', 'in_progress', 'done', 'blocked', 'pending'].map(s =>
              `<option value="${s}"${s === t.status ? ' selected' : ''}>${s}</option>`
            ).join('')}
          </select>
        </td>
        <td>${ghIssueBtn}${fixBtn}</td>
      </tr>`
    }

    html += `</table>`
    html += `<button class="btn btn-secondary" style="margin-top:6px;width:100%" data-cmd="createTask" data-repo-path="${escHtml(repoPath)}">+ New Task</button>`
    return html
  }

  // ── Section: Quick Actions ─────────────────────────────────────────────────────

  private _renderQuickActions(): string {
    return `
      <div class="section-header">
        <span>Actions</span>
      </div>
      <div class="actions-bar">
        <button class="btn btn-secondary" data-cmd="updateManifest">Checksums</button>
        <button class="btn btn-secondary" data-cmd="commitSession">Commit</button>
        <button class="btn btn-secondary" data-cmd="setPhase">Phase</button>
        <button class="btn btn-secondary" data-cmd="copyContext">Context</button>
      </div>
    `
  }

  // ── Script ─────────────────────────────────────────────────────────────────────

  private _renderScript(): string {
    return `
      const vscode = acquireVsCodeApi()
      function post(command, data) {
        vscode.postMessage(Object.assign({ command: command }, data || {}))
      }

      document.addEventListener('click', function(e) {
        var el = e.target.closest('[data-cmd]')
        if (!el || el.tagName === 'SELECT') return
        var cmd = el.dataset.cmd
        var data = {}
        if (el.dataset.repoPath) data.repoPath = el.dataset.repoPath
        if (el.dataset.section) data.section = el.dataset.section
        if (el.dataset.taskId) data.taskId = el.dataset.taskId
        if (el.dataset.url) data.url = el.dataset.url
        if (cmd === 'openUrl') { e.stopPropagation(); }
        post(cmd, data)
      })

      document.addEventListener('change', function(e) {
        var el = e.target.closest('[data-cmd]')
        if (!el) return
        post(el.dataset.cmd, {
          repoPath: el.dataset.repoPath,
          taskId: el.dataset.taskId,
          status: el.value
        })
      })
    `
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────────

function getNonce(): string {
  let text = ''
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length))
  return text
}

function escHtml(s: string): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function formatTimeAgo(isoStr: string): string {
  if (!isoStr) return 'never'
  const diff = Date.now() - new Date(isoStr).getTime()
  if (diff < 0) return 'now'
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

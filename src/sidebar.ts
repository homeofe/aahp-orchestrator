import * as vscode from 'vscode'
import { AahpContext, AahpTask, RepoOverview, getTopTask } from './aahp-reader'
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
`
  }

  // ── Section: Agent Control (top) ──────────────────────────────────────────────

  private _renderAgentControl(): string {
    const runs = this._agentRuns
    const focusedName = this._focusedRepoPath
      ? this._repoOverviews.find(r => r.repoPath === this._focusedRepoPath)?.repoName
      : undefined

    let html = `<button class="btn btn-primary" onclick="post('runAll')">Run All Agents</button>`

    if (focusedName && this._focusedRepoPath) {
      html += `<button class="btn btn-primary btn-secondary" onclick="post('runSingleRepo',{repoPath:'${escAttr(this._focusedRepoPath)}'})">Run ${escHtml(focusedName)}</button>`
    }

    if (runs.length === 0 && this._activeSessions.length === 0 && this._queuedTasks.length === 0) {
      return html
    }

    // Agent run cards
    if (runs.length > 0) {
      const done = runs.filter(r => r.committed).length
      const running = runs.filter(r => r.status === 'running').length
      const total = runs.length

      html += `<div class="section-header" onclick="post('toggleSection',{section:'agents'})">
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

          html += `<div class="agent-card st-${r.status}">
            <div class="agent-header">
              <span class="mono" style="font-size:10px;opacity:.6">[${icon}]</span>
              <strong>${escHtml(r.repo.repoName)}</strong>
              ${backendLabel}
            </div>
            <div class="agent-detail">${escHtml(r.repo.taskId)} - ${elapsed}${tokStr}</div>
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
    let html = `<div class="section-header${isCollapsed ? ' collapsed' : ''}" onclick="post('toggleSection',{section:'repos'})">
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

      html += `<div class="card repo-card${isFocused ? ' focused' : ''}" onclick="post('focusRepo',{repoPath:'${escAttr(r.repoPath)}'})">
        <div class="repo-name"><span class="dot ${dotClass}"></span>${escHtml(r.repoName)}</div>
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

    let html = `<div class="section-header" onclick="post('toggleSection',{section:'project'})">
      <span>Project</span>
      <span class="chevron${this._collapsedSections.has('project') ? '' : ''}">&#9660;</span>
    </div>`

    if (this._collapsedSections.has('project')) return html

    // Header
    html += `<h2>${escHtml(m.project)}</h2>`
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
    const statusIcon: Record<string, string> = {
      done: 'v', in_progress: '>>', ready: '*', blocked: 'x', pending: '~',
    }

    let html = `<table class="task-table">`

    for (const [id, t] of Object.entries(m.tasks) as Array<[string, AahpTask]>) {
      const icon = statusIcon[t.status] ?? '?'
      const priClass = t.priority === 'high' ? 'pri-high' : t.priority === 'medium' ? 'pri-medium' : 'pri-low'

      html += `<tr>
        <td class="task-id">${escHtml(id)}</td>
        <td style="font-size:11px;opacity:.6;width:20px">${icon}</td>
        <td>${escHtml(t.title)}</td>
        <td><span class="${priClass}" style="font-size:10px">${escHtml(t.priority)}</span></td>
        <td>
          <select class="status-select" onchange="post('setTaskStatus',{repoPath:'${escAttr(repoPath)}',taskId:'${escAttr(id)}',status:this.value})">
            ${['ready', 'in_progress', 'done', 'blocked', 'pending'].map(s =>
              `<option value="${s}"${s === t.status ? ' selected' : ''}>${s}</option>`
            ).join('')}
          </select>
        </td>
      </tr>`
    }

    html += `</table>`
    return html
  }

  // ── Section: Quick Actions ─────────────────────────────────────────────────────

  private _renderQuickActions(): string {
    return `
      <div class="section-header">
        <span>Actions</span>
      </div>
      <div class="actions-bar">
        <button class="btn btn-secondary" onclick="post('updateManifest')">Checksums</button>
        <button class="btn btn-secondary" onclick="post('commitSession')">Commit</button>
        <button class="btn btn-secondary" onclick="post('setPhase')">Phase</button>
        <button class="btn btn-secondary" onclick="post('copyContext')">Context</button>
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

function escAttr(s: string): string {
  return (s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;')
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

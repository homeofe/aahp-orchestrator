import * as vscode from 'vscode'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { AahpContext, AahpTask, NextActionItem, RepoOverview, getTopTask } from './aahp-reader'
import { AgentRun, sessionTokens } from './agent-spawner'
import { ActiveSession, QueuedTask } from './session-monitor'
import { AgentLogEntry } from './agent-log'
import { TaskFilter, DEFAULT_FILTER, filterAndSortTasks, getRepoNames } from './task-filter'

interface RunnerMetric {
  repo: string
  durationMs: number
  success: boolean
}

interface RunnerSession {
  repoPath: string
  repoName: string
}

interface CronRunResult {
  projectName: string
  success: boolean
  durationMs: number
  error?: string
}

interface CronPipelineRun {
  startedAt: string
  finishedAt: string
  totalProjects: number
  ran: number
  succeeded: number
  failed: number
  skipped: number
  results: CronRunResult[]
}

const AAHP_HOME = path.join(os.homedir(), '.aahp')
const RUNNER_METRICS_FILE = path.join(AAHP_HOME, 'metrics.jsonl')
const RUNNER_SESSIONS_FILE = path.join(AAHP_HOME, 'sessions.json')
const CRON_HISTORY_FILE = path.join(AAHP_HOME, 'cron-history.json')

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
  private _logHistory: AgentLogEntry[] = []
  private _taskFilter: TaskFilter = { ...DEFAULT_FILTER }
  private _requestRefresh?: () => void
  private _renderTimer?: ReturnType<typeof setTimeout>
  private _batchMode = false
  private _batchDepth = 0
  /** Set when endBatchUpdate() fires but _view is undefined - signals that
   *  resolveWebviewView() should do a direct render when it's finally called. */
  private _pendingPostBatchRender = false

  constructor(private readonly extensionUri: vscode.Uri) {}

  /** Suppress debounced renders during bulk state updates (e.g. activation).
   *  Call endBatchUpdate() when done to trigger a single render.
   *  Supports nesting: multiple begin/end pairs stack correctly. */
  public beginBatchUpdate(): void {
    this._batchDepth++
    this._batchMode = true
  }

  /** End batch mode and trigger one DIRECT (non-debounced) render with all
   *  accumulated state. Using a direct render (instead of the 50ms debounce)
   *  eliminates the gap where the webview would show stale/blank content.
   *  Only renders when all nested batch levels have ended (depth reaches 0). */
  public endBatchUpdate(): void {
    if (this._batchDepth > 0) this._batchDepth--
    if (this._batchDepth > 0) return   // still inside an outer batch
    this._batchMode = false
    // Direct render - bypass debounce to avoid a 50ms blank gap
    if (this._view) {
      if (this._renderTimer) {
        clearTimeout(this._renderTimer)
        delete this._renderTimer
      }
      this._pendingPostBatchRender = false  // we're rendering now, clear pending flag
      this._view.webview.html = this._getHtml(this._view.webview)
    } else {
      // View hasn't been resolved yet (sidebar not visible during activation).
      // Signal that resolveWebviewView should do a direct render when called.
      this._pendingPostBatchRender = true
    }
  }

  /** Check whether the provider is currently in batch mode (renders suppressed). */
  public isInBatchMode(): boolean {
    return this._batchMode
  }

  /** Register a callback that fires when the dashboard needs fresh data.
   *  This is called when the webview is first resolved and whenever it becomes visible,
   *  ensuring the dashboard always shows up-to-date state - even on VS Code startup. */
  public setRefreshCallback(fn: () => void): void {
    this._requestRefresh = fn
  }

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

  public updateLogHistory(entries: AgentLogEntry[]): void {
    this._logHistory = entries
    this._render()
  }

  /** Debounced render - coalesces multiple rapid state changes into a single re-render.
   *  Without this, refreshAll() triggers 3+ full HTML rebuilds in rapid succession. */
  private _render(): void {
    if (!this._view) return
    if (this._batchDepth > 0) return   // suppress renders during batch updates
    if (this._renderTimer) clearTimeout(this._renderTimer)
    this._renderTimer = setTimeout(() => {
      if (this._view) {
        this._view.webview.html = this._getHtml(this._view.webview)
      }
    }, 50)
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView
    webviewView.webview.options = { enableScripts: true }

    // Clear stale view reference when VS Code disposes the webview panel
    webviewView.onDidDispose(() => {
      delete this._view
      if (this._renderTimer) {
        clearTimeout(this._renderTimer)
        delete this._renderTimer
      }
    })

    // Request a full data refresh BEFORE rendering so the provider has current
    // state from all repos and MANIFEST.json files.  refreshAll() internally
    // uses beginBatchUpdate/endBatchUpdate, which nests correctly with any
    // outer batch (e.g. during activation).
    const wasBatch = this._batchMode
    try {
      if (this._requestRefresh) {
        this._requestRefresh()
      }
    } catch (e) {
      console.error('AAHP: Error during initial dashboard refresh', e)
    }

    // Cancel any debounced renders that slipped through.
    if (this._renderTimer) {
      clearTimeout(this._renderTimer)
      delete this._renderTimer
    }

    // During batch mode (i.e. activate() is still running), skip the sync render.
    // endBatchUpdate() will do ONE direct render with the complete state, avoiding
    // the double-render problem (sync here + debounced from endBatchUpdate) that
    // caused visible blank flashes on Windows as each HTML set generates a new
    // CSP nonce and forces a full webview reload.
    //
    // Outside batch mode (user opens sidebar after startup), the refreshAll
    // batch already rendered via its own endBatchUpdate.  But if that render
    // didn't fire (e.g. _view was undefined at the time), we need to render now.
    // Also render if endBatchUpdate() already ran but couldn't because the view
    // wasn't resolved yet (_pendingPostBatchRender flag).
    if (!wasBatch || this._pendingPostBatchRender) {
      this._pendingPostBatchRender = false
      webviewView.webview.html = this._getHtml(webviewView.webview)
    }

    // Safety net: on Windows, the webview may not reliably display the first
    // HTML set during rapid startup initialization. Schedule a deferred
    // re-render to ensure the dashboard is never blank after activation.
    setTimeout(() => {
      if (this._view && this._batchDepth === 0) {
        this._view.webview.html = this._getHtml(this._view.webview)
      }
    }, 300)

    // Re-render with fresh state whenever the sidebar becomes visible again.
    // refreshAll() (via _requestRefresh) handles its own batch mode and renders
    // atomically, so no explicit _render() call is needed afterwards.
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        try {
          if (this._requestRefresh) {
            this._requestRefresh()
          }
        } catch (e) {
          console.error('AAHP: Error during visibility-change refresh', e)
        }
      }
    })

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
        case 'runRepoAutonomous':
          vscode.commands.executeCommand('aahp.runRepoAutonomous', msg.repoPath)
          break
        case 'retryAgent':
          vscode.commands.executeCommand('aahp.retryAgent', msg.repoPath, msg.taskId)
          break
        case 'cancelAgent':
          vscode.commands.executeCommand('aahp.cancelAgent', Number(msg.runIndex))
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
        case 'setTaskFilter':
          if (msg.filterKey && msg.filterValue !== undefined) {
            const key = msg.filterKey as keyof TaskFilter
            if (key === 'status' || key === 'priority' || key === 'repo') {
              this._taskFilter[key] = msg.filterValue
            }
          }
          this._render()
          break
        case 'refreshNextActions':
          vscode.commands.executeCommand('aahp.refreshAll')
          break
        case 'openAgentHistory':
          vscode.commands.executeCommand('aahp.openAgentHistory')
          break
        case 'openLogEntry':
          vscode.commands.executeCommand('aahp.openLogEntry', msg.logId)
          break
        case 'openLatestCronLog': {
          const latestLog = getLatestCronLogPath()
          if (!latestLog) {
            vscode.window.showWarningMessage('AAHP: No cron log file found yet.')
            break
          }
          vscode.commands.executeCommand('vscode.open', vscode.Uri.file(latestLog))
          break
        }
        case 'openUrl':
          if (msg.url && typeof msg.url === 'string' && msg.url.startsWith('https://')) {
            vscode.env.openExternal(vscode.Uri.parse(msg.url))
          }
          break
        case 'createMissingIssues':
          vscode.commands.executeCommand('aahp.createMissingGitHubIssues', msg.repoPath)
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
  ${this._renderHistory()}
  ${this._renderRepoGrid()}
  ${this._renderRunnerMetrics()}
  ${this._renderCronOverview()}
  ${this._renderAggregatedTasks()}
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
.repo-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 2px;
}
.repo-title {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
.task-table td { padding: 3px 4px; vertical-align: middle; }
.task-table tr { cursor: default; }
.task-table tr:hover td { background: var(--vscode-list-hoverBackground); }
.task-table td.task-actions { white-space: nowrap; text-align: right; min-width: 50px; }
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
  display: inline-flex;
  align-items: center;
  font-size: 9px;
  font-weight: bold;
  padding: 1px 5px;
  margin-left: 4px;
  border-radius: 3px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  text-decoration: none;
  cursor: pointer;
  flex-shrink: 0;
  height: 18px;
  line-height: 18px;
}
.gh-link:hover {
  background: var(--vscode-focusBorder);
  color: var(--vscode-editor-background);
}

.run-repo-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3));
  background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.15));
  color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  cursor: pointer;
  flex-shrink: 0;
}
.run-repo-btn:hover {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

.metrics-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-bottom: 6px;
}
.metric-card {
  border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));
  border-radius: 5px;
  padding: 5px 6px;
}
.metric-label {
  font-size: 10px;
  opacity: 0.6;
}
.metric-value {
  font-size: 14px;
  font-weight: 700;
}
.metrics-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}
.metrics-table td {
  padding: 2px 4px;
}
.metrics-table tr:hover td {
  background: var(--vscode-list-hoverBackground);
}

.cron-status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 4px 0 6px;
  font-size: 11px;
}
.cron-fail-list {
  margin: 4px 0 0;
  padding-left: 16px;
  font-size: 11px;
}
.cron-fail-list li {
  margin: 2px 0;
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
  align-items: center;
  gap: 5px;
  font-size: 12px;
  padding: 2px 0 2px 8px;
  border-left: 2px solid transparent;
  cursor: default;
}
.ns-item .ns-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

/* Fix task button (play) */
.fix-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  font-size: 10px;
  padding: 0;
  margin-left: 2px;
  flex-shrink: 0;
  border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3));
  border-radius: 3px;
  background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.15));
  color: var(--vscode-foreground);
  opacity: 0.7;
  cursor: pointer;
  transition: opacity 0.15s, background 0.15s;
}
.fix-btn:hover {
  opacity: 1;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

/* Filter bar */
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
}
.filter-bar select {
  font-size: 10px;
  background: var(--vscode-dropdown-background, var(--vscode-input-background));
  border: 1px solid var(--vscode-dropdown-border, var(--vscode-widget-border, rgba(128,128,128,0.3)));
  color: var(--vscode-dropdown-foreground, var(--vscode-foreground));
  border-radius: 3px;
  padding: 2px 4px;
  cursor: pointer;
  flex: 1;
  min-width: 60px;
}
.filter-label {
  font-size: 9px;
  text-transform: uppercase;
  opacity: 0.5;
  letter-spacing: 0.3px;
  margin-bottom: 1px;
}
.filter-group {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 60px;
}
.agg-table { width: 100%; border-collapse: collapse; font-size: 11px; }
.agg-table td { padding: 2px 4px; vertical-align: middle; }
.agg-table tr:hover td { background: var(--vscode-list-hoverBackground); }
.agg-repo { font-size: 9px; opacity: 0.4; }
.agg-age { font-size: 9px; opacity: 0.4; white-space: nowrap; }

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
        for (let idx = 0; idx < runs.length; idx++) {
          const r = runs[idx]!
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
          const cancelBtn = r.status === 'running'
            ? ` <button class="btn btn-secondary" style="font-size:10px;padding:1px 6px;margin-left:6px;color:#f14c4c" data-cmd="cancelAgent" data-run-index="${idx}">Cancel</button>`
            : ''

          html += `<div class="agent-card st-${r.status}">
            <div class="agent-header">
              <span class="mono" style="font-size:10px;opacity:.6">[${icon}]</span>
              <strong>${escHtml(r.repo.repoName)}</strong>
              ${backendLabel}${cancelBtn}${retryBtn}
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

  // ── Section: History ───────────────────────────────────────────────────────────

  private _renderHistory(): string {
    if (this._logHistory.length === 0) return ''

    const isCollapsed = this._collapsedSections.has('history')
    let html = `<div class="section-header${isCollapsed ? ' collapsed' : ''}" data-cmd="toggleSection" data-section="history">
      <span>History (${this._logHistory.length})</span>
      <span style="display:flex;align-items:center;gap:4px">
        <button class="btn btn-secondary" style="font-size:9px;padding:1px 6px;text-transform:none;letter-spacing:0" data-cmd="openAgentHistory">All</button>
        <span class="chevron">&#9660;</span>
      </span>
    </div>`

    if (isCollapsed) return html

    for (const entry of this._logHistory.slice(0, 5)) {
      const statusClass = entry.committed ? 'st-done' : 'st-failed'
      const statusIcon = entry.committed ? 'OK' : 'ERR'
      const backendLabel = entry.backend === 'claude'
        ? `<span style="color:#f97316">claude</span>`
        : `<span style="color:#22c55e">copilot</span>`
      const tokStr = entry.tokens.total > 0 ? ` | ${entry.tokens.total.toLocaleString()}t` : ''

      html += `<div class="agent-card ${statusClass}" data-cmd="openLogEntry" data-log-id="${escHtml(entry.id)}" style="cursor:pointer">
        <div class="agent-header">
          <span class="mono" style="font-size:10px;opacity:.6">[${statusIcon}]</span>
          <strong>${escHtml(entry.repoName)}</strong>
          ${backendLabel}
        </div>
        <div class="agent-detail">${escHtml(entry.taskId)} - ${entry.durationSec}s${tokStr} - ${escHtml(formatTimeAgo(entry.finishedAt))}</div>
      </div>`
    }

    return html
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
      <span>Agents & Projects (${overviews.length})</span>
      <span class="chevron">&#9660;</span>
    </div>`

    if (isCollapsed) return html

    html += `<div class="repo-grid">`
    const liveSessions = readRunnerSessions()

    for (const r of overviews) {
      const isFocused = this._focusedRepoPath === r.repoPath
      const dotClass = r.health === 'healthy' ? 'dot-healthy' : r.health === 'stale' ? 'dot-stale' : 'dot-no-tasks'
      const phase = r.manifest.last_session?.phase ?? '-'
      const readyCount = r.taskCounts.ready + r.taskCounts.inProgress
      const taskLabel = `${readyCount}/${r.taskCounts.total}`
      const timeAgo = formatTimeAgo(r.lastActivity)
      const runningCount = liveSessions.filter(s => s.repoPath === r.repoPath || s.repoName === r.repoName).length

      const ghLink = r.githubUrl
        ? `<a class="gh-link" data-cmd="openUrl" data-url="${escHtml(r.githubUrl)}" title="Open on GitHub">GH</a>`
        : ''
      const runBtn = `<button class="run-repo-btn" data-cmd="runRepoAutonomous" data-repo-path="${escHtml(r.repoPath)}" title="Run aahp-runner for this project">Run</button>`

      html += `<div class="card repo-card${isFocused ? ' focused' : ''}" data-cmd="focusRepo" data-repo-path="${escHtml(r.repoPath)}">
        <div class="repo-head">
          <div class="repo-title"><span class="dot ${dotClass}"></span><span class="repo-name">${escHtml(r.repoName)}</span>${ghLink}</div>
          ${runBtn}
        </div>
        <div class="repo-meta">
          <span class="badge phase">${escHtml(phase)}</span>
          <span>${taskLabel}</span>
          ${runningCount > 0 ? `<span class="badge">${runningCount} active</span>` : ''}
          <span>${escHtml(timeAgo)}</span>
        </div>
      </div>`
    }

    html += `</div>`
    return html
  }

  private _renderRunnerMetrics(): string {
    const metrics = readRunnerMetrics(200)
    const sessions = readRunnerSessions()
    const isCollapsed = this._collapsedSections.has('runnerMetrics')

    let html = `<div class="section-header${isCollapsed ? ' collapsed' : ''}" data-cmd="toggleSection" data-section="runnerMetrics">
      <span>Metrics (${metrics.length})</span>
      <span class="chevron">&#9660;</span>
    </div>`

    if (isCollapsed) return html

    if (metrics.length === 0 && sessions.length === 0) {
      html += `<div class="empty-state">No runner telemetry yet</div>`
      return html
    }

    const successCount = metrics.filter(m => m.success).length
    const successRate = metrics.length > 0 ? Math.round((successCount / metrics.length) * 100) : 0
    const avgDuration = metrics.length > 0
      ? Math.round(metrics.reduce((sum, m) => sum + (m.durationMs || 0), 0) / metrics.length)
      : 0

    html += `<div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-label">Live Sessions</div>
        <div class="metric-value">${sessions.length}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Success Rate</div>
        <div class="metric-value">${successRate}%</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Runs (sample)</div>
        <div class="metric-value">${metrics.length}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Avg Duration</div>
        <div class="metric-value">${escHtml(formatDurationShort(avgDuration))}</div>
      </div>
    </div>`

    const byRepo: Record<string, { runs: number; successes: number; totalMs: number }> = {}
    for (const metric of metrics) {
      const repo = metric.repo || 'unknown'
      const bucket = byRepo[repo] ?? { runs: 0, successes: 0, totalMs: 0 }
      bucket.runs += 1
      if (metric.success) bucket.successes += 1
      bucket.totalMs += metric.durationMs || 0
      byRepo[repo] = bucket
    }

    const topRows = Object.entries(byRepo)
      .sort((a, b) => b[1].runs - a[1].runs)
      .slice(0, 8)

    if (topRows.length > 0) {
      html += '<table class="metrics-table">'
      for (const [repo, bucket] of topRows) {
        const repoRate = bucket.runs > 0 ? Math.round((bucket.successes / bucket.runs) * 100) : 0
        const avgMs = bucket.runs > 0 ? Math.round(bucket.totalMs / bucket.runs) : 0
        html += `<tr>
          <td>${escHtml(repo)}</td>
          <td>${bucket.runs}</td>
          <td>${repoRate}%</td>
          <td>${escHtml(formatDurationShort(avgMs))}</td>
        </tr>`
      }
      html += '</table>'
    }

    return html
  }

  private _renderCronOverview(): string {
    const latestRun = readLatestCronRun()
    const isCollapsed = this._collapsedSections.has('cron')

    let html = `<div class="section-header${isCollapsed ? ' collapsed' : ''}" data-cmd="toggleSection" data-section="cron">
      <span>Cron Overview</span>
      <span class="chevron">&#9660;</span>
    </div>`

    if (isCollapsed) return html

    if (!latestRun) {
      html += `<div class="empty-state">No aahp-cron run history found</div>`
      return html
    }

    const runDuration = Math.max(0, new Date(latestRun.finishedAt).getTime() - new Date(latestRun.startedAt).getTime())
    const ok = latestRun.failed === 0
    const failed = latestRun.results.filter(r => !r.success).slice(0, 5)

    html += `<div class="metric-card">
      <div class="cron-status">
        <span class="badge ${ok ? 'phase' : ''}">${ok ? 'OK' : 'FAILED'}</span>
        <span>${escHtml(formatTimeAgo(latestRun.finishedAt))}</span>
        <span>${escHtml(formatDurationShort(runDuration))}</span>
      </div>
      <div style="margin-bottom:6px">
        <button class="btn btn-secondary" style="font-size:10px;padding:2px 8px" data-cmd="openLatestCronLog">Open latest cron log</button>
      </div>
      <div class="dim">Projects: ${latestRun.totalProjects} | Ran: ${latestRun.ran} | Skipped: ${latestRun.skipped}</div>
      <div class="dim">Results: ${latestRun.succeeded} succeeded, ${latestRun.failed} failed</div>
      ${failed.length > 0 ? `<ul class="cron-fail-list">${failed.map(f => `<li>${escHtml(f.projectName)}${f.error ? ` - ${escHtml(f.error)}` : ''}</li>`).join('')}</ul>` : ''}
    </div>`

    return html
  }

  // ── Section: Aggregated Tasks ───────────────────────────────────────────────────

  private _renderAggregatedTasks(): string {
    const overviews = this._repoOverviews
    if (overviews.length === 0) return ''

    // Count total tasks across all repos
    const totalTasks = overviews.reduce(
      (sum, r) => sum + (r.manifest.tasks ? Object.keys(r.manifest.tasks).length : 0),
      0,
    )
    if (totalTasks === 0) return ''

    const isCollapsed = this._collapsedSections.has('allTasks')
    const tasks = filterAndSortTasks(overviews, this._taskFilter)
    const hasActiveFilter =
      this._taskFilter.status !== 'all' ||
      this._taskFilter.priority !== 'all' ||
      this._taskFilter.repo !== 'all'

    const countLabel = hasActiveFilter ? `${tasks.length}/${totalTasks}` : `${totalTasks}`

    let html = `<div class="section-header${isCollapsed ? ' collapsed' : ''}" data-cmd="toggleSection" data-section="allTasks">
      <span>All Tasks (${countLabel})</span>
      <span class="chevron">&#9660;</span>
    </div>`

    if (isCollapsed) return html

    // Filter bar
    const repoNames = getRepoNames(overviews)
    const f = this._taskFilter

    html += `<div class="filter-bar">`

    html += `<div class="filter-group">
      <span class="filter-label">Status</span>
      <select data-cmd="setTaskFilter" data-filter-key="status">
        ${['all', 'ready', 'in_progress', 'blocked', 'pending', 'done'].map(
          s => `<option value="${s}"${f.status === s ? ' selected' : ''}>${s === 'all' ? 'All' : s}</option>`,
        ).join('')}
      </select>
    </div>`

    html += `<div class="filter-group">
      <span class="filter-label">Priority</span>
      <select data-cmd="setTaskFilter" data-filter-key="priority">
        ${['all', 'high', 'medium', 'low'].map(
          p => `<option value="${p}"${f.priority === p ? ' selected' : ''}>${p === 'all' ? 'All' : p}</option>`,
        ).join('')}
      </select>
    </div>`

    if (repoNames.length > 1) {
      html += `<div class="filter-group">
        <span class="filter-label">Repo</span>
        <select data-cmd="setTaskFilter" data-filter-key="repo">
          <option value="all"${f.repo === 'all' ? ' selected' : ''}>All</option>
          ${repoNames.map(
            r => `<option value="${escHtml(r)}"${f.repo === r ? ' selected' : ''}>${escHtml(r)}</option>`,
          ).join('')}
        </select>
      </div>`
    }

    html += `</div>`

    // Task table
    if (tasks.length === 0) {
      html += `<div class="empty-state">No tasks match filters</div>`
      return html
    }

    html += `<table class="agg-table">`
    for (const ft of tasks) {
      const priClass =
        ft.task.priority === 'high' ? 'pri-high' :
        ft.task.priority === 'medium' ? 'pri-medium' : 'pri-low'
      const statusIcon: Record<string, string> = {
        done: 'v', in_progress: '>>', ready: '*', blocked: 'x', pending: '~',
      }
      const icon = statusIcon[ft.task.status] ?? '?'
      const age = ft.task.created ? formatTimeAgo(ft.task.created) : ''
      const dblAttr = ft.task.status !== 'done'
        ? ` data-dbl="fixTask" data-repo-path="${escHtml(ft.repoPath)}" data-task-id="${escHtml(ft.taskId)}"`
        : ''

      html += `<tr${dblAttr}>
        <td style="font-size:11px;opacity:.6;width:16px">${icon}</td>
        <td class="task-id">${escHtml(ft.taskId)}</td>
        <td>${escHtml(ft.task.title)}</td>
        <td><span class="${priClass}" style="font-size:10px">${escHtml(ft.task.priority)}</span></td>
        <td class="agg-repo">${escHtml(ft.repoName)}</td>
        <td class="agg-age">${escHtml(age)}</td>
      </tr>`
    }
    html += `</table>`

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
        <button class="btn btn-secondary" style="font-size:9px;padding:1px 6px;text-transform:none;letter-spacing:0" data-cmd="createMissingIssues">Create Issues</button>
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
        const rawIssue = item.taskId ? repo.manifest.tasks?.[item.taskId]?.github_issue : undefined
        // Safely coerce: legacy string URLs like "https://.../issues/5" → 5
        const linkedIssue: number | undefined = typeof rawIssue === 'number' && rawIssue > 0
          ? rawIssue
          : typeof rawIssue === 'string'
            ? (parseInt((rawIssue as string).match(/\/issues\/(\d+)$/)?.[1] ?? '', 10) || undefined)
            : undefined
        const ghIssueBtn = (item.taskId && repo.githubUrl)
          ? `<a class="gh-link" data-cmd="openUrl" data-url="${linkedIssue ? `${escHtml(repo.githubUrl)}/issues/${linkedIssue}` : `${escHtml(repo.githubUrl)}/issues?q=${escHtml(item.taskId)}`}" title="${linkedIssue ? `Open linked GitHub Issue #${linkedIssue}` : `Search GitHub Issues for ${escHtml(item.taskId)}`}">GH</a>`
          : ''

        const dblData = item.taskId
          ? ` data-dbl="fixTask" data-repo-path="${escHtml(repo.repoPath)}" data-task-id="${escHtml(item.taskId)}"`
          : ''
        html += `<div class="ns-item ns-${item.section}"${dblData}>
          ${idLabel}<span class="ns-title">${escHtml(item.title)}</span>${priLabel}${ghIssueBtn}${fixBtn}
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
        ? `<a class="gh-link" data-cmd="openUrl" data-url="${typeof t.github_issue === 'number' && t.github_issue > 0 ? `${escHtml(repoGhUrl)}/issues/${t.github_issue}` : `${escHtml(repoGhUrl)}/issues?q=${escHtml(id)}`}" title="${typeof t.github_issue === 'number' && t.github_issue > 0 ? `Open linked GitHub Issue #${t.github_issue}` : `Search GitHub Issues for ${escHtml(id)}`}">GH</a>`
        : ''

      const dblAttr = t.status !== 'done'
        ? ` data-dbl="fixTask" data-repo-path="${escHtml(repoPath)}" data-task-id="${escHtml(id)}"`
        : ''
      html += `<tr${dblAttr}>
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
        <td class="task-actions">${ghIssueBtn}${fixBtn}</td>
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
        <button class="btn btn-secondary" data-cmd="createMissingIssues">Create Issues</button>
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
        if (el.dataset.runIndex) data.runIndex = el.dataset.runIndex
        if (el.dataset.logId) data.logId = el.dataset.logId
        if (cmd === 'openUrl') { e.stopPropagation(); }
        post(cmd, data)
      })

      document.addEventListener('dblclick', function(e) {
        var el = e.target.closest('[data-dbl]')
        if (!el) return
        e.preventDefault()
        e.stopPropagation()
        var cmd = el.dataset.dbl
        var data = {}
        if (el.dataset.repoPath) data.repoPath = el.dataset.repoPath
        if (el.dataset.taskId) data.taskId = el.dataset.taskId
        post(cmd, data)
      })

      document.addEventListener('change', function(e) {
        var el = e.target.closest('[data-cmd]')
        if (!el) return
        var cmd = el.dataset.cmd
        if (cmd === 'setTaskFilter') {
          post(cmd, {
            filterKey: el.dataset.filterKey,
            filterValue: el.value
          })
        } else {
          post(cmd, {
            repoPath: el.dataset.repoPath,
            taskId: el.dataset.taskId,
            status: el.value
          })
        }
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

function formatDurationShort(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '-'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const mins = Math.floor(ms / 60000)
  const secs = Math.round((ms % 60000) / 1000)
  return `${mins}m ${secs}s`
}

function readRunnerSessions(): RunnerSession[] {
  try {
    if (!fs.existsSync(RUNNER_SESSIONS_FILE)) return []
    const raw = JSON.parse(fs.readFileSync(RUNNER_SESSIONS_FILE, 'utf8')) as { sessions?: unknown[] }
    return Array.isArray(raw.sessions) ? raw.sessions as RunnerSession[] : []
  } catch {
    return []
  }
}

function readRunnerMetrics(limit = 200): RunnerMetric[] {
  try {
    if (!fs.existsSync(RUNNER_METRICS_FILE)) return []
    const lines = fs.readFileSync(RUNNER_METRICS_FILE, 'utf8').split('\n').filter(Boolean)
    const parsed: RunnerMetric[] = []
    for (const line of lines) {
      try {
        parsed.push(JSON.parse(line) as RunnerMetric)
      } catch {
        continue
      }
    }
    return limit > 0 ? parsed.slice(-limit) : parsed
  } catch {
    return []
  }
}

function readLatestCronRun(): CronPipelineRun | undefined {
  try {
    if (!fs.existsSync(CRON_HISTORY_FILE)) return undefined
    const raw = JSON.parse(fs.readFileSync(CRON_HISTORY_FILE, 'utf8')) as unknown
    if (!Array.isArray(raw) || raw.length === 0) return undefined
    return raw[0] as CronPipelineRun
  } catch {
    return undefined
  }
}

function getLatestCronLogPath(): string | undefined {
  const logDir = path.join(AAHP_HOME, 'cron-logs')

  const latestRun = readLatestCronRun()
  if (latestRun?.startedAt) {
    const stamp = latestRun.startedAt.slice(0, 16).replace('T', '_').replace(':', '-')
    const byHistory = path.join(logDir, `run-${stamp}.log`)
    if (fs.existsSync(byHistory)) return byHistory
  }

  try {
    if (!fs.existsSync(logDir)) return undefined
    const files = fs.readdirSync(logDir)
      .filter(name => /^run-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.log$/.test(name))
      .map(name => {
        const filePath = path.join(logDir, name)
        const mtime = fs.statSync(filePath).mtimeMs
        return { filePath, mtime }
      })
      .sort((a, b) => b.mtime - a.mtime)
    return files[0]?.filePath
  } catch {
    return undefined
  }
}

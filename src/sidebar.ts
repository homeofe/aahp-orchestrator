import * as vscode from 'vscode'
import * as path from 'path'
import { AahpContext, AahpTask, getTopTask } from './aahp-reader'
import { AgentRun, sessionTokens } from './agent-spawner'

export class AahpDashboardProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView
  private _ctx: AahpContext | undefined
  private _agentRuns: AgentRun[] = []

  constructor(private readonly extensionUri: vscode.Uri) {}

  public update(ctx: AahpContext | undefined): void {
    this._ctx = ctx
    this._render()
  }

  public updateAgentRuns(runs: AgentRun[]): void {
    this._agentRuns = runs
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
      }
    })
  }

  private _getHtml(webview: vscode.Webview): string {
    const ctx = this._ctx
    const nonce = getNonce()

    if (!ctx && this._agentRuns.length === 0) {
      return `<!DOCTYPE html><html><body style="padding:16px;font-family:var(--vscode-font-family);color:var(--vscode-foreground)">
        <p>⚠️ No <code>.ai/handoff/MANIFEST.json</code> found in this workspace.</p>
        <p><a href="https://github.com/homeofe/AAHP">Set up AAHP v3 →</a></p>
        <button onclick="post('runAll')" style="margin-top:12px;padding:6px 14px;font-size:13px;cursor:pointer;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;width:100%">
          🚀 Run All Agents
        </button>
        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi()
          function post(command) { vscode.postMessage({ command }) }
        </script>
      </body></html>`
    }

    // ── Agent runs panel ──────────────────────────────────────────────────────
    const agentRunsHtml = this._agentRuns.length > 0 ? (() => {
      const statusIcon: Record<string, string> = {
        queued: '⏳', running: '🔄', done: '✅', failed: '❌'
      }
      const rows = this._agentRuns.map(r => {
        const icon = statusIcon[r.status] ?? '•'
        const elapsed = r.startedAt
          ? r.finishedAt
            ? `${Math.round((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000)}s`
            : 'running…'
          : 'queued'
        const backendBadge = r.backend === 'claude'
          ? `<span style="color:#f97316;font-size:10px">⚡claude</span>`
          : `<span style="color:#22c55e;font-size:10px">🤖copilot</span>`
        const tokStr = r.tokens.totalTokens > 0 ? `${r.tokens.totalTokens.toLocaleString()}t` : ''
        return `<tr>
          <td>${icon}</td>
          <td style="font-size:12px;font-weight:bold">${escHtml(r.repo.repoName)}</td>
          <td>${backendBadge}</td>
          <td style="font-size:11px;opacity:.7">${escHtml(r.repo.taskId)}</td>
          <td style="font-size:11px;opacity:.6">${elapsed}</td>
          <td style="font-size:11px;opacity:.6">${tokStr}</td>
        </tr>`
      }).join('')

      const done = this._agentRuns.filter(r => r.committed).length
      const running = this._agentRuns.filter(r => r.status === 'running').length
      const total = this._agentRuns.length
      const claudeCount = this._agentRuns.filter(r => r.backend === 'claude').length
      const copilotCount = this._agentRuns.filter(r => r.backend === 'copilot').length

      const tC = sessionTokens.claude
      const tP = sessionTokens.copilot
      const totalAll = tC.totalTokens + tP.totalTokens
      const claudePct = totalAll > 0 ? Math.round(tC.totalTokens / totalAll * 100) : 0
      const copilotPct = totalAll > 0 ? 100 - claudePct : 0

      const tokenBudgetHtml = totalAll > 0 ? `
        <div class="section-title">Token Budget</div>
        <div style="font-size:11px;margin-bottom:4px">
          <span style="color:#f97316">⚡ Claude Code</span>
          &nbsp;${tC.totalTokens.toLocaleString()} tokens
          &nbsp;<span style="opacity:.5">(in:${tC.inputTokens.toLocaleString()} out:${tC.outputTokens.toLocaleString()})</span>
        </div>
        <div style="font-size:11px;margin-bottom:6px">
          <span style="color:#22c55e">🤖 Copilot</span>
          &nbsp;${tP.totalTokens.toLocaleString()} tokens
          &nbsp;<span style="opacity:.5">(in:${tP.inputTokens.toLocaleString()} out:${tP.outputTokens.toLocaleString()})</span>
        </div>
        <div style="background:var(--vscode-progressBar-background);border-radius:3px;height:6px;overflow:hidden">
          <div style="display:flex;height:100%">
            <div style="width:${claudePct}%;background:#f97316"></div>
            <div style="width:${copilotPct}%;background:#22c55e"></div>
          </div>
        </div>
        <div style="font-size:10px;opacity:.5;margin-top:2px">${claudePct}% Claude · ${copilotPct}% Copilot · ${totalAll.toLocaleString()} total</div>
      ` : ''

      return `
        <div class="section-title">Agent Runs - ${done}/${total} committed${running > 0 ? ` · ${running} active` : ''} · ⚡${claudeCount} 🤖${copilotCount}</div>
        <table>${rows}</table>
        ${tokenBudgetHtml}
      `
    })() : ''

    const m = ctx?.manifest
    const topTask = m ? getTopTask(m) : undefined
    const phase = m?.last_session?.phase ?? ''
    const version = m ? (m.aahp_version ?? m.version ?? '?') : ''

    const taskRows = m?.tasks
      ? Object.entries(m.tasks)
          .map(([id, t]: [string, AahpTask]) => {
            const statusIcon = { done: '✅', in_progress: '🔄', ready: '⏳', blocked: '🚫', pending: '💤' }[t.status] ?? '•'
            const priorityColor = t.priority === 'high' ? '#f14c4c' : t.priority === 'medium' ? '#cca700' : '#4ec9b0'
            return `<tr>
              <td style="opacity:.6;font-size:11px">${id}</td>
              <td>${statusIcon}</td>
              <td style="font-size:12px">${t.title}</td>
              <td><span style="color:${priorityColor};font-size:11px">${t.priority}</span></td>
            </tr>`
          })
          .join('')
      : '<tr><td colspan="4" style="opacity:.5">No tasks in manifest</td></tr>'

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
<style>
  body { font-family: var(--vscode-font-family); font-size: 13px; color: var(--vscode-foreground); padding: 12px; margin: 0; }
  h2 { font-size: 14px; margin: 0 0 4px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); margin: 2px; }
  .context { font-size: 12px; opacity: .8; margin: 8px 0; line-height: 1.5; border-left: 2px solid var(--vscode-activityBarBadge-background); padding-left: 8px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  td { padding: 3px 6px; vertical-align: top; }
  tr:hover td { background: var(--vscode-list-hoverBackground); }
  button { margin: 4px 4px 0 0; padding: 4px 10px; font-size: 12px; cursor: pointer; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 3px; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  .btn-primary { background: var(--vscode-button-background); font-size: 13px; padding: 6px 0; width: 100%; margin: 0 0 8px; }
  .section-title { font-size: 11px; text-transform: uppercase; opacity: .5; margin: 12px 0 4px; letter-spacing: .5px; }
</style>
</head>
<body>
  <button class="btn-primary" onclick="post('runAll')">🚀 Run All Agents</button>

  ${m ? `
  <h2>$(robot) ${escHtml(m.project)}</h2>
  <span class="badge">AAHP v${escHtml(version)}</span>
  <span class="badge">${escHtml(phase)}</span>
  <span class="badge">${escHtml(m.last_session.agent)}</span>
  <div class="context">${escHtml(m.quick_context)}</div>
  ${topTask ? `<div class="section-title">Active Task</div>
  <div style="font-size:12px;padding:4px 0">🎯 <strong>[${escHtml(topTask[0])}]</strong> ${escHtml(topTask[1].title)}</div>` : ''}
  <div class="section-title">All Tasks</div>
  <table>${taskRows}</table>
  ` : ''}

  ${agentRunsHtml}

  <div class="section-title">Actions</div>
  <button onclick="post('updateManifest')">↺ Update Checksums</button>
  <button onclick="post('commitSession')">💾 Commit Session</button>
  <button onclick="post('setPhase')">🔧 Set Phase</button>
  <button onclick="post('copyContext')">📋 Copy Context</button>

  ${m ? `<div class="section-title">Last Session</div>
  <div style="font-size:11px;opacity:.6">
    ${escHtml(m.last_session.timestamp)} · ${m.last_session.duration_minutes}min · ${escHtml(m.last_session.commit)}
  </div>` : ''}

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi()
  function post(command) { vscode.postMessage({ command }) }
</script>
</body></html>`
  }
}

function getNonce(): string {
  let text = ''
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length))
  return text
}

function escHtml(s: string): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}


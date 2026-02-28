import * as vscode from 'vscode'
import {
  loadAahpContext,
  getWorkspaceRoot,
  buildSystemPrompt,
  AahpContext,
  getTopTask,
} from './aahp-reader'
import { AgentRun } from './agent-spawner'

export function createStatusBar(): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10)
  item.command = 'aahp.openDashboard'
  item.tooltip = 'AAHP Orchestrator - click to open dashboard'
  return item
}

export function updateStatusBar(item: vscode.StatusBarItem, ctx: AahpContext | undefined): void {
  if (!ctx) {
    item.text = '$(circle-slash) AAHP'
    item.tooltip = 'No .ai/handoff/MANIFEST.json found in workspace'
    item.backgroundColor = undefined
    item.show()
    return
  }

  const m = ctx.manifest
  const phase = m.last_session.phase
  const topTask = getTopTask(m)
  const taskLabel = topTask ? ` · ${topTask[0]}: ${topTask[1].title.slice(0, 30)}` : ''

  item.text = `$(robot) AAHP [${phase}]${taskLabel}`
  item.tooltip = new vscode.MarkdownString(
    `**${m.project}** - AAHP v${m.aahp_version ?? m.version}\n\n` +
    `Phase: \`${phase}\`\n\n` +
    `> ${m.quick_context}\n\n` +
    `_Click to open dashboard_`
  )
  item.backgroundColor = undefined
  item.show()
}

// ── Agent status bar (running indicator) ──────────────────────────────────

export function createAgentStatusBar(): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 9)
  item.command = 'aahp.openDashboard'
  item.hide()
  return item
}

export function updateAgentStatusBar(item: vscode.StatusBarItem, runs: AgentRun[]): void {
  const running = runs.filter(r => r.status === 'running').length
  const total = runs.length
  const done = runs.filter(r => r.status === 'done').length

  if (running === 0 && total === 0) {
    item.hide()
    return
  }

  if (running > 0) {
    item.text = `$(sync~spin) ${running}/${total} agents`
    item.tooltip = `AAHP: ${running} running, ${done} done, ${total} total`
    item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground')
  } else {
    const failed = runs.filter(r => r.status === 'failed').length
    item.text = `$(check) ${done}/${total} agents done`
    item.tooltip = `AAHP: ${done} committed, ${failed} failed`
    item.backgroundColor = undefined
    // Auto-hide after 10s when all done
    setTimeout(() => item.hide(), 10000)
  }
  item.show()
}

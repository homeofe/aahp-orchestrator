import * as vscode from 'vscode'
import {
  loadAahpContext,
  getWorkspaceRoot,
  buildSystemPrompt,
  AahpContext,
  getTopTask,
} from './aahp-reader'

export function createStatusBar(): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10)
  item.command = 'aahp.openDashboard'
  item.tooltip = 'AAHP Orchestrator — click to open dashboard'
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
    `**${m.project}** — AAHP v${m.aahp_version ?? m.version}\n\n` +
    `Phase: \`${phase}\`\n\n` +
    `> ${m.quick_context}\n\n` +
    `_Click to open dashboard_`
  )
  item.backgroundColor = undefined
  item.show()
}

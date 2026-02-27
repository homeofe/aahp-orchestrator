import * as vscode from 'vscode'
import { AahpContext, buildSystemPrompt } from './aahp-reader'

/**
 * Injects AAHP context into the clipboard and optionally pastes it
 * into an open chat input whenever a new chat session is detected.
 * Also provides a command to manually copy context.
 */
export function registerContextInjector(
  context: vscode.ExtensionContext,
  getCtx: () => AahpContext | undefined
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = []

  // Command: copy AAHP context to clipboard (Ctrl+Alt+A)
  disposables.push(
    vscode.commands.registerCommand('aahp.copyContext', async () => {
      const aahp = getCtx()
      if (!aahp) {
        vscode.window.showWarningMessage('AAHP: No MANIFEST.json found in workspace.')
        return
      }
      const prompt = buildSystemPrompt(aahp)
      await vscode.env.clipboard.writeText(prompt)
      vscode.window.showInformationMessage(
        `AAHP context copied to clipboard (${prompt.length} chars). Paste it as your first message in Copilot or Claude chat.`
      )
    })
  )

  // Notification banner when workspace opens with AAHP context
  // Fires once per session when the user first opens a file
  disposables.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      if (context.workspaceState.get('aahp.contextBannerShown')) return
      const aahp = getCtx()
      if (!aahp) return

      const m = aahp.manifest
      const msg = `AAHP [${m.last_session.phase}] ${m.project} - ${m.quick_context.slice(0, 80)}`

      vscode.window.showInformationMessage(
        msg,
        'Copy Context',
        'Open Dashboard'
      ).then(choice => {
        if (choice === 'Copy Context') {
          vscode.commands.executeCommand('aahp.copyContext')
        } else if (choice === 'Open Dashboard') {
          vscode.commands.executeCommand('aahp.openDashboard')
        }
      })

      context.workspaceState.update('aahp.contextBannerShown', true)
    })
  )

  return disposables
}

import * as vscode from 'vscode'
import {
  AahpContext,
  buildSystemPrompt,
  getTopTask,
} from './aahp-reader'

// ── Chat Participant ──────────────────────────────────────────────────────────
// Registered as @aahp in VS Code chat.
// Every message gets full AAHP context injected — no questions asked.

export function registerChatParticipant(
  context: vscode.ExtensionContext,
  getCtx: () => AahpContext | undefined
): vscode.Disposable {
  const participant = vscode.chat.createChatParticipant(
    'aahp.orchestrator',
    async (
      request: vscode.ChatRequest,
      chatContext: vscode.ChatContext,
      stream: vscode.ChatResponseStream,
      token: vscode.CancellationToken
    ) => {
      const aahp = getCtx()

      if (!aahp) {
        stream.markdown(
          '⚠️ No `.ai/handoff/MANIFEST.json` found in this workspace.\n\n' +
          'Create one to enable zero-question orchestration. ' +
          '[AAHP v3 spec](https://github.com/homeofe/AAHP)'
        )
        return
      }

      // Build system prompt from AAHP context
      const systemPrompt = buildSystemPrompt(aahp)
      const topTask = getTopTask(aahp.manifest)

      // Pick a language model (Copilot family, fall back gracefully)
      let model: vscode.LanguageModelChat | undefined
      try {
        const models = await vscode.lm.selectChatModels({
          vendor: 'copilot',
          family: 'gpt-4o',
        })
        model = models[0]
      } catch {
        // try any available model
        try {
          const fallback = await vscode.lm.selectChatModels()
          model = fallback[0]
        } catch {
          model = undefined
        }
      }

      if (!model) {
        stream.markdown(
          '⚠️ No language model available. Make sure GitHub Copilot or another LM extension is active.\n\n' +
          '**AAHP Context loaded:**\n\n```\n' + systemPrompt + '\n```'
        )
        return
      }

      // Build messages: system context + history + user request
      const messages: vscode.LanguageModelChatMessage[] = [
        vscode.LanguageModelChatMessage.Assistant(systemPrompt),
      ]

      // Include recent chat history for continuity
      for (const turn of chatContext.history.slice(-6)) {
        if (turn instanceof vscode.ChatRequestTurn) {
          messages.push(vscode.LanguageModelChatMessage.User(turn.prompt))
        } else if (turn instanceof vscode.ChatResponseTurn) {
          const responseText = turn.response
            .filter((p): p is vscode.ChatResponseMarkdownPart =>
              p instanceof vscode.ChatResponseMarkdownPart
            )
            .map(p => p.value.value)
            .join('')
          if (responseText) {
            messages.push(vscode.LanguageModelChatMessage.Assistant(responseText))
          }
        }
      }

      messages.push(vscode.LanguageModelChatMessage.User(request.prompt))

      // Show what task we're working on
      if (topTask) {
        stream.markdown(
          `> 🎯 **[${topTask[0]}]** ${topTask[1].title} *(${topTask[1].status})*\n\n`
        )
      }

      // Stream response
      try {
        const response = await model.sendRequest(messages, {}, token)
        for await (const chunk of response.text) {
          stream.markdown(chunk)
        }
      } catch (err) {
        if (err instanceof vscode.LanguageModelError) {
          stream.markdown(`\n\n❌ LM error: ${err.message} (${err.code})`)
        } else {
          throw err
        }
      }
    }
  )

  participant.iconPath = new vscode.ThemeIcon('robot')
  participant.followupProvider = {
    provideFollowups(
      result: vscode.ChatResult,
      _context: vscode.ChatContext,
      _token: vscode.CancellationToken
    ) {
      const aahp = getCtx()
      if (!aahp) return []
      const topTask = getTopTask(aahp.manifest)
      const followups: vscode.ChatFollowup[] = [
        { prompt: 'Update the MANIFEST.json with my progress', label: '📝 Update manifest' },
        { prompt: 'What should I do next based on AAHP context?', label: '⏭ What next?' },
      ]
      if (topTask) {
        followups.unshift({
          prompt: `Mark ${topTask[0]} as done and suggest the next task`,
          label: `✅ Complete ${topTask[0]}`,
        })
      }
      return followups
    },
  }

  return participant
}

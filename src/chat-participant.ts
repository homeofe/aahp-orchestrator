import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import {
  AahpContext,
  AahpTask,
  buildSystemPrompt,
  getTopTask,
  saveManifest,
} from './aahp-reader'

// ── Slash command handlers ────────────────────────────────────────────────────

function handleHelp(stream: vscode.ChatResponseStream): void {
  stream.markdown([
    '## @aahp - AAHP Orchestrator Commands\n',
    'All commands read from `.ai/handoff/MANIFEST.json` in the current workspace.\n',
    '| Command | Description | Example |',
    '|---------|-------------|---------|',
    '| `/help` | Show this help | `@aahp /help` |',
    '| `/status` | Current phase, agent, quick_context | `@aahp /status` |',
    '| `/tasks` | All tasks with status & priority | `@aahp /tasks` |',
    '| `/next` | What to work on next | `@aahp /next` |',
    '| `/context` | Full injected system prompt | `@aahp /context` |',
    '| `/phase` | Show or set current phase | `@aahp /phase implementation` |',
    '| `/done` | Mark a task done | `@aahp /done T-003` |',
    '\n### Free-form (AI-powered)\n',
    'Anything else is forwarded to Copilot with full AAHP context injected:\n',
    '```',
    '@aahp implement the top task',
    '@aahp what is blocking T-005?',
    '@aahp update MANIFEST.json with my progress',
    '@aahp review the conventions for this project',
    '```',
  ].join('\n'))
}

function handleStatus(stream: vscode.ChatResponseStream, aahp: AahpContext): void {
  const m = aahp.manifest
  const topTask = getTopTask(m)
  const version = m.aahp_version ?? m.version ?? '?'
  stream.markdown([
    `## 🤖 AAHP Status - ${m.project}\n`,
    `| Field | Value |`,
    `|-------|-------|`,
    `| **Version** | AAHP v${version} |`,
    `| **Phase** | \`${m.last_session.phase}\` |`,
    `| **Last agent** | ${m.last_session.agent} |`,
    `| **Last session** | ${m.last_session.timestamp} |`,
    `| **Last commit** | \`${m.last_session.commit}\` |`,
    `| **Duration** | ${m.last_session.duration_minutes} min |`,
    topTask ? `| **Active task** | [${topTask[0]}] ${topTask[1].title} *(${topTask[1].status})* |` : '| **Active task** | - none - |',
    `\n### Quick Context\n> ${m.quick_context}`,
  ].join('\n'))
}

function handleTasks(stream: vscode.ChatResponseStream, aahp: AahpContext): void {
  const m = aahp.manifest
  if (!m.tasks || Object.keys(m.tasks).length === 0) {
    stream.markdown('No tasks defined in MANIFEST.json.')
    return
  }
  const statusIcon: Record<string, string> = {
    done: '✅', in_progress: '🔄', ready: '⏳', blocked: '🚫', pending: '💤',
  }
  const rows = Object.entries(m.tasks)
    .map(([id, t]: [string, AahpTask]) =>
      `| \`${id}\` | ${statusIcon[t.status] ?? '•'} ${t.status} | ${t.title} | ${t.priority} | ${t.depends_on?.join(', ') || '-'} |`
    )
    .join('\n')
  stream.markdown([
    `## 📋 Tasks - ${m.project}\n`,
    '| ID | Status | Title | Priority | Depends on |',
    '|----|--------|-------|----------|------------|',
    rows,
    `\n_Next task ID: T-${String(m.next_task_id ?? '?').padStart(3, '0')}_`,
  ].join('\n'))
}

function handleNext(stream: vscode.ChatResponseStream, aahp: AahpContext): void {
  const m = aahp.manifest
  const active = Object.entries(m.tasks ?? {}).find(([, t]) => t.status === 'in_progress')
  const ready = Object.entries(m.tasks ?? {}).filter(([, t]) => t.status === 'ready')
  const blocked = Object.entries(m.tasks ?? {}).filter(([, t]) => t.status === 'blocked')

  if (active) {
    stream.markdown(`## ⏭ Next\n\n🔄 Already in progress: **[${active[0]}]** ${active[1].title}\n\nKeep going!`)
    return
  }
  if (ready.length > 0) {
    const lines = ready.map(([id, t]) => `- **[${id}]** ${t.title} *(${t.priority} priority)*`)
    stream.markdown(`## ⏭ Next\n\nReady to start:\n\n${lines.join('\n')}`)
  } else if (blocked.length > 0) {
    const lines = blocked.map(([id, t]) => `- **[${id}]** ${t.title} - blocked on: ${t.depends_on?.join(', ')}`)
    stream.markdown(`## ⏭ Next\n\nAll remaining tasks are blocked:\n\n${lines.join('\n')}`)
  } else {
    stream.markdown('## ⏭ Next\n\n🎉 All tasks are done!')
  }
}

function handleContext(stream: vscode.ChatResponseStream, aahp: AahpContext): void {
  const prompt = buildSystemPrompt(aahp)
  stream.markdown(`## 🔍 Injected System Prompt\n\nThis is what gets prepended to every \`@aahp\` request:\n\n\`\`\`\n${prompt}\n\`\`\`\n\n_${prompt.length} characters_`)
}

function handlePhase(
  stream: vscode.ChatResponseStream,
  aahp: AahpContext,
  arg: string
): void {
  const phases = ['research', 'architecture', 'implementation', 'review', 'fix', 'release']
  const current = aahp.manifest.last_session.phase
  if (!arg) {
    stream.markdown(`## 🔧 Phase\n\nCurrent: \`${current}\`\n\nAvailable phases: ${phases.map(p => `\`${p}\``).join(', ')}\n\nTo change: \`@aahp /phase implementation\``)
    return
  }
  const newPhase = arg.trim().toLowerCase()
  if (!phases.includes(newPhase)) {
    stream.markdown(`❌ Unknown phase \`${newPhase}\`. Valid: ${phases.map(p => `\`${p}\``).join(', ')}`)
    return
  }
  const updated = {
    ...aahp.manifest,
    last_session: { ...aahp.manifest.last_session, phase: newPhase, timestamp: new Date().toISOString() },
  }
  saveManifest(aahp, updated)
  stream.markdown(`✅ Phase updated: \`${current}\` → \`${newPhase}\`\n\nMANIFEST.json saved.`)
}

function handleDone(
  stream: vscode.ChatResponseStream,
  aahp: AahpContext,
  arg: string
): void {
  const taskId = arg.trim().toUpperCase()
  if (!taskId) {
    stream.markdown('Usage: `@aahp /done T-003`')
    return
  }
  const tasks = aahp.manifest.tasks ?? {}
  const task = tasks[taskId]
  if (!task) {
    const available = Object.keys(tasks).join(', ')
    stream.markdown(`❌ Task \`${taskId}\` not found.\n\nAvailable: ${available}`)
    return
  }
  const updated = {
    ...aahp.manifest,
    tasks: {
      ...tasks,
      [taskId]: { ...task, status: 'done' as const, completed: new Date().toISOString() },
    },
  }
  saveManifest(aahp, updated)
  stream.markdown(`✅ **[${taskId}]** ${task.title}\n\nMarked as **done** and saved to MANIFEST.json.`)
}

// ── Chat Participant ──────────────────────────────────────────────────────────
// Registered as @aahp in VS Code chat.
// Every message gets full AAHP context injected - no questions asked.

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

      // ── Slash commands (no LM needed) ───────────────────────────────────────
      switch (request.command) {
        case 'help':   handleHelp(stream); return
        case 'status': handleStatus(stream, aahp); return
        case 'tasks':  handleTasks(stream, aahp); return
        case 'next':   handleNext(stream, aahp); return
        case 'context': handleContext(stream, aahp); return
        case 'phase':  handlePhase(stream, aahp, request.prompt); return
        case 'done':   handleDone(stream, aahp, request.prompt); return
      }

      // ── Free-form: forward to LM with AAHP context injected ─────────────────
      const systemPrompt = buildSystemPrompt(aahp)
      const topTask = getTopTask(aahp.manifest)

      let model: vscode.LanguageModelChat | undefined
      try {
        const models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' })
        model = models[0]
      } catch {
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

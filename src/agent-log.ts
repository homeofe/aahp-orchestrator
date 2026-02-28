import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { AgentRun } from './agent-spawner'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AgentLogEntry {
  id: string
  repoName: string
  taskId: string
  taskTitle: string
  backend: string
  status: string
  committed: boolean
  startedAt: string
  finishedAt: string
  durationSec: number
  tokens: { input: number; output: number; total: number }
  outputPreview: string
  logFileName: string
}

const LOG_STATE_KEY = 'aahp.agentLogHistory'
const MAX_HISTORY_ENTRIES = 100

// ── Agent Log Store ──────────────────────────────────────────────────────────

export class AgentLogStore {
  private _logsDir: string

  constructor(
    private readonly _globalState: vscode.Memento,
    globalStorageUri: vscode.Uri
  ) {
    this._logsDir = path.join(globalStorageUri.fsPath, 'logs')
  }

  /** Write agent output to a log file and record metadata in global state */
  async writeLog(run: AgentRun): Promise<string> {
    // Ensure logs directory exists
    await fs.promises.mkdir(this._logsDir, { recursive: true })

    const now = new Date()
    const dateStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const logFileName = `${dateStr}-${run.repo.repoName}-${run.repo.taskId}.log`
    const logPath = path.join(this._logsDir, logFileName)

    // Build log content with header
    const durationSec = run.startedAt && run.finishedAt
      ? Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000)
      : 0

    const header = [
      `AAHP Agent Log`,
      `Repo: ${run.repo.repoName}`,
      `Task: [${run.repo.taskId}] ${run.repo.taskTitle}`,
      `Backend: ${run.backend}`,
      `Status: ${run.status} | Committed: ${run.committed}`,
      `Started: ${run.startedAt?.toISOString() ?? 'unknown'}`,
      `Finished: ${run.finishedAt?.toISOString() ?? 'unknown'}`,
      `Duration: ${durationSec}s`,
      `Tokens: in=${run.tokens.inputTokens} out=${run.tokens.outputTokens} total=${run.tokens.totalTokens}`,
      `Retries: ${run.retryCount}/${run.maxRetries}`,
      '-'.repeat(60),
      '',
    ].join('\n')

    await fs.promises.writeFile(logPath, header + (run.output || '(no output)'), 'utf8')

    // Record entry in global state
    const id = `${Date.now()}-${run.repo.repoName}-${run.repo.taskId}`
    const entry: AgentLogEntry = {
      id,
      repoName: run.repo.repoName,
      taskId: run.repo.taskId,
      taskTitle: run.repo.taskTitle,
      backend: run.backend,
      status: run.status,
      committed: run.committed,
      startedAt: run.startedAt?.toISOString() ?? now.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? now.toISOString(),
      durationSec,
      tokens: {
        input: run.tokens.inputTokens,
        output: run.tokens.outputTokens,
        total: run.tokens.totalTokens,
      },
      outputPreview: (run.output || '').slice(0, 500),
      logFileName,
    }

    const history = this.getHistory()
    history.unshift(entry)

    // Trim to max entries
    if (history.length > MAX_HISTORY_ENTRIES) {
      history.length = MAX_HISTORY_ENTRIES
    }

    await this._globalState.update(LOG_STATE_KEY, history)
    return id
  }

  /** Get the log history, most recent first */
  getHistory(limit?: number): AgentLogEntry[] {
    const history: AgentLogEntry[] = this._globalState.get(LOG_STATE_KEY, [])
    if (limit && limit > 0) return history.slice(0, limit)
    return history
  }

  /** Open a log file in the editor */
  async openLog(entry: AgentLogEntry): Promise<void> {
    const logPath = path.join(this._logsDir, entry.logFileName)
    try {
      const doc = await vscode.workspace.openTextDocument(logPath)
      await vscode.window.showTextDocument(doc, { preview: true })
    } catch {
      vscode.window.showWarningMessage('AAHP: Log file not found - it may have been pruned.')
    }
  }

  /** Remove log entries and files older than the given number of days */
  async clearOlderThan(days: number): Promise<number> {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    const history = this.getHistory()
    const toKeep: AgentLogEntry[] = []
    let removed = 0

    for (const entry of history) {
      if (new Date(entry.finishedAt).getTime() < cutoff) {
        // Delete log file
        const logPath = path.join(this._logsDir, entry.logFileName)
        try { await fs.promises.unlink(logPath) } catch { /* already gone */ }
        removed++
      } else {
        toKeep.push(entry)
      }
    }

    await this._globalState.update(LOG_STATE_KEY, toKeep)
    return removed
  }
}

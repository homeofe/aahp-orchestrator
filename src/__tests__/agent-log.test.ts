import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { AgentLogStore, AgentLogEntry } from '../agent-log'
import { AgentRun } from '../agent-spawner'

// ── Mock vscode (only workspace.openTextDocument and window.showTextDocument) ──

vi.mock('vscode', () => ({
  workspace: {
    openTextDocument: vi.fn(async () => ({ uri: { fsPath: '/mock' } })),
  },
  window: {
    showTextDocument: vi.fn(),
    showWarningMessage: vi.fn(),
  },
}))

// ── Mock globalState ────────────────────────────────────────────────────────

function makeGlobalState() {
  const store: Record<string, unknown> = {}
  return {
    get: vi.fn(<T>(key: string, defaultValue?: T): T => (store[key] as T) ?? (defaultValue as T)),
    update: vi.fn(async (key: string, value: unknown) => { store[key] = value }),
    keys: vi.fn(() => Object.keys(store)),
    setKeysForSync: vi.fn(),
    _store: store,
  }
}

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeAgentRun(overrides?: Partial<AgentRun>): AgentRun {
  return {
    repo: {
      repoPath: '/dev/test-repo',
      repoName: 'test-repo',
      manifestPath: '/dev/test-repo/.ai/handoff/MANIFEST.json',
      taskId: 'T-001',
      taskTitle: 'Test task',
      phase: 'implementation',
      quickContext: 'test context',
      taskPriority: 'high',
    },
    status: 'done',
    backend: 'claude',
    output: 'Agent completed successfully.\nCommitted changes.',
    committed: true,
    tokens: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 },
    startedAt: new Date('2026-02-28T10:00:00Z'),
    finishedAt: new Date('2026-02-28T10:05:00Z'),
    retryCount: 0,
    maxRetries: 1,
    ...overrides,
  }
}

let tmpDir: string
let globalState: ReturnType<typeof makeGlobalState>
let logStore: AgentLogStore

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aahp-log-test-'))
  globalState = makeGlobalState()
  logStore = new AgentLogStore(
    globalState as any,
    { fsPath: tmpDir } as any
  )
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AgentLogStore', () => {
  describe('writeLog', () => {
    it('should create a log file and return an ID', async () => {
      const run = makeAgentRun()
      const id = await logStore.writeLog(run)

      expect(id).toBeTruthy()
      expect(typeof id).toBe('string')
      expect(id).toContain('test-repo')
      expect(id).toContain('T-001')
    })

    it('should write log file to disk', async () => {
      const run = makeAgentRun()
      await logStore.writeLog(run)

      const logsDir = path.join(tmpDir, 'logs')
      const files = fs.readdirSync(logsDir)
      expect(files.length).toBe(1)

      const logContent = fs.readFileSync(path.join(logsDir, files[0]!), 'utf8')
      expect(logContent).toContain('AAHP Agent Log')
      expect(logContent).toContain('test-repo')
      expect(logContent).toContain('T-001')
      expect(logContent).toContain('Test task')
      expect(logContent).toContain('claude')
      expect(logContent).toContain('Agent completed successfully.')
    })

    it('should store entry in global state history', async () => {
      const run = makeAgentRun()
      await logStore.writeLog(run)

      const history = logStore.getHistory()
      expect(history.length).toBe(1)
      expect(history[0]!.repoName).toBe('test-repo')
      expect(history[0]!.taskId).toBe('T-001')
      expect(history[0]!.committed).toBe(true)
      expect(history[0]!.backend).toBe('claude')
      expect(history[0]!.tokens.total).toBe(1500)
    })

    it('should handle run with no output', async () => {
      const run = makeAgentRun({ output: '' })
      await logStore.writeLog(run)

      const logsDir = path.join(tmpDir, 'logs')
      const files = fs.readdirSync(logsDir)
      const logContent = fs.readFileSync(path.join(logsDir, files[0]!), 'utf8')
      expect(logContent).toContain('(no output)')
    })

    it('should truncate output preview to 500 chars', async () => {
      const longOutput = 'x'.repeat(1000)
      const run = makeAgentRun({ output: longOutput })
      await logStore.writeLog(run)

      const history = logStore.getHistory()
      expect(history[0]!.outputPreview.length).toBe(500)
    })

    it('should handle missing startedAt/finishedAt', async () => {
      const run = makeAgentRun({ startedAt: undefined, finishedAt: undefined })
      await logStore.writeLog(run)

      const history = logStore.getHistory()
      expect(history[0]!.durationSec).toBe(0)
      expect(history[0]!.startedAt).toBeTruthy()
      expect(history[0]!.finishedAt).toBeTruthy()
    })

    it('should prepend new entries (most recent first)', async () => {
      const run1 = makeAgentRun({
        repo: { ...makeAgentRun().repo, taskId: 'T-001' },
      })
      const run2 = makeAgentRun({
        repo: { ...makeAgentRun().repo, taskId: 'T-002' },
      })

      await logStore.writeLog(run1)
      await logStore.writeLog(run2)

      const history = logStore.getHistory()
      expect(history.length).toBe(2)
      expect(history[0]!.taskId).toBe('T-002')
      expect(history[1]!.taskId).toBe('T-001')
    })
  })

  describe('getHistory', () => {
    it('should return empty array when no history exists', () => {
      const history = logStore.getHistory()
      expect(history).toEqual([])
    })

    it('should respect limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        const run = makeAgentRun({
          repo: { ...makeAgentRun().repo, taskId: `T-${String(i + 1).padStart(3, '0')}` },
        })
        await logStore.writeLog(run)
      }

      const limited = logStore.getHistory(3)
      expect(limited.length).toBe(3)
    })

    it('should return all entries when limit is 0 or undefined', async () => {
      for (let i = 0; i < 3; i++) {
        await logStore.writeLog(makeAgentRun({
          repo: { ...makeAgentRun().repo, taskId: `T-${String(i + 1).padStart(3, '0')}` },
        }))
      }

      expect(logStore.getHistory().length).toBe(3)
      expect(logStore.getHistory(0).length).toBe(3)
    })
  })

  describe('clearOlderThan', () => {
    it('should remove entries older than specified days', async () => {
      // Write an entry with a finishedAt in the past
      const run = makeAgentRun({
        finishedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
      })
      await logStore.writeLog(run)

      // Write a recent entry
      const recentRun = makeAgentRun({
        repo: { ...makeAgentRun().repo, taskId: 'T-002' },
        finishedAt: new Date(), // now
      })
      await logStore.writeLog(recentRun)

      expect(logStore.getHistory().length).toBe(2)

      const removed = await logStore.clearOlderThan(7) // remove entries > 7 days old
      expect(removed).toBe(1)
      expect(logStore.getHistory().length).toBe(1)
      expect(logStore.getHistory()[0]!.taskId).toBe('T-002')
    })

    it('should delete log files on disk when clearing', async () => {
      const run = makeAgentRun({
        finishedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      })
      await logStore.writeLog(run)

      const logsDir = path.join(tmpDir, 'logs')
      expect(fs.readdirSync(logsDir).length).toBe(1)

      await logStore.clearOlderThan(7)
      expect(fs.readdirSync(logsDir).length).toBe(0)
    })

    it('should return 0 when nothing to clear', async () => {
      const run = makeAgentRun({ finishedAt: new Date() })
      await logStore.writeLog(run)

      const removed = await logStore.clearOlderThan(7)
      expect(removed).toBe(0)
      expect(logStore.getHistory().length).toBe(1)
    })
  })

  describe('max history cap', () => {
    it('should trim history to 100 entries', async () => {
      // Write 105 entries
      for (let i = 0; i < 105; i++) {
        await logStore.writeLog(makeAgentRun({
          repo: { ...makeAgentRun().repo, taskId: `T-${String(i).padStart(3, '0')}` },
        }))
      }

      const history = logStore.getHistory()
      expect(history.length).toBe(100)
      // Most recent should be T-104
      expect(history[0]!.taskId).toBe('T-104')
    })
  })

  describe('openLog', () => {
    it('should call vscode.workspace.openTextDocument with log path', async () => {
      const vscode = await import('vscode')
      const run = makeAgentRun()
      await logStore.writeLog(run)

      const entry = logStore.getHistory()[0]!
      await logStore.openLog(entry)

      expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(
        expect.stringContaining(entry.logFileName)
      )
      expect(vscode.window.showTextDocument).toHaveBeenCalled()
    })

    it('should show warning when log file is missing', async () => {
      const vscode = await import('vscode')
      vi.mocked(vscode.workspace.openTextDocument).mockRejectedValueOnce(new Error('not found'))

      const fakeEntry: AgentLogEntry = {
        id: 'test',
        repoName: 'repo',
        taskId: 'T-999',
        taskTitle: 'Missing',
        backend: 'claude',
        status: 'done',
        committed: true,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationSec: 10,
        tokens: { input: 0, output: 0, total: 0 },
        outputPreview: '',
        logFileName: 'nonexistent.log',
      }

      await logStore.openLog(fakeEntry)
      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('not found')
      )
    })
  })
})

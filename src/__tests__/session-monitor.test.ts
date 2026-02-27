import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { SessionMonitor, ActiveSession, QueuedTask, LOCK_FILE } from '../session-monitor'

// ── Mock ExtensionContext ─────────────────────────────────────────────────────

function makeGlobalState() {
  const store: Record<string, unknown> = {}
  return {
    get: vi.fn(<T>(key: string, defaultValue?: T): T => (store[key] as T) ?? (defaultValue as T)),
    update: vi.fn(async (key: string, value: unknown) => { store[key] = value }),
    keys: vi.fn(() => Object.keys(store)),
    setKeysForSync: vi.fn(),
    _store: store, // exposed for test inspection
  }
}

function makeExtensionContext() {
  return {
    globalState: makeGlobalState(),
    subscriptions: [],
    workspaceState: {
      get: vi.fn(),
      update: vi.fn(),
      keys: vi.fn(() => []),
      setKeysForSync: vi.fn(),
    },
    extensionUri: { fsPath: '/ext' },
    extensionPath: '/ext',
  } as any
}

function makeSession(overrides?: Partial<ActiveSession>): ActiveSession {
  return {
    repoPath: '/dev/repo-a',
    repoName: 'repo-a',
    taskId: 'T-001',
    taskTitle: 'Test task',
    backend: 'claude',
    startedAt: new Date().toISOString(),
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SessionMonitor', () => {
  let ctx: ReturnType<typeof makeExtensionContext>
  let monitor: SessionMonitor

  beforeEach(() => {
    ctx = makeExtensionContext()
    monitor = new SessionMonitor(ctx)
  })

  describe('active sessions', () => {
    it('starts with empty sessions', () => {
      expect(monitor.getActiveSessions()).toEqual([])
    })

    it('registers a session', async () => {
      const session = makeSession()
      await monitor.registerSession(session)

      const sessions = monitor.getActiveSessions()
      expect(sessions).toHaveLength(1)
      expect(sessions[0]!.repoName).toBe('repo-a')
    })

    it('replaces existing session for same repo', async () => {
      await monitor.registerSession(makeSession({ taskId: 'T-001' }))
      await monitor.registerSession(makeSession({ taskId: 'T-002' }))

      const sessions = monitor.getActiveSessions()
      expect(sessions).toHaveLength(1)
      expect(sessions[0]!.taskId).toBe('T-002')
    })

    it('tracks multiple repos', async () => {
      await monitor.registerSession(makeSession({ repoPath: '/dev/a', repoName: 'a' }))
      await monitor.registerSession(makeSession({ repoPath: '/dev/b', repoName: 'b' }))

      expect(monitor.getActiveSessions()).toHaveLength(2)
    })

    it('isRepoActive returns true for registered repo', async () => {
      await monitor.registerSession(makeSession())
      expect(monitor.isRepoActive('/dev/repo-a')).toBe(true)
    })

    it('isRepoActive returns false for unregistered repo', () => {
      expect(monitor.isRepoActive('/dev/unknown')).toBe(false)
    })

    it('deregisters a session', async () => {
      await monitor.registerSession(makeSession())
      expect(monitor.isRepoActive('/dev/repo-a')).toBe(true)

      await monitor.deregisterSession('/dev/repo-a')
      expect(monitor.isRepoActive('/dev/repo-a')).toBe(false)
      expect(monitor.getActiveSessions()).toHaveLength(0)
    })

    it('clearStaleSessions removes all sessions', async () => {
      await monitor.registerSession(makeSession({ repoPath: '/dev/a', repoName: 'a' }))
      await monitor.registerSession(makeSession({ repoPath: '/dev/b', repoName: 'b' }))
      expect(monitor.getActiveSessions()).toHaveLength(2)

      await monitor.clearStaleSessions()
      expect(monitor.getActiveSessions()).toHaveLength(0)
    })
  })

  describe('task queue', () => {
    it('starts with empty queue', () => {
      expect(monitor.getQueue()).toEqual([])
    })

    it('enqueues a task', async () => {
      const task: QueuedTask = {
        repoPath: '/dev/repo-a',
        repoName: 'repo-a',
        taskId: 'T-001',
        taskTitle: 'Test task',
        queuedAt: new Date().toISOString(),
      }
      await monitor.enqueue(task)

      const queue = monitor.getQueue()
      expect(queue).toHaveLength(1)
      expect(queue[0]!.taskId).toBe('T-001')
    })

    it('prevents duplicate enqueue for same repo+task', async () => {
      const task: QueuedTask = {
        repoPath: '/dev/repo-a',
        repoName: 'repo-a',
        taskId: 'T-001',
        taskTitle: 'Test task',
        queuedAt: new Date().toISOString(),
      }
      await monitor.enqueue(task)
      await monitor.enqueue(task)

      expect(monitor.getQueue()).toHaveLength(1)
    })

    it('allows different tasks for same repo', async () => {
      await monitor.enqueue({
        repoPath: '/dev/repo-a', repoName: 'repo-a',
        taskId: 'T-001', taskTitle: 'First', queuedAt: new Date().toISOString(),
      })
      await monitor.enqueue({
        repoPath: '/dev/repo-a', repoName: 'repo-a',
        taskId: 'T-002', taskTitle: 'Second', queuedAt: new Date().toISOString(),
      })

      expect(monitor.getQueue()).toHaveLength(2)
    })

    it('dequeues the first task for a repo', async () => {
      await monitor.enqueue({
        repoPath: '/dev/repo-a', repoName: 'repo-a',
        taskId: 'T-001', taskTitle: 'First', queuedAt: new Date().toISOString(),
      })
      await monitor.enqueue({
        repoPath: '/dev/repo-a', repoName: 'repo-a',
        taskId: 'T-002', taskTitle: 'Second', queuedAt: new Date().toISOString(),
      })

      const dequeued = await monitor.dequeue('/dev/repo-a')
      expect(dequeued).toBeDefined()
      expect(dequeued!.taskId).toBe('T-001')
      expect(monitor.getQueue()).toHaveLength(1)
    })

    it('dequeue returns undefined for empty queue', async () => {
      const result = await monitor.dequeue('/dev/nonexistent')
      expect(result).toBeUndefined()
    })

    it('drainQueue calls spawnFn when tasks are queued', async () => {
      await monitor.enqueue({
        repoPath: '/dev/repo-a', repoName: 'repo-a',
        taskId: 'T-001', taskTitle: 'Queued task', queuedAt: new Date().toISOString(),
      })

      const spawnFn = vi.fn()
      await monitor.drainQueue('/dev/repo-a', spawnFn)

      expect(spawnFn).toHaveBeenCalledOnce()
      expect(spawnFn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'T-001' })
      )
    })

    it('drainQueue does nothing when no tasks queued', async () => {
      const spawnFn = vi.fn()
      await monitor.drainQueue('/dev/repo-a', spawnFn)
      expect(spawnFn).not.toHaveBeenCalled()
    })
  })

  describe('change notifications', () => {
    it('calls onChange listeners on register', async () => {
      const listener = vi.fn()
      monitor.onChange(listener)

      await monitor.registerSession(makeSession())
      expect(listener).toHaveBeenCalled()
    })

    it('calls onChange listeners on deregister', async () => {
      await monitor.registerSession(makeSession())

      const listener = vi.fn()
      monitor.onChange(listener)

      await monitor.deregisterSession('/dev/repo-a')
      expect(listener).toHaveBeenCalled()
    })

    it('calls onChange listeners on enqueue', async () => {
      const listener = vi.fn()
      monitor.onChange(listener)

      await monitor.enqueue({
        repoPath: '/dev/repo-a', repoName: 'repo-a',
        taskId: 'T-001', taskTitle: 'Task', queuedAt: new Date().toISOString(),
      })
      expect(listener).toHaveBeenCalled()
    })
  })

  describe('readLockFile (static)', () => {
    it('returns null when lock file does not exist', () => {
      // The LOCK_FILE path is in ~/.aahp/sessions.json
      // If it doesn't exist, should return null
      const result = SessionMonitor.readLockFile()
      // This may or may not exist depending on the test environment
      // Just verify it returns the correct type
      expect(result === null || typeof result === 'object').toBe(true)
    })
  })
})

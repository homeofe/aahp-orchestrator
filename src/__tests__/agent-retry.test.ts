import { describe, it, expect, beforeEach } from 'vitest'
import { retryDelay, getMaxRetries, AgentRun, RepoTask } from '../agent-spawner'
import { __setConfig, __clearConfig } from 'vscode'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRepoTask(overrides?: Partial<RepoTask>): RepoTask {
  return {
    repoPath: '/dev/my-repo',
    repoName: 'my-repo',
    manifestPath: '/dev/my-repo/.ai/handoff/MANIFEST.json',
    taskId: 'T-001',
    taskTitle: 'Add tests',
    phase: 'implementation',
    quickContext: 'A test repo',
    taskPriority: 'medium',
    ...overrides,
  }
}

function makeAgentRun(overrides?: Partial<AgentRun>): AgentRun {
  return {
    repo: makeRepoTask(),
    status: 'queued',
    backend: 'claude',
    output: '',
    committed: false,
    tokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    retryCount: 0,
    maxRetries: 1,
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('retryDelay', () => {
  it('returns base delay for attempt 0', () => {
    expect(retryDelay(0, 30000)).toBe(30000)
  })

  it('doubles delay for each subsequent attempt', () => {
    expect(retryDelay(1, 30000)).toBe(60000)
    expect(retryDelay(2, 30000)).toBe(120000)
    expect(retryDelay(3, 30000)).toBe(240000)
  })

  it('caps delay at 5 minutes', () => {
    // 30000 * 2^10 = 30,720,000 - should be capped at 300,000
    expect(retryDelay(10, 30000)).toBe(300000)
  })

  it('uses custom base delay', () => {
    expect(retryDelay(0, 1000)).toBe(1000)
    expect(retryDelay(1, 1000)).toBe(2000)
    expect(retryDelay(2, 1000)).toBe(4000)
  })

  it('returns 5 minutes for very large attempt numbers', () => {
    expect(retryDelay(100, 30000)).toBe(300000)
  })
})

describe('getMaxRetries', () => {
  beforeEach(() => {
    __clearConfig()
  })

  it('returns default of 1 when not configured', () => {
    expect(getMaxRetries()).toBe(1)
  })

  it('returns configured value', () => {
    __setConfig('aahp.agentMaxRetries', 3)
    expect(getMaxRetries()).toBe(3)
  })

  it('returns 0 when retries are disabled', () => {
    __setConfig('aahp.agentMaxRetries', 0)
    expect(getMaxRetries()).toBe(0)
  })
})

describe('AgentRun retry fields', () => {
  it('initializes with retryCount 0 and maxRetries from config', () => {
    const run = makeAgentRun()
    expect(run.retryCount).toBe(0)
    expect(run.maxRetries).toBe(1)
  })

  it('tracks retry attempts', () => {
    const run = makeAgentRun({ maxRetries: 3 })
    run.retryCount = 1
    expect(run.retryCount).toBe(1)
    run.retryCount = 2
    expect(run.retryCount).toBe(2)
  })

  it('can have retries disabled with maxRetries 0', () => {
    const run = makeAgentRun({ maxRetries: 0 })
    expect(run.maxRetries).toBe(0)
  })

  it('preserves all original AgentRun fields', () => {
    const run = makeAgentRun({
      status: 'running',
      backend: 'copilot',
      output: 'some output',
      committed: true,
      tokens: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
      retryCount: 2,
      maxRetries: 3,
    })
    expect(run.status).toBe('running')
    expect(run.backend).toBe('copilot')
    expect(run.output).toBe('some output')
    expect(run.committed).toBe(true)
    expect(run.tokens.totalTokens).toBe(300)
    expect(run.retryCount).toBe(2)
    expect(run.maxRetries).toBe(3)
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  scanAllRepos,
  pickBackend,
  buildAgentPrompt,
  RepoTask,
  sessionTokens,
} from '../agent-spawner'
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

function makeMinimalManifest(tasks?: Record<string, { status: string; title: string; priority?: string }>) {
  return {
    aahp_version: '3',
    project: 'test',
    last_session: {
      agent: 'claude-code',
      timestamp: '2026-01-01T00:00:00Z',
      commit: 'abc',
      phase: 'implementation',
      duration_minutes: 10,
    },
    files: {},
    quick_context: 'Test repo',
    token_budget: { manifest_only: 500, full_read: 2000 },
    tasks,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('scanAllRepos', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aahp-scan-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns empty array for non-existent directory', () => {
    expect(scanAllRepos('/does/not/exist')).toEqual([])
  })

  it('returns empty array when no repos have manifests', () => {
    fs.mkdirSync(path.join(tmpDir, 'repo-a'))
    fs.mkdirSync(path.join(tmpDir, 'repo-b'))
    expect(scanAllRepos(tmpDir)).toEqual([])
  })

  it('finds repos with ready tasks', () => {
    const repoDir = path.join(tmpDir, 'my-repo')
    const handoff = path.join(repoDir, '.ai', 'handoff')
    fs.mkdirSync(handoff, { recursive: true })
    fs.writeFileSync(
      path.join(handoff, 'MANIFEST.json'),
      JSON.stringify(makeMinimalManifest({
        'T-001': { status: 'ready', title: 'Add tests', priority: 'high' },
      })),
      'utf8'
    )

    const results = scanAllRepos(tmpDir)
    expect(results).toHaveLength(1)
    expect(results[0]!.repoName).toBe('my-repo')
    expect(results[0]!.taskId).toBe('T-001')
    expect(results[0]!.taskTitle).toBe('Add tests')
    expect(results[0]!.taskPriority).toBe('high')
  })

  it('finds repos with in_progress tasks', () => {
    const repoDir = path.join(tmpDir, 'active-repo')
    const handoff = path.join(repoDir, '.ai', 'handoff')
    fs.mkdirSync(handoff, { recursive: true })
    fs.writeFileSync(
      path.join(handoff, 'MANIFEST.json'),
      JSON.stringify(makeMinimalManifest({
        'T-002': { status: 'in_progress', title: 'Working on it' },
      })),
      'utf8'
    )

    const results = scanAllRepos(tmpDir)
    expect(results).toHaveLength(1)
    expect(results[0]!.taskId).toBe('T-002')
  })

  it('skips repos where all tasks are done or blocked', () => {
    const repoDir = path.join(tmpDir, 'done-repo')
    const handoff = path.join(repoDir, '.ai', 'handoff')
    fs.mkdirSync(handoff, { recursive: true })
    fs.writeFileSync(
      path.join(handoff, 'MANIFEST.json'),
      JSON.stringify(makeMinimalManifest({
        'T-001': { status: 'done', title: 'Already done' },
        'T-002': { status: 'blocked', title: 'Still blocked' },
      })),
      'utf8'
    )

    expect(scanAllRepos(tmpDir)).toEqual([])
  })

  it('skips repos with malformed manifest JSON', () => {
    const repoDir = path.join(tmpDir, 'bad-repo')
    const handoff = path.join(repoDir, '.ai', 'handoff')
    fs.mkdirSync(handoff, { recursive: true })
    fs.writeFileSync(path.join(handoff, 'MANIFEST.json'), '{bad json', 'utf8')

    expect(scanAllRepos(tmpDir)).toEqual([])
  })

  it('skips non-directory entries', () => {
    // Create a file (not directory) in the scan root
    fs.writeFileSync(path.join(tmpDir, 'not-a-dir.txt'), 'hello', 'utf8')
    expect(scanAllRepos(tmpDir)).toEqual([])
  })

  it('scans multiple repos and returns only those with ready tasks', () => {
    // Repo with ready task
    const repo1 = path.join(tmpDir, 'repo-ready')
    fs.mkdirSync(path.join(repo1, '.ai', 'handoff'), { recursive: true })
    fs.writeFileSync(
      path.join(repo1, '.ai', 'handoff', 'MANIFEST.json'),
      JSON.stringify(makeMinimalManifest({ 'T-001': { status: 'ready', title: 'Go' } })),
      'utf8'
    )

    // Repo with done task
    const repo2 = path.join(tmpDir, 'repo-done')
    fs.mkdirSync(path.join(repo2, '.ai', 'handoff'), { recursive: true })
    fs.writeFileSync(
      path.join(repo2, '.ai', 'handoff', 'MANIFEST.json'),
      JSON.stringify(makeMinimalManifest({ 'T-001': { status: 'done', title: 'Done' } })),
      'utf8'
    )

    // Repo without manifest
    fs.mkdirSync(path.join(tmpDir, 'repo-empty'))

    const results = scanAllRepos(tmpDir)
    expect(results).toHaveLength(1)
    expect(results[0]!.repoName).toBe('repo-ready')
  })
})

describe('pickBackend', () => {
  beforeEach(() => {
    __clearConfig()
    // Reset the cached backend by importing a fresh module state
    // The cachedBackendSetting is module-level, but pickBackend reads config on first call
  })

  it('returns claude for high-priority in auto mode', () => {
    __setConfig('aahp.agentBackend', 'auto')
    const result = pickBackend(makeRepoTask({ taskPriority: 'high' }))
    expect(result).toBe('claude')
  })

  it('returns copilot for medium-priority in auto mode', () => {
    // Note: pickBackend caches the setting, so it may retain 'auto' from above
    const result = pickBackend(makeRepoTask({ taskPriority: 'medium' }))
    expect(result).toBe('copilot')
  })

  it('returns copilot for low-priority in auto mode', () => {
    const result = pickBackend(makeRepoTask({ taskPriority: 'low' }))
    expect(result).toBe('copilot')
  })
})

describe('buildAgentPrompt', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aahp-prompt-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('includes repo name, phase, and task info', () => {
    const handoff = path.join(tmpDir, '.ai', 'handoff')
    fs.mkdirSync(handoff, { recursive: true })
    fs.writeFileSync(
      path.join(handoff, 'MANIFEST.json'),
      JSON.stringify(makeMinimalManifest({
        'T-001': { status: 'ready', title: 'Add tests', priority: 'high' },
      })),
      'utf8'
    )

    const repo = makeRepoTask({
      repoPath: tmpDir,
      repoName: 'test-repo',
      manifestPath: path.join(handoff, 'MANIFEST.json'),
      taskId: 'T-001',
      taskTitle: 'Add tests',
      phase: 'implementation',
      quickContext: 'Testing project',
    })

    const prompt = buildAgentPrompt(repo)
    expect(prompt).toContain('test-repo')
    expect(prompt).toContain('Phase: implementation')
    expect(prompt).toContain('[T-001] Add tests')
    expect(prompt).toContain('Testing project')
    expect(prompt).toContain('Work autonomously')
  })

  it('includes conventions when file exists', () => {
    const handoff = path.join(tmpDir, '.ai', 'handoff')
    fs.mkdirSync(handoff, { recursive: true })
    fs.writeFileSync(
      path.join(handoff, 'MANIFEST.json'),
      JSON.stringify(makeMinimalManifest({ 'T-001': { status: 'ready', title: 'Go' } })),
      'utf8'
    )
    fs.writeFileSync(path.join(handoff, 'CONVENTIONS.md'), '# Code Style\nUse TypeScript', 'utf8')

    const repo = makeRepoTask({
      repoPath: tmpDir,
      manifestPath: path.join(handoff, 'MANIFEST.json'),
    })

    const prompt = buildAgentPrompt(repo)
    expect(prompt).toContain('Code Style')
    expect(prompt).toContain('Use TypeScript')
  })

  it('shows (none) when conventions file missing', () => {
    const handoff = path.join(tmpDir, '.ai', 'handoff')
    fs.mkdirSync(handoff, { recursive: true })
    fs.writeFileSync(
      path.join(handoff, 'MANIFEST.json'),
      JSON.stringify(makeMinimalManifest({ 'T-001': { status: 'ready', title: 'Go' } })),
      'utf8'
    )

    const repo = makeRepoTask({
      repoPath: tmpDir,
      manifestPath: path.join(handoff, 'MANIFEST.json'),
    })

    const prompt = buildAgentPrompt(repo)
    expect(prompt).toContain('## Conventions\n(none)')
  })
})

describe('sessionTokens', () => {
  it('has initial zero values for both backends', () => {
    // sessionTokens is a module-level export - verify shape
    expect(sessionTokens.claude).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })
    expect(sessionTokens.copilot).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })
  })
})

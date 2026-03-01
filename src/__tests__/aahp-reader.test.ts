import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  AahpManifest,
  AahpContext,
  AahpTask,
  getTopTask,
  buildSystemPrompt,
  loadAahpContext,
  loadAahpContextByPath,
  scanAllRepoOverviews,
  refreshManifestChecksums,
  saveManifest,
  getWorkspaceRoot,
} from '../aahp-reader'
import { workspace } from 'vscode'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeManifest(overrides?: Partial<AahpManifest>): AahpManifest {
  return {
    aahp_version: '3',
    project: 'test-project',
    last_session: {
      agent: 'claude-code',
      timestamp: '2026-02-27T10:00:00Z',
      commit: 'abc1234',
      phase: 'implementation',
      duration_minutes: 30,
    },
    files: {},
    quick_context: 'A test project for unit testing',
    token_budget: { manifest_only: 500, full_read: 2000 },
    ...overrides,
  }
}

function makeTask(overrides?: Partial<AahpTask>): AahpTask {
  return {
    title: 'Test task',
    status: 'ready',
    priority: 'medium',
    depends_on: [],
    created: '2026-02-27T10:00:00Z',
    ...overrides,
  }
}

function makeContext(overrides?: Partial<AahpContext>): AahpContext {
  return {
    manifest: makeManifest(),
    handoffDir: '/tmp/test/.ai/handoff',
    status: undefined,
    nextActions: undefined,
    conventions: undefined,
    trust: undefined,
    workflowMd: undefined,
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('getTopTask', () => {
  it('returns undefined when no tasks exist', () => {
    const manifest = makeManifest({ tasks: undefined })
    expect(getTopTask(manifest)).toBeUndefined()
  })

  it('returns undefined when tasks is empty object', () => {
    const manifest = makeManifest({ tasks: {} })
    expect(getTopTask(manifest)).toBeUndefined()
  })

  it('returns the in_progress task over a ready task', () => {
    const manifest = makeManifest({
      tasks: {
        'T-001': makeTask({ title: 'Ready task', status: 'ready', priority: 'high' }),
        'T-002': makeTask({ title: 'Active task', status: 'in_progress', priority: 'medium' }),
      },
    })
    const result = getTopTask(manifest)
    expect(result).toBeDefined()
    expect(result![0]).toBe('T-002')
    expect(result![1].title).toBe('Active task')
  })

  it('returns the first ready task when none is in_progress', () => {
    const manifest = makeManifest({
      tasks: {
        'T-001': makeTask({ title: 'Done task', status: 'done' }),
        'T-002': makeTask({ title: 'Ready task', status: 'ready' }),
        'T-003': makeTask({ title: 'Blocked task', status: 'blocked' }),
      },
    })
    const result = getTopTask(manifest)
    expect(result).toBeDefined()
    expect(result![0]).toBe('T-002')
    expect(result![1].status).toBe('ready')
  })

  it('returns undefined when all tasks are done or blocked', () => {
    const manifest = makeManifest({
      tasks: {
        'T-001': makeTask({ status: 'done' }),
        'T-002': makeTask({ status: 'blocked' }),
      },
    })
    expect(getTopTask(manifest)).toBeUndefined()
  })
})

describe('buildSystemPrompt', () => {
  it('includes project name and phase', () => {
    const ctx = makeContext()
    const prompt = buildSystemPrompt(ctx)
    expect(prompt).toContain('test-project')
    expect(prompt).toContain('Phase: implementation')
  })

  it('includes quick context', () => {
    const ctx = makeContext()
    const prompt = buildSystemPrompt(ctx)
    expect(prompt).toContain('A test project for unit testing')
  })

  it('includes last agent info', () => {
    const ctx = makeContext()
    const prompt = buildSystemPrompt(ctx)
    expect(prompt).toContain('Last agent: claude-code')
    expect(prompt).toContain('2026-02-27T10:00:00Z')
  })

  it('shows "No active task" when no tasks exist', () => {
    const ctx = makeContext()
    const prompt = buildSystemPrompt(ctx)
    expect(prompt).toContain('No active task')
  })

  it('includes current task when tasks exist', () => {
    const ctx = makeContext({
      manifest: makeManifest({
        tasks: {
          'T-001': makeTask({ title: 'Add tests', status: 'in_progress' }),
        },
      }),
    })
    const prompt = buildSystemPrompt(ctx)
    expect(prompt).toContain('[T-001] Add tests (in_progress)')
  })

  it('lists open tasks (excludes done)', () => {
    const ctx = makeContext({
      manifest: makeManifest({
        tasks: {
          'T-001': makeTask({ title: 'Done one', status: 'done' }),
          'T-002': makeTask({ title: 'Ready one', status: 'ready' }),
          'T-003': makeTask({ title: 'Blocked one', status: 'blocked' }),
        },
      }),
    })
    const prompt = buildSystemPrompt(ctx)
    expect(prompt).toContain('T-002: [ready] Ready one')
    expect(prompt).toContain('T-003: [blocked] Blocked one')
    expect(prompt).not.toContain('T-001: [done]')
  })

  it('includes conventions summary (first 50 lines)', () => {
    const longConventions = Array(100).fill('convention line').join('\n')
    const ctx = makeContext({ conventions: longConventions })
    const prompt = buildSystemPrompt(ctx)
    expect(prompt).toContain('### Conventions (summary)')
    // 50 lines of "convention line" included
    const conventionMatches = prompt.match(/convention line/g)
    expect(conventionMatches?.length).toBe(50)
  })

  it('includes trust state summary (first 20 lines)', () => {
    const longTrust = Array(40).fill('trust line').join('\n')
    const ctx = makeContext({ trust: longTrust })
    const prompt = buildSystemPrompt(ctx)
    expect(prompt).toContain('### Trust State (summary)')
    const trustMatches = prompt.match(/trust line/g)
    expect(trustMatches?.length).toBe(20)
  })

  it('omits conventions section when undefined', () => {
    const ctx = makeContext({ conventions: undefined })
    const prompt = buildSystemPrompt(ctx)
    expect(prompt).not.toContain('Conventions')
  })

  it('ends with action instruction', () => {
    const ctx = makeContext()
    const prompt = buildSystemPrompt(ctx)
    expect(prompt).toContain('Do NOT ask for clarification')
  })
})

describe('loadAahpContext', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aahp-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns undefined when no handoff dir exists', () => {
    const result = loadAahpContext(tmpDir)
    expect(result).toBeUndefined()
  })

  it('returns undefined when MANIFEST.json is malformed', () => {
    const handoff = path.join(tmpDir, '.ai', 'handoff')
    fs.mkdirSync(handoff, { recursive: true })
    fs.writeFileSync(path.join(handoff, 'MANIFEST.json'), 'not-json', 'utf8')
    const result = loadAahpContext(tmpDir)
    expect(result).toBeUndefined()
  })

  it('loads manifest from direct .ai/handoff/', () => {
    const handoff = path.join(tmpDir, '.ai', 'handoff')
    fs.mkdirSync(handoff, { recursive: true })
    const manifest = makeManifest()
    fs.writeFileSync(path.join(handoff, 'MANIFEST.json'), JSON.stringify(manifest), 'utf8')

    const result = loadAahpContext(tmpDir)
    expect(result).toBeDefined()
    expect(result!.manifest.project).toBe('test-project')
    expect(result!.handoffDir).toBe(handoff)
  })

  it('reads optional files (STATUS.md, CONVENTIONS.md, etc.)', () => {
    const handoff = path.join(tmpDir, '.ai', 'handoff')
    fs.mkdirSync(handoff, { recursive: true })
    fs.writeFileSync(path.join(handoff, 'MANIFEST.json'), JSON.stringify(makeManifest()), 'utf8')
    fs.writeFileSync(path.join(handoff, 'STATUS.md'), '# Status\nAll good', 'utf8')
    fs.writeFileSync(path.join(handoff, 'CONVENTIONS.md'), '# Conventions\nUse TypeScript', 'utf8')
    fs.writeFileSync(path.join(handoff, 'TRUST.md'), '# Trust\nVerified', 'utf8')

    const result = loadAahpContext(tmpDir)
    expect(result).toBeDefined()
    expect(result!.status).toBe('# Status\nAll good')
    expect(result!.conventions).toBe('# Conventions\nUse TypeScript')
    expect(result!.trust).toBe('# Trust\nVerified')
    expect(result!.nextActions).toBeUndefined()
    expect(result!.workflowMd).toBeUndefined()
  })
})

describe('refreshManifestChecksums', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aahp-checksum-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('updates checksum and line count for existing files', () => {
    fs.writeFileSync(path.join(tmpDir, 'STATUS.md'), 'line1\nline2\nline3', 'utf8')

    const manifest = makeManifest({
      files: {
        'STATUS.md': {
          checksum: 'sha256:old',
          updated: '2026-01-01T00:00:00Z',
          lines: 1,
          summary: 'Status file',
        },
      },
    })
    const ctx = makeContext({ manifest, handoffDir: tmpDir })

    const updated = refreshManifestChecksums(ctx)
    const entry = updated.files['STATUS.md']
    expect(entry).toBeDefined()
    expect(entry!.checksum).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(entry!.checksum).not.toBe('sha256:old')
    expect(entry!.lines).toBe(3)
    expect(entry!.summary).toBe('Status file') // summary preserved
  })

  it('does not modify original manifest', () => {
    fs.writeFileSync(path.join(tmpDir, 'STATUS.md'), 'content', 'utf8')

    const manifest = makeManifest({
      files: {
        'STATUS.md': { checksum: 'sha256:old', updated: 'old', lines: 0, summary: '' },
      },
    })
    const ctx = makeContext({ manifest, handoffDir: tmpDir })

    refreshManifestChecksums(ctx)
    expect(manifest.files['STATUS.md']!.checksum).toBe('sha256:old')
  })

  it('skips files that do not exist on disk', () => {
    const manifest = makeManifest({
      files: {
        'MISSING.md': { checksum: 'sha256:old', updated: 'old', lines: 0, summary: '' },
      },
    })
    const ctx = makeContext({ manifest, handoffDir: tmpDir })

    const updated = refreshManifestChecksums(ctx)
    expect(updated.files['MISSING.md']!.checksum).toBe('sha256:old')
  })
})

describe('saveManifest', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aahp-save-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('writes manifest as formatted JSON with trailing newline', () => {
    const manifest = makeManifest()
    const ctx = makeContext({ manifest, handoffDir: tmpDir })

    saveManifest(ctx, manifest)

    const written = fs.readFileSync(path.join(tmpDir, 'MANIFEST.json'), 'utf8')
    expect(written.endsWith('\n')).toBe(true)

    const parsed = JSON.parse(written)
    expect(parsed.project).toBe('test-project')
    expect(parsed.aahp_version).toBe('3')
  })
})

describe('getWorkspaceRoot', () => {
  it('returns undefined when no workspace folders', () => {
    workspace.workspaceFolders = undefined
    expect(getWorkspaceRoot()).toBeUndefined()
  })

  it('returns first folder fsPath', () => {
    workspace.workspaceFolders = [
      { uri: { fsPath: '/my/workspace' }, name: 'ws', index: 0 },
    ]
    expect(getWorkspaceRoot()).toBe('/my/workspace')
  })
})

// ── scanAllRepoOverviews ──────────────────────────────────────────────────────

describe('scanAllRepoOverviews', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aahp-scan-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function createRepo(name: string, manifest: AahpManifest): void {
    const handoff = path.join(tmpDir, name, '.ai', 'handoff')
    fs.mkdirSync(handoff, { recursive: true })
    fs.writeFileSync(path.join(handoff, 'MANIFEST.json'), JSON.stringify(manifest), 'utf8')
  }

  it('returns empty array for non-existent directory', () => {
    expect(scanAllRepoOverviews('/non/existent/path')).toEqual([])
  })

  it('returns empty array when no repos have manifests', () => {
    fs.mkdirSync(path.join(tmpDir, 'some-repo'))
    expect(scanAllRepoOverviews(tmpDir)).toEqual([])
  })

  it('returns all repos with manifests', () => {
    createRepo('repo-a', makeManifest({ project: 'repo-a' }))
    createRepo('repo-b', makeManifest({ project: 'repo-b' }))
    const results = scanAllRepoOverviews(tmpDir)
    expect(results.length).toBe(2)
  })

  it('computes correct task counts', () => {
    createRepo('repo-tasks', makeManifest({
      project: 'repo-tasks',
      tasks: {
        'T-001': makeTask({ status: 'done' }),
        'T-002': makeTask({ status: 'ready' }),
        'T-003': makeTask({ status: 'in_progress' }),
        'T-004': makeTask({ status: 'blocked' }),
        'T-005': makeTask({ status: 'pending' }),
      },
    }))

    const results = scanAllRepoOverviews(tmpDir)
    expect(results.length).toBe(1)
    const counts = results[0]!.taskCounts
    expect(counts.total).toBe(5)
    expect(counts.done).toBe(1)
    expect(counts.ready).toBe(1)
    expect(counts.inProgress).toBe(1)
    expect(counts.blocked).toBe(1)
    expect(counts.pending).toBe(1)
  })

  it('sets health to healthy for recent activity', () => {
    createRepo('recent', makeManifest({
      project: 'recent',
      last_session: {
        agent: 'claude-code',
        timestamp: new Date().toISOString(),
        commit: 'abc',
        phase: 'implementation',
        duration_minutes: 5,
      },
      tasks: { 'T-001': makeTask() },
    }))

    const results = scanAllRepoOverviews(tmpDir)
    expect(results[0]!.health).toBe('healthy')
  })

  it('sets health to stale for old activity', () => {
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
    createRepo('old', makeManifest({
      project: 'old',
      last_session: {
        agent: 'claude-code',
        timestamp: oldDate,
        commit: 'abc',
        phase: 'implementation',
        duration_minutes: 5,
      },
      tasks: { 'T-001': makeTask() },
    }))

    const results = scanAllRepoOverviews(tmpDir)
    expect(results[0]!.health).toBe('stale')
  })

  it('sets health to no-tasks when tasks object is empty', () => {
    createRepo('empty-tasks', makeManifest({ project: 'empty-tasks', tasks: {} }))
    const results = scanAllRepoOverviews(tmpDir)
    expect(results[0]!.health).toBe('no-tasks')
  })

  it('sorts repos: in_progress first, then ready, then alphabetical', () => {
    createRepo('z-repo', makeManifest({
      project: 'z-repo',
      tasks: { 'T-001': makeTask({ status: 'ready' }) },
    }))
    createRepo('a-repo', makeManifest({
      project: 'a-repo',
      tasks: { 'T-001': makeTask({ status: 'done' }) },
    }))
    createRepo('m-repo', makeManifest({
      project: 'm-repo',
      tasks: { 'T-001': makeTask({ status: 'in_progress' }) },
    }))

    const results = scanAllRepoOverviews(tmpDir)
    expect(results.map(r => r.repoName)).toEqual(['m-repo', 'z-repo', 'a-repo'])
  })

  it('uses MANIFEST status for NEXT_ACTIONS items with known task IDs', () => {
    const repoName = 'repo-next-actions'
    createRepo(repoName, makeManifest({
      project: repoName,
      tasks: {
        'T-006': makeTask({ title: 'Publish npm package', status: 'done' }),
      },
    }))

    const handoff = path.join(tmpDir, repoName, '.ai', 'handoff')
    fs.writeFileSync(
      path.join(handoff, 'NEXT_ACTIONS.md'),
      [
        '# Next Actions',
        '',
        '## Ready - Work These Next',
        '### T-006: Publish npm package',
      ].join('\n'),
      'utf8'
    )

    const results = scanAllRepoOverviews(tmpDir)
    expect(results).toHaveLength(1)
    expect(results[0]!.nextActions).toHaveLength(1)
    expect(results[0]!.nextActions[0]!.taskId).toBe('T-006')
    expect(results[0]!.nextActions[0]!.section).toBe('done')
  })

  it('skips directories without manifest', () => {
    createRepo('has-manifest', makeManifest({ project: 'has-manifest' }))
    fs.mkdirSync(path.join(tmpDir, 'no-manifest'))
    const results = scanAllRepoOverviews(tmpDir)
    expect(results.length).toBe(1)
    expect(results[0]!.repoName).toBe('has-manifest')
  })

  it('skips malformed manifests', () => {
    const handoff = path.join(tmpDir, 'bad-repo', '.ai', 'handoff')
    fs.mkdirSync(handoff, { recursive: true })
    fs.writeFileSync(path.join(handoff, 'MANIFEST.json'), '{invalid', 'utf8')
    expect(scanAllRepoOverviews(tmpDir)).toEqual([])
  })
})

// ── loadAahpContextByPath ─────────────────────────────────────────────────────

describe('loadAahpContextByPath', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aahp-bypath-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('loads context from explicit handoff directory', () => {
    fs.writeFileSync(path.join(tmpDir, 'MANIFEST.json'), JSON.stringify(makeManifest()), 'utf8')
    const result = loadAahpContextByPath(tmpDir)
    expect(result).toBeDefined()
    expect(result!.manifest.project).toBe('test-project')
    expect(result!.handoffDir).toBe(tmpDir)
  })

  it('returns undefined for non-existent directory', () => {
    expect(loadAahpContextByPath('/non/existent')).toBeUndefined()
  })

  it('returns undefined for malformed manifest', () => {
    fs.writeFileSync(path.join(tmpDir, 'MANIFEST.json'), 'not-json', 'utf8')
    expect(loadAahpContextByPath(tmpDir)).toBeUndefined()
  })

  it('reads optional files (STATUS.md etc.)', () => {
    fs.writeFileSync(path.join(tmpDir, 'MANIFEST.json'), JSON.stringify(makeManifest()), 'utf8')
    fs.writeFileSync(path.join(tmpDir, 'STATUS.md'), '# Status', 'utf8')
    fs.writeFileSync(path.join(tmpDir, 'NEXT_ACTIONS.md'), '# Next', 'utf8')

    const result = loadAahpContextByPath(tmpDir)
    expect(result).toBeDefined()
    expect(result!.status).toBe('# Status')
    expect(result!.nextActions).toBe('# Next')
    expect(result!.conventions).toBeUndefined()
  })
})

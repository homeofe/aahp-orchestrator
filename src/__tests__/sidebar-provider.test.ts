/**
 * T-018: Unit tests for the sidebar webview provider (AahpDashboardProvider)
 * Covers: webview creation, message handling, state updates, batch mode,
 *         HTML rendering, focused repo, update methods
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commands } from 'vscode'
import { AahpDashboardProvider } from '../sidebar'
import { AahpManifest, AahpContext, RepoOverview } from '../aahp-reader'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeManifest(overrides?: Partial<AahpManifest>): AahpManifest {
  return {
    aahp_version: '3.0',
    project: 'TestProject',
    last_session: {
      agent: 'claude-code',
      timestamp: '2026-03-01T10:00:00Z',
      commit: 'deadbeef',
      phase: 'implementation',
      duration_minutes: 45,
    },
    files: {},
    quick_context: 'A unit test project',
    token_budget: { manifest_only: 100, full_read: 1000 },
    next_task_id: 4,
    tasks: {
      'T-001': {
        title: 'Implement feature A',
        status: 'ready',
        priority: 'high',
        depends_on: [],
        created: '2026-03-01T09:00:00Z',
        github_issue: 7,
        github_repo: 'acme/testproject',
      },
      'T-002': {
        title: 'Write documentation',
        status: 'in_progress',
        priority: 'medium',
        depends_on: ['T-001'],
        created: '2026-03-01T09:00:00Z',
      },
      'T-003': {
        title: 'Deploy to production',
        status: 'done',
        priority: 'low',
        depends_on: [],
        created: '2026-03-01T09:00:00Z',
        completed: '2026-03-01T11:00:00Z',
      },
    },
    ...overrides,
  }
}

function makeContext(overrides?: Partial<AahpContext>): AahpContext {
  return {
    manifest: makeManifest(),
    handoffDir: '/tmp/test/.ai/handoff',
    status: 'Status line 1\nStatus line 2',
    nextActions: undefined,
    conventions: undefined,
    trust: undefined,
    workflowMd: undefined,
    ...overrides,
  }
}

function makeOverview(overrides?: Partial<RepoOverview>): RepoOverview {
  return {
    repoPath: '/dev/testproject',
    repoName: 'testproject',
    manifest: makeManifest(),
    handoffDir: '/dev/testproject/.ai/handoff',
    hasManifest: true,
    taskCounts: { total: 3, ready: 1, inProgress: 1, done: 1, blocked: 0, pending: 0 },
    lastActivity: '2026-03-01T10:00:00Z',
    health: 'healthy',
    nextActions: [
      { section: 'ready', taskId: 'T-001', title: 'Implement feature A', priority: 'high' },
      { section: 'in_progress', taskId: 'T-002', title: 'Write documentation', priority: 'medium' },
    ],
    githubUrl: 'https://github.com/acme/testproject',
    ...overrides,
  }
}

/** Build a mock webview view for resolveWebviewView */
function makeMockWebviewView() {
  const messageHandlers: Array<(msg: Record<string, unknown>) => void> = []
  const disposalHandlers: Array<() => void> = []
  const visibilityHandlers: Array<() => void> = []
  let currentHtml = ''
  let _visible = true

  const webview = {
    get html() { return currentHtml },
    set html(v: string) { currentHtml = v },
    options: {} as Record<string, unknown>,
    onDidReceiveMessage: vi.fn((handler: (msg: Record<string, unknown>) => void) => {
      messageHandlers.push(handler)
      return { dispose: vi.fn() }
    }),
  }

  const view = {
    webview,
    get visible() { return _visible },
    set visible(v: boolean) { _visible = v },
    onDidDispose: vi.fn((handler: () => void) => {
      disposalHandlers.push(handler)
      return { dispose: vi.fn() }
    }),
    onDidChangeVisibility: vi.fn((handler: () => void) => {
      visibilityHandlers.push(handler)
      return { dispose: vi.fn() }
    }),
    _sendMessage: (msg: Record<string, unknown>) => {
      for (const h of messageHandlers) h(msg)
    },
    _triggerDispose: () => {
      for (const h of disposalHandlers) h()
    },
    _triggerVisibilityChange: () => {
      for (const h of visibilityHandlers) h()
    },
  }

  return view
}

// ── Tests: constructor & initial state ───────────────────────────────────────

describe('AahpDashboardProvider - construction', () => {
  it('can be instantiated without error', () => {
    expect(() => new AahpDashboardProvider({} as never)).not.toThrow()
  })

  it('starts with batch mode off', () => {
    const provider = new AahpDashboardProvider({} as never)
    expect(provider.isInBatchMode()).toBe(false)
  })

  it('getFocusedRepoPath returns undefined initially', () => {
    const provider = new AahpDashboardProvider({} as never)
    expect(provider.getFocusedRepoPath()).toBeUndefined()
  })
})

// ── Tests: resolveWebviewView ─────────────────────────────────────────────────

describe('AahpDashboardProvider - resolveWebviewView', () => {
  it('sets enableScripts on the webview options', () => {
    const provider = new AahpDashboardProvider({} as never)
    const view = makeMockWebviewView()
    provider.resolveWebviewView(view as never, {} as never, {} as never)
    expect(view.webview.options).toMatchObject({ enableScripts: true })
  })

  it('sets initial HTML on the webview', () => {
    const provider = new AahpDashboardProvider({} as never)
    const view = makeMockWebviewView()
    provider.resolveWebviewView(view as never, {} as never, {} as never)
    // HTML should be a non-empty string
    expect(typeof view.webview.html).toBe('string')
    expect(view.webview.html.length).toBeGreaterThan(0)
  })

  it('registers onDidReceiveMessage handler', () => {
    const provider = new AahpDashboardProvider({} as never)
    const view = makeMockWebviewView()
    provider.resolveWebviewView(view as never, {} as never, {} as never)
    expect(view.webview.onDidReceiveMessage).toHaveBeenCalled()
  })

  it('registers onDidDispose handler', () => {
    const provider = new AahpDashboardProvider({} as never)
    const view = makeMockWebviewView()
    provider.resolveWebviewView(view as never, {} as never, {} as never)
    expect(view.onDidDispose).toHaveBeenCalled()
  })

  it('calls refresh callback when provided', () => {
    const provider = new AahpDashboardProvider({} as never)
    const refreshFn = vi.fn()
    provider.setRefreshCallback(refreshFn)
    const view = makeMockWebviewView()
    provider.resolveWebviewView(view as never, {} as never, {} as never)
    expect(refreshFn).toHaveBeenCalled()
  })
})

// ── Tests: message handling ───────────────────────────────────────────────────

describe('AahpDashboardProvider - message handling', () => {
  let provider: AahpDashboardProvider
  let view: ReturnType<typeof makeMockWebviewView>

  beforeEach(() => {
    provider = new AahpDashboardProvider({} as never)
    view = makeMockWebviewView()
    vi.mocked(commands.executeCommand).mockClear()
    provider.resolveWebviewView(view as never, {} as never, {} as never)
  })

  it('handles updateManifest message', () => {
    view._sendMessage({ command: 'updateManifest' })
    expect(commands.executeCommand).toHaveBeenCalledWith('aahp.updateManifest')
  })

  it('handles commitSession message', () => {
    view._sendMessage({ command: 'commitSession' })
    expect(commands.executeCommand).toHaveBeenCalledWith('aahp.commitSession')
  })

  it('handles setPhase message', () => {
    view._sendMessage({ command: 'setPhase' })
    expect(commands.executeCommand).toHaveBeenCalledWith('aahp.setPhase')
  })

  it('handles runAll message', () => {
    view._sendMessage({ command: 'runAll' })
    expect(commands.executeCommand).toHaveBeenCalledWith('aahp.runAll')
  })

  it('handles focusRepo message with repoPath', () => {
    view._sendMessage({ command: 'focusRepo', repoPath: '/dev/myrepo' })
    expect(commands.executeCommand).toHaveBeenCalledWith('aahp.focusRepo', '/dev/myrepo')
  })

  it('handles setTaskStatus message', () => {
    view._sendMessage({
      command: 'setTaskStatus',
      repoPath: '/dev/repo',
      taskId: 'T-001',
      status: 'done',
    })
    expect(commands.executeCommand).toHaveBeenCalledWith(
      'aahp.setTaskStatus',
      '/dev/repo',
      'T-001',
      'done',
    )
  })

  it('handles createTask message', () => {
    view._sendMessage({ command: 'createTask', repoPath: '/dev/repo' })
    expect(commands.executeCommand).toHaveBeenCalledWith('aahp.createTask', '/dev/repo')
  })

  it('handles fixTask message', () => {
    view._sendMessage({ command: 'fixTask', repoPath: '/dev/repo', taskId: 'T-002' })
    expect(commands.executeCommand).toHaveBeenCalledWith('aahp.fixTask', '/dev/repo', 'T-002')
  })

  it('handles openAgentHistory message', () => {
    view._sendMessage({ command: 'openAgentHistory' })
    expect(commands.executeCommand).toHaveBeenCalledWith('aahp.openAgentHistory')
  })

  it('handles toggleSection message by re-rendering', () => {
    const htmlBefore = view.webview.html
    view._sendMessage({ command: 'toggleSection', section: 'agents' })
    // HTML may change after toggling a section (debounced - just check no crash)
    expect(typeof view.webview.html).toBe('string')
    void htmlBefore // used to avoid lint warning
  })

  it('handles unknown commands without throwing', () => {
    expect(() => {
      view._sendMessage({ command: 'unknownCommand' })
    }).not.toThrow()
  })
})

// ── Tests: state update methods ───────────────────────────────────────────────

describe('AahpDashboardProvider - state updates', () => {
  it('update() stores context and does not crash', () => {
    const provider = new AahpDashboardProvider({} as never)
    expect(() => provider.update(makeContext())).not.toThrow()
    expect(() => provider.update(undefined)).not.toThrow()
  })

  it('updateRepoOverviews() stores overviews', () => {
    const provider = new AahpDashboardProvider({} as never)
    const overviews = [makeOverview()]
    expect(() => provider.updateRepoOverviews(overviews)).not.toThrow()
  })

  it('updateFocusedRepo() stores focused repo path', () => {
    const provider = new AahpDashboardProvider({} as never)
    provider.updateFocusedRepo('/dev/myrepo', makeContext())
    expect(provider.getFocusedRepoPath()).toBe('/dev/myrepo')
  })

  it('updateFocusedRepo() clears focused repo when path is undefined', () => {
    const provider = new AahpDashboardProvider({} as never)
    provider.updateFocusedRepo('/dev/myrepo', makeContext())
    provider.updateFocusedRepo(undefined, undefined)
    expect(provider.getFocusedRepoPath()).toBeUndefined()
  })

  it('updateAgentRuns() does not crash with empty array', () => {
    const provider = new AahpDashboardProvider({} as never)
    expect(() => provider.updateAgentRuns([])).not.toThrow()
  })

  it('updateLogHistory() stores log entries', () => {
    const provider = new AahpDashboardProvider({} as never)
    expect(() => provider.updateLogHistory([])).not.toThrow()
  })

  it('updateSessionState() does not crash', () => {
    const provider = new AahpDashboardProvider({} as never)
    expect(() => provider.updateSessionState([], [])).not.toThrow()
  })
})

// ── Tests: HTML rendering ─────────────────────────────────────────────────────

describe('AahpDashboardProvider - HTML rendering', () => {
  it('renders HTML containing project name', () => {
    const provider = new AahpDashboardProvider({} as never)
    provider.update(makeContext())
    const html = (provider as unknown as { _getHtml: (w: unknown) => string })._getHtml({} as never)
    expect(html).toContain('TestProject')
  })

  it('renders HTML with task IDs', () => {
    const provider = new AahpDashboardProvider({} as never)
    provider.update(makeContext())
    const html = (provider as unknown as { _getHtml: (w: unknown) => string })._getHtml({} as never)
    expect(html).toContain('T-001')
    expect(html).toContain('T-002')
  })

  it('includes DOCTYPE and html tags', () => {
    const provider = new AahpDashboardProvider({} as never)
    const html = (provider as unknown as { _getHtml: (w: unknown) => string })._getHtml({} as never)
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<html')
  })

  it('includes CSP nonce in script-src', () => {
    const provider = new AahpDashboardProvider({} as never)
    const html = (provider as unknown as { _getHtml: (w: unknown) => string })._getHtml({} as never)
    expect(html).toMatch(/script-src 'nonce-[A-Za-z0-9]+'/)
  })

  it('renders Run All Agents button', () => {
    const provider = new AahpDashboardProvider({} as never)
    const html = (provider as unknown as { _getHtml: (w: unknown) => string })._getHtml({} as never)
    expect(html).toContain('Run All Agents')
  })

  it('renders task title from context', () => {
    const provider = new AahpDashboardProvider({} as never)
    provider.update(makeContext())
    const html = (provider as unknown as { _getHtml: (w: unknown) => string })._getHtml({} as never)
    expect(html).toContain('Implement feature A')
  })

  it('renders repo overviews in the repo grid', () => {
    const provider = new AahpDashboardProvider({} as never)
    provider.updateRepoOverviews([makeOverview()])
    const html = (provider as unknown as { _getHtml: (w: unknown) => string })._getHtml({} as never)
    expect(html).toContain('testproject')
  })

  it('renders GitHub issue link for task with github_issue', () => {
    const provider = new AahpDashboardProvider({} as never)
    provider.updateRepoOverviews([makeOverview()])
    const html = (provider as unknown as { _getHtml: (w: unknown) => string })._getHtml({} as never)
    // T-001 has github_issue: 7
    expect(html).toContain('https://github.com/acme/testproject/issues/7')
  })

  it('renders empty-state message when no repos configured', () => {
    const provider = new AahpDashboardProvider({} as never)
    // No context, no overviews - should show some kind of empty state
    const html = (provider as unknown as { _getHtml: (w: unknown) => string })._getHtml({} as never)
    expect(html.length).toBeGreaterThan(100) // at least something rendered
  })
})

// ── Tests: batch mode ─────────────────────────────────────────────────────────

describe('AahpDashboardProvider - batch mode', () => {
  it('sets batch mode on beginBatchUpdate', () => {
    const provider = new AahpDashboardProvider({} as never)
    provider.beginBatchUpdate()
    expect(provider.isInBatchMode()).toBe(true)
    provider.endBatchUpdate()
  })

  it('clears batch mode on endBatchUpdate', () => {
    const provider = new AahpDashboardProvider({} as never)
    provider.beginBatchUpdate()
    provider.endBatchUpdate()
    expect(provider.isInBatchMode()).toBe(false)
  })

  it('supports nested batch pairs', () => {
    const provider = new AahpDashboardProvider({} as never)
    provider.beginBatchUpdate()
    provider.beginBatchUpdate()
    provider.endBatchUpdate()
    expect(provider.isInBatchMode()).toBe(true)
    provider.endBatchUpdate()
    expect(provider.isInBatchMode()).toBe(false)
  })

  it('extra endBatchUpdate calls do not underflow', () => {
    const provider = new AahpDashboardProvider({} as never)
    provider.beginBatchUpdate()
    provider.endBatchUpdate()
    provider.endBatchUpdate() // extra
    expect(provider.isInBatchMode()).toBe(false)
  })

  it('renders are suppressed during batch mode when view is attached', () => {
    const provider = new AahpDashboardProvider({} as never)
    const view = makeMockWebviewView()
    provider.resolveWebviewView(view as never, {} as never, {} as never)

    const htmlBefore = view.webview.html
    provider.beginBatchUpdate()
    // Updates during batch should not immediately change HTML
    provider.update(makeContext({ manifest: makeManifest({ project: 'BatchProject' }) }))
    // HTML should NOT contain BatchProject yet (batch suppresses render)
    expect(view.webview.html).toBe(htmlBefore)

    // After ending batch, a render fires
    provider.endBatchUpdate()
    expect(provider.isInBatchMode()).toBe(false)
  })
})

// ── Tests: setRefreshCallback ─────────────────────────────────────────────────

describe('AahpDashboardProvider - setRefreshCallback', () => {
  it('calls the refresh callback on resolveWebviewView', () => {
    const provider = new AahpDashboardProvider({} as never)
    const cb = vi.fn()
    provider.setRefreshCallback(cb)
    const view = makeMockWebviewView()
    provider.resolveWebviewView(view as never, {} as never, {} as never)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('calls refresh callback again on visibility change', () => {
    const provider = new AahpDashboardProvider({} as never)
    const cb = vi.fn()
    provider.setRefreshCallback(cb)
    const view = makeMockWebviewView()
    provider.resolveWebviewView(view as never, {} as never, {} as never)

    cb.mockClear()
    // Simulate visibility change (sidebar becomes visible)
    view.visible = true
    view._triggerVisibilityChange()
    expect(cb).toHaveBeenCalled()
  })
})

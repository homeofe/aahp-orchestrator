import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { commands, window, env, Uri } from 'vscode'
import { registerCommands } from '../commands'
import { AahpManifest, AahpContext } from '../aahp-reader'

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
    quick_context: 'A test project',
    token_budget: { manifest_only: 500, full_read: 2000 },
    next_task_id: 5,
    tasks: {
      'T-001': {
        title: 'Task with issue',
        status: 'ready',
        priority: 'high',
        depends_on: [],
        created: '2026-02-27T10:00:00Z',
        github_issue: 42,
        github_repo: 'homeofe/test-repo',
      },
      'T-002': {
        title: 'Task without issue',
        status: 'ready',
        priority: 'medium',
        depends_on: [],
        created: '2026-02-27T10:00:00Z',
      },
    },
    ...overrides,
  }
}

function makeContext(handoffDir: string, manifest?: AahpManifest): AahpContext {
  return {
    manifest: manifest ?? makeManifest(),
    handoffDir,
    status: undefined,
    nextActions: undefined,
    conventions: undefined,
    trust: undefined,
    workflowMd: undefined,
  }
}

/** Write a minimal .git/config with origin pointing to a GitHub repo */
function writeGitConfig(repoPath: string, remoteUrl: string): void {
  const gitDir = path.join(repoPath, '.git')
  fs.mkdirSync(gitDir, { recursive: true })
  fs.writeFileSync(
    path.join(gitDir, 'config'),
    `[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = ${remoteUrl}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`,
    'utf8',
  )
}

/** Extract the handler registered for a given command name */
function getCommandHandler(commandName: string): ((...args: unknown[]) => Promise<void>) | undefined {
  const call = (commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls.find(
    (c: unknown[]) => c[0] === commandName,
  )
  return call ? (call[1] as (...args: unknown[]) => Promise<void>) : undefined
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('aahp.openTaskOnGitHub command', () => {
  let tmpDir: string
  let reloadCtx: ReturnType<typeof vi.fn>

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aahp-gh-'))
    const handoffDir = path.join(tmpDir, '.ai', 'handoff')
    fs.mkdirSync(handoffDir, { recursive: true })
    fs.writeFileSync(
      path.join(handoffDir, 'MANIFEST.json'),
      JSON.stringify(makeManifest(), null, 2) + '\n',
      'utf8',
    )

    // Write a GitHub remote
    writeGitConfig(tmpDir, 'https://github.com/homeofe/test-repo.git')

    reloadCtx = vi.fn()
    vi.mocked(commands.registerCommand).mockClear()
    vi.mocked(window.showWarningMessage).mockReset()
    vi.mocked(env.openExternal).mockReset()
    vi.mocked(Uri.parse).mockReset()
    vi.mocked(Uri.parse).mockImplementation((s: string) => ({ fsPath: s, scheme: 'https' }) as never)

    const mockExtContext = { subscriptions: [] } as unknown as import('vscode').ExtensionContext
    registerCommands(
      mockExtContext,
      () => makeContext(path.join(tmpDir, '.ai', 'handoff')),
      reloadCtx,
    )
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('opens direct issue URL when task has github_issue', async () => {
    const handler = getCommandHandler('aahp.openTaskOnGitHub')
    expect(handler).toBeDefined()

    await handler!({
      repoPath: tmpDir,
      repoName: 'test-repo',
      taskId: 'T-001',
      task: makeManifest().tasks!['T-001'],
    })

    expect(Uri.parse).toHaveBeenCalledWith(
      'https://github.com/homeofe/test-repo/issues/42',
    )
    expect(env.openExternal).toHaveBeenCalled()
  })

  it('opens search URL when task has no github_issue', async () => {
    const handler = getCommandHandler('aahp.openTaskOnGitHub')

    await handler!({
      repoPath: tmpDir,
      repoName: 'test-repo',
      taskId: 'T-002',
      task: makeManifest().tasks!['T-002'],
    })

    expect(Uri.parse).toHaveBeenCalledWith(
      'https://github.com/homeofe/test-repo/issues?q=T-002',
    )
    expect(env.openExternal).toHaveBeenCalled()
  })

  it('does nothing when element is undefined', async () => {
    const handler = getCommandHandler('aahp.openTaskOnGitHub')
    await handler!(undefined)

    expect(env.openExternal).not.toHaveBeenCalled()
    expect(window.showWarningMessage).not.toHaveBeenCalled()
  })

  it('does nothing when element has no repoPath', async () => {
    const handler = getCommandHandler('aahp.openTaskOnGitHub')
    await handler!({ repoPath: '', repoName: '', taskId: 'T-001', task: makeManifest().tasks!['T-001'] })

    expect(env.openExternal).not.toHaveBeenCalled()
  })

  it('does nothing when element has no taskId', async () => {
    const handler = getCommandHandler('aahp.openTaskOnGitHub')
    await handler!({ repoPath: tmpDir, repoName: 'test-repo', taskId: '', task: makeManifest().tasks!['T-001'] })

    expect(env.openExternal).not.toHaveBeenCalled()
  })

  it('shows warning when no GitHub remote found', async () => {
    // Create a repo without .git/config (or with non-GitHub remote)
    const noGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aahp-nogh-'))
    try {
      const handler = getCommandHandler('aahp.openTaskOnGitHub')
      await handler!({
        repoPath: noGitDir,
        repoName: 'no-git-repo',
        taskId: 'T-001',
        task: makeManifest().tasks!['T-001'],
      })

      expect(env.openExternal).not.toHaveBeenCalled()
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('No GitHub remote'),
      )
    } finally {
      fs.rmSync(noGitDir, { recursive: true, force: true })
    }
  })

  it('handles SSH remote URL format', async () => {
    // Rewrite .git/config with SSH URL
    writeGitConfig(tmpDir, 'git@github.com:homeofe/ssh-repo.git')

    const handler = getCommandHandler('aahp.openTaskOnGitHub')
    await handler!({
      repoPath: tmpDir,
      repoName: 'ssh-repo',
      taskId: 'T-002',
      task: makeManifest().tasks!['T-002'],
    })

    expect(Uri.parse).toHaveBeenCalledWith(
      'https://github.com/homeofe/ssh-repo/issues?q=T-002',
    )
    expect(env.openExternal).toHaveBeenCalled()
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { TaskTreeProvider, flattenOpenTasks, groupByPriority, FlatTask } from '../task-tree'
import { AahpManifest, RepoOverview } from '../aahp-reader'
import { TreeItemCollapsibleState } from 'vscode'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeManifest(tasks?: AahpManifest['tasks']): AahpManifest {
  return {
    aahp_version: '3.0',
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
    tasks,
  }
}

function makeOverview(name: string, tasks?: AahpManifest['tasks']): RepoOverview {
  const manifest = makeManifest(tasks)
  const taskEntries = Object.values(tasks ?? {})
  return {
    repoPath: `/repos/${name}`,
    repoName: name,
    manifest,
    handoffDir: `/repos/${name}/.ai/handoff`,
    hasManifest: true,
    taskCounts: {
      total: taskEntries.length,
      ready: taskEntries.filter(t => t.status === 'ready').length,
      inProgress: taskEntries.filter(t => t.status === 'in_progress').length,
      done: taskEntries.filter(t => t.status === 'done').length,
      blocked: taskEntries.filter(t => t.status === 'blocked').length,
      pending: taskEntries.filter(t => t.status === 'pending').length,
    },
    lastActivity: '2026-02-27T10:00:00Z',
    health: 'healthy',
  }
}

// ── flattenOpenTasks ─────────────────────────────────────────────────────────

describe('flattenOpenTasks', () => {
  it('returns empty array for no overviews', () => {
    expect(flattenOpenTasks([])).toEqual([])
  })

  it('returns empty array when all tasks are done', () => {
    const overviews = [makeOverview('repo-a', {
      'T-001': { title: 'Done task', status: 'done', priority: 'high', depends_on: [], created: '2026-02-27T10:00:00Z', completed: '2026-02-27T12:00:00Z' },
    })]
    expect(flattenOpenTasks(overviews)).toEqual([])
  })

  it('flattens tasks from multiple repos, excludes done', () => {
    const overviews = [
      makeOverview('repo-a', {
        'T-001': { title: 'Task A1', status: 'ready', priority: 'high', depends_on: [], created: '2026-02-27T10:00:00Z' },
        'T-002': { title: 'Task A2', status: 'done', priority: 'low', depends_on: [], created: '2026-02-27T10:00:00Z' },
      }),
      makeOverview('repo-b', {
        'T-001': { title: 'Task B1', status: 'in_progress', priority: 'medium', depends_on: [], created: '2026-02-27T10:00:00Z' },
      }),
    ]
    const flat = flattenOpenTasks(overviews)
    expect(flat).toHaveLength(2)
    expect(flat[0].taskId).toBe('T-001')
    expect(flat[0].repoName).toBe('repo-b') // in_progress sorts first
    expect(flat[1].taskId).toBe('T-001')
    expect(flat[1].repoName).toBe('repo-a')
  })

  it('sorts by status then priority then task ID', () => {
    const overviews = [makeOverview('repo-a', {
      'T-001': { title: 'Low ready', status: 'ready', priority: 'low', depends_on: [], created: '2026-02-27T10:00:00Z' },
      'T-002': { title: 'High blocked', status: 'blocked', priority: 'high', depends_on: [], created: '2026-02-27T10:00:00Z' },
      'T-003': { title: 'High ready', status: 'ready', priority: 'high', depends_on: [], created: '2026-02-27T10:00:00Z' },
      'T-004': { title: 'In progress', status: 'in_progress', priority: 'medium', depends_on: [], created: '2026-02-27T10:00:00Z' },
    })]
    const flat = flattenOpenTasks(overviews)
    expect(flat.map(t => t.taskId)).toEqual(['T-004', 'T-003', 'T-001', 'T-002'])
  })

  it('handles repos with no tasks', () => {
    const overviews = [makeOverview('empty-repo')]
    expect(flattenOpenTasks(overviews)).toEqual([])
  })
})

// ── groupByPriority ──────────────────────────────────────────────────────────

describe('groupByPriority', () => {
  it('returns empty groups for no tasks', () => {
    const result = groupByPriority([])
    expect(result.high).toEqual([])
    expect(result.medium).toEqual([])
    expect(result.low).toEqual([])
  })

  it('groups tasks by priority correctly', () => {
    const tasks: FlatTask[] = [
      { repoPath: '/a', repoName: 'a', taskId: 'T-001', task: { title: 'H', status: 'ready', priority: 'high', depends_on: [], created: '' } },
      { repoPath: '/a', repoName: 'a', taskId: 'T-002', task: { title: 'M', status: 'ready', priority: 'medium', depends_on: [], created: '' } },
      { repoPath: '/a', repoName: 'a', taskId: 'T-003', task: { title: 'L', status: 'ready', priority: 'low', depends_on: [], created: '' } },
      { repoPath: '/a', repoName: 'a', taskId: 'T-004', task: { title: 'H2', status: 'blocked', priority: 'high', depends_on: [], created: '' } },
    ]
    const result = groupByPriority(tasks)
    expect(result.high).toHaveLength(2)
    expect(result.medium).toHaveLength(1)
    expect(result.low).toHaveLength(1)
  })
})

// ── TaskTreeProvider ─────────────────────────────────────────────────────────

describe('TaskTreeProvider', () => {
  let provider: TaskTreeProvider

  beforeEach(() => {
    provider = new TaskTreeProvider()
  })

  it('returns empty children when no overviews', () => {
    expect(provider.getChildren()).toEqual([])
  })

  it('returns priority groups as root children', () => {
    provider.update([
      makeOverview('repo-a', {
        'T-001': { title: 'High task', status: 'ready', priority: 'high', depends_on: [], created: '2026-02-27T10:00:00Z' },
        'T-002': { title: 'Low task', status: 'blocked', priority: 'low', depends_on: [], created: '2026-02-27T10:00:00Z' },
      }),
    ])
    const roots = provider.getChildren()
    expect(roots).toHaveLength(2) // high + low groups
    expect((roots[0] as any).priority).toBe('high')
    expect((roots[1] as any).priority).toBe('low')
  })

  it('omits empty priority groups', () => {
    provider.update([
      makeOverview('repo-a', {
        'T-001': { title: 'Medium task', status: 'ready', priority: 'medium', depends_on: [], created: '2026-02-27T10:00:00Z' },
      }),
    ])
    const roots = provider.getChildren()
    expect(roots).toHaveLength(1)
    expect((roots[0] as any).priority).toBe('medium')
  })

  it('returns tasks as children of priority groups', () => {
    provider.update([
      makeOverview('repo-a', {
        'T-001': { title: 'High task 1', status: 'ready', priority: 'high', depends_on: [], created: '2026-02-27T10:00:00Z' },
        'T-002': { title: 'High task 2', status: 'in_progress', priority: 'high', depends_on: [], created: '2026-02-27T10:00:00Z' },
      }),
    ])
    const roots = provider.getChildren()
    expect(roots).toHaveLength(1) // only high
    const children = provider.getChildren(roots[0])
    expect(children).toHaveLength(2)
    expect((children[0] as any).taskId).toBe('T-002') // in_progress first in original flatten
    expect((children[1] as any).taskId).toBe('T-001')
  })

  it('generates correct tree item for priority group', () => {
    provider.update([
      makeOverview('repo-a', {
        'T-001': { title: 'Task', status: 'ready', priority: 'high', depends_on: [], created: '2026-02-27T10:00:00Z' },
      }),
    ])
    const roots = provider.getChildren()
    const item = provider.getTreeItem(roots[0])
    expect(item.label).toBe('High Priority')
    expect(item.description).toBe('1')
    expect(item.collapsibleState).toBe(TreeItemCollapsibleState.Expanded)
    expect(item.contextValue).toBe('priorityGroup')
  })

  it('generates correct tree item for a task', () => {
    provider.update([
      makeOverview('my-repo', {
        'T-005': { title: 'Build sidebar', status: 'ready', priority: 'high', depends_on: [], created: '2026-02-27T10:00:00Z' },
      }),
    ])
    const roots = provider.getChildren()
    const children = provider.getChildren(roots[0])
    const item = provider.getTreeItem(children[0])
    expect(item.label).toBe('my-repo > [T-005] Build sidebar')
    expect(item.description).toBe('ready')
    expect(item.collapsibleState).toBe(TreeItemCollapsibleState.None)
    expect(item.contextValue).toBe('task')
    expect(item.command).toEqual({
      command: 'aahp.focusRepo',
      title: 'Focus Repo',
      arguments: ['/repos/my-repo'],
    })
  })

  it('returns empty children for a task element (leaf node)', () => {
    provider.update([
      makeOverview('repo-a', {
        'T-001': { title: 'Task', status: 'ready', priority: 'high', depends_on: [], created: '2026-02-27T10:00:00Z' },
      }),
    ])
    const roots = provider.getChildren()
    const children = provider.getChildren(roots[0])
    expect(provider.getChildren(children[0])).toEqual([])
  })

  it('aggregates tasks across multiple repos', () => {
    provider.update([
      makeOverview('repo-a', {
        'T-001': { title: 'Task A', status: 'ready', priority: 'high', depends_on: [], created: '2026-02-27T10:00:00Z' },
      }),
      makeOverview('repo-b', {
        'T-001': { title: 'Task B', status: 'ready', priority: 'high', depends_on: [], created: '2026-02-27T10:00:00Z' },
      }),
      makeOverview('repo-c', {
        'T-003': { title: 'Task C', status: 'blocked', priority: 'medium', depends_on: [], created: '2026-02-27T10:00:00Z' },
      }),
    ])
    const roots = provider.getChildren()
    expect(roots).toHaveLength(2) // high + medium
    const highChildren = provider.getChildren(roots[0])
    expect(highChildren).toHaveLength(2)
    const medChildren = provider.getChildren(roots[1])
    expect(medChildren).toHaveLength(1)
  })

  it('fires onDidChangeTreeData when updated', () => {
    let fired = false
    provider.onDidChangeTreeData(() => { fired = true })
    provider.update([])
    expect(fired).toBe(true)
  })

  it('excludes done tasks from all groups', () => {
    provider.update([
      makeOverview('repo-a', {
        'T-001': { title: 'Done', status: 'done', priority: 'high', depends_on: [], created: '2026-02-27T10:00:00Z', completed: '2026-02-27T12:00:00Z' },
        'T-002': { title: 'Open', status: 'ready', priority: 'medium', depends_on: [], created: '2026-02-27T10:00:00Z' },
      }),
    ])
    const roots = provider.getChildren()
    expect(roots).toHaveLength(1) // only medium
    expect((roots[0] as any).priority).toBe('medium')
  })
})

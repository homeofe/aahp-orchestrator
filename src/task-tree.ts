import * as vscode from 'vscode'
import { AahpTask, RepoOverview } from './aahp-reader'

// ── Types ────────────────────────────────────────────────────────────────────

export interface FlatTask {
  repoPath: string
  repoName: string
  taskId: string
  task: AahpTask
}

type TreeElement = PriorityGroup | FlatTask

interface PriorityGroup {
  kind: 'priority-group'
  priority: 'high' | 'medium' | 'low'
  tasks: FlatTask[]
}

// ── Provider ─────────────────────────────────────────────────────────────────

export class TaskTreeProvider implements vscode.TreeDataProvider<TreeElement> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeElement | undefined | void>()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event

  private _overviews: RepoOverview[] = []
  private _filterText = ''

  update(overviews: RepoOverview[]): void {
    this._overviews = overviews
    this._onDidChangeTreeData.fire()
  }

  setFilter(text: string): void {
    this._filterText = text.toLowerCase()
    this._onDidChangeTreeData.fire()
  }

  getFilter(): string {
    return this._filterText
  }

  getTreeItem(element: TreeElement): vscode.TreeItem {
    if (isPriorityGroup(element)) {
      return this._groupItem(element)
    }
    return this._taskItem(element)
  }

  getChildren(element?: TreeElement): TreeElement[] {
    if (!element) {
      return this._getRootGroups()
    }
    if (isPriorityGroup(element)) {
      return element.tasks
    }
    return []
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private _getRootGroups(): PriorityGroup[] {
    let allTasks = flattenOpenTasks(this._overviews)

    // Apply search filter if set
    if (this._filterText) {
      allTasks = allTasks.filter(t =>
        t.taskId.toLowerCase().includes(this._filterText) ||
        t.task.title.toLowerCase().includes(this._filterText) ||
        t.repoName.toLowerCase().includes(this._filterText)
      )
    }

    const byPriority = groupByPriority(allTasks)
    return (['high', 'medium', 'low'] as const)
      .map(p => ({ kind: 'priority-group' as const, priority: p, tasks: byPriority[p] }))
      .filter(g => g.tasks.length > 0)
  }

  private _groupItem(group: PriorityGroup): vscode.TreeItem {
    const label = `${capitalize(group.priority)} Priority`
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded)
    item.description = `${group.tasks.length}`
    item.iconPath = priorityIcon(group.priority)
    item.contextValue = 'priorityGroup'
    return item
  }

  private _taskItem(ft: FlatTask): vscode.TreeItem {
    const label = `${ft.repoName} > [${ft.taskId}] ${ft.task.title}`
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None)
    item.description = ft.task.status
    const ghLine = typeof ft.task.github_issue === 'number'
      ? `\nGitHub: #${ft.task.github_issue}`
      : ''
    item.tooltip = `${ft.repoName} - ${ft.taskId}: ${ft.task.title}\nPriority: ${ft.task.priority} | Status: ${ft.task.status}${ghLine}`
    item.iconPath = statusIcon(ft.task.status)
    item.contextValue = 'task'
    item.command = {
      command: 'aahp.focusRepo',
      title: 'Focus Repo',
      arguments: [ft.repoPath],
    }
    return item
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function flattenOpenTasks(overviews: RepoOverview[]): FlatTask[] {
  const result: FlatTask[] = []
  for (const repo of overviews) {
    const tasks = repo.manifest.tasks ?? {}
    for (const [id, task] of Object.entries(tasks)) {
      if (task.status === 'done') continue
      result.push({
        repoPath: repo.repoPath,
        repoName: repo.repoName,
        taskId: id,
        task,
      })
    }
  }
  // Sort: in_progress first, then ready, then blocked, then pending.
  // Within same status, high > medium > low.
  const statusOrder: Record<string, number> = {
    in_progress: 0,
    ready: 1,
    blocked: 2,
    pending: 3,
  }
  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }

  return result.sort((a, b) => {
    const sa = statusOrder[a.task.status] ?? 9
    const sb = statusOrder[b.task.status] ?? 9
    if (sa !== sb) return sa - sb
    const pa = priorityOrder[a.task.priority] ?? 9
    const pb = priorityOrder[b.task.priority] ?? 9
    if (pa !== pb) return pa - pb
    return a.taskId.localeCompare(b.taskId)
  })
}

export function groupByPriority(
  tasks: FlatTask[],
): Record<'high' | 'medium' | 'low', FlatTask[]> {
  const groups: Record<'high' | 'medium' | 'low', FlatTask[]> = {
    high: [],
    medium: [],
    low: [],
  }
  for (const t of tasks) {
    const bucket = groups[t.task.priority]
    if (bucket) bucket.push(t)
    else groups.medium.push(t) // fallback
  }
  return groups
}

function isPriorityGroup(el: TreeElement): el is PriorityGroup {
  return (el as PriorityGroup).kind === 'priority-group'
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function priorityIcon(priority: string): vscode.ThemeIcon {
  switch (priority) {
    case 'high': return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('testing.iconFailed'))
    case 'medium': return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('testing.iconQueued'))
    case 'low': return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('testing.iconPassed'))
    default: return new vscode.ThemeIcon('circle-outline')
  }
}

function statusIcon(status: string): vscode.ThemeIcon {
  switch (status) {
    case 'in_progress': return new vscode.ThemeIcon('sync~spin')
    case 'ready': return new vscode.ThemeIcon('play-circle')
    case 'blocked': return new vscode.ThemeIcon('error')
    case 'pending': return new vscode.ThemeIcon('clock')
    case 'done': return new vscode.ThemeIcon('check')
    default: return new vscode.ThemeIcon('question')
  }
}

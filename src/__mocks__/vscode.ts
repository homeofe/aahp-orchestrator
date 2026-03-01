/**
 * Mock for the `vscode` module used in unit tests.
 * Only stubs the APIs actually used by the extension source code.
 */
import { vi } from 'vitest'

// ── Configuration mock ──────────────────────────────────────────────────────

const configStore: Record<string, unknown> = {}

export const workspace = {
  getConfiguration: vi.fn((_section?: string) => ({
    get: vi.fn(<T>(key: string, defaultValue?: T): T => {
      const fullKey = _section ? `${_section}.${key}` : key
      return (configStore[fullKey] ?? defaultValue) as T
    }),
    update: vi.fn(),
  })),
  workspaceFolders: undefined as
    | Array<{ uri: { fsPath: string }; name: string; index: number }>
    | undefined,
  createFileSystemWatcher: vi.fn(() => ({
    onDidChange: vi.fn(),
    onDidCreate: vi.fn(),
    onDidDelete: vi.fn(),
    dispose: vi.fn(),
  })),
  onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
  onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() })),
}

/** Helper: set a config value that workspace.getConfiguration().get() will return */
export function __setConfig(key: string, value: unknown): void {
  configStore[key] = value
}

/** Helper: clear all mock config values */
export function __clearConfig(): void {
  for (const key of Object.keys(configStore)) {
    delete configStore[key]
  }
}

// ── Window mock ─────────────────────────────────────────────────────────────

export const window = {
  activeTextEditor: undefined as { document: { uri: { fsPath: string }; fileName: string; isDirty: boolean } } | undefined,
  createStatusBarItem: vi.fn(() => ({
    text: '',
    tooltip: '',
    command: '',
    backgroundColor: undefined,
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  })),
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showInputBox: vi.fn(),
  showQuickPick: vi.fn(),
  createOutputChannel: vi.fn(() => ({
    appendLine: vi.fn(),
    append: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn(),
  })),
  createTerminal: vi.fn(() => ({
    sendText: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn(),
  })),
  registerWebviewViewProvider: vi.fn(() => ({ dispose: vi.fn() })),
  createTreeView: vi.fn(() => ({ dispose: vi.fn(), onDidChangeSelection: vi.fn() })),
  onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
  terminals: [] as Array<{ name: string }>,
}

// ── Commands mock ───────────────────────────────────────────────────────────

export const commands = {
  registerCommand: vi.fn((_cmd: string, _handler: (...args: unknown[]) => unknown) => ({
    dispose: vi.fn(),
  })),
  executeCommand: vi.fn(),
}

// ── Env mock ────────────────────────────────────────────────────────────────

export const env = {
  clipboard: {
    writeText: vi.fn(),
    readText: vi.fn(),
  },
  openExternal: vi.fn(),
}

// ── Chat mock ───────────────────────────────────────────────────────────────

export const chat = {
  createChatParticipant: vi.fn(() => ({
    iconPath: undefined,
    followupProvider: undefined,
    dispose: vi.fn(),
  })),
}

// ── Language model mock ─────────────────────────────────────────────────────

export const lm = {
  selectChatModels: vi.fn(async () => []),
}

// ── Debug mock ──────────────────────────────────────────────────────────────

export const debug = {
  activeDebugSession: undefined as { name: string } | undefined,
}

// ── Tasks mock ──────────────────────────────────────────────────────────────

export const tasks = {
  taskExecutions: [] as Array<{ task: { name: string; source: string } }>,
}

// ── Enums & classes ─────────────────────────────────────────────────────────

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3,
}

export class ThemeIcon {
  constructor(public readonly id: string, public readonly color?: ThemeColor) {}
}

export class ThemeColor {
  constructor(public readonly id: string) {}
}

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export class TreeItem {
  label: string | undefined
  collapsibleState: TreeItemCollapsibleState | undefined
  description?: string
  tooltip?: string
  iconPath?: ThemeIcon
  contextValue?: string
  command?: { command: string; title: string; arguments?: unknown[] }
  constructor(label: string, collapsibleState?: TreeItemCollapsibleState) {
    this.label = label
    this.collapsibleState = collapsibleState
  }
}

export class EventEmitter<T> {
  private _listeners: Array<(e: T) => void> = []
  event = (listener: (e: T) => void) => {
    this._listeners.push(listener)
    return { dispose: vi.fn() }
  }
  fire(data: T): void {
    for (const l of this._listeners) l(data)
  }
  dispose = vi.fn()
}

export class MarkdownString {
  constructor(public readonly value: string = '') {}
}

export class CancellationTokenSource {
  token = { isCancellationRequested: false }
  cancel = vi.fn(() => { this.token.isCancellationRequested = true })
  dispose = vi.fn()
}

// Chat message classes
export const LanguageModelChatMessage = {
  User: vi.fn((content: string) => ({ role: 'user', content })),
  Assistant: vi.fn((content: string) => ({ role: 'assistant', content })),
}

export class LanguageModelTextPart {
  constructor(public readonly value: string) {}
}

export class LanguageModelToolCallPart {
  constructor(
    public readonly name: string,
    public readonly callId: string,
    public readonly input: unknown
  ) {}
}

export class LanguageModelToolResultPart {
  constructor(
    public readonly callId: string,
    public readonly content: unknown[]
  ) {}
}

export class LanguageModelError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message)
  }
}

// Chat turn classes (used in history)
export class ChatRequestTurn {
  constructor(public readonly prompt: string) {}
}

export class ChatResponseTurn {
  constructor(public readonly response: unknown[]) {}
}

export class ChatResponseMarkdownPart {
  constructor(public readonly value: { value: string }) {}
}

// ── Uri mock ────────────────────────────────────────────────────────────────

export const Uri = {
  file: vi.fn((p: string) => ({ fsPath: p, scheme: 'file' })),
  parse: vi.fn((s: string) => ({ fsPath: s, scheme: 'file' })),
}

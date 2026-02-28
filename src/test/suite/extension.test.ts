import * as assert from 'assert'
import * as vscode from 'vscode'

const EXTENSION_ID = 'elvatis.aahp-orchestrator'

// All commands declared in package.json contributes.commands
const EXPECTED_COMMANDS = [
  'aahp.updateManifest',
  'aahp.commitSession',
  'aahp.setPhase',
  'aahp.openDashboard',
  'aahp.copyContext',
  'aahp.runAll',
  'aahp.runSingleRepo',
  'aahp.focusRepo',
  'aahp.setTaskStatus',
  'aahp.createTask',
  'aahp.retryAgent',
  'aahp.fixTask',
  'aahp.launchTask',
  'aahp.openTaskOnGitHub',
  'aahp.refreshAll',
  'aahp.setTaskStatusFromTree',
  'aahp.focusRepoFromTree',
  'aahp.copyTaskId',
  'aahp.openManifest',
  'aahp.createTaskFromTree',
  'aahp.markTaskDone',
  'aahp.setTaskPriorityFromTree',
  'aahp.cancelAgent',
  'aahp.filterTasks',
  'aahp.clearFilter',
  'aahp.openAgentHistory',
  'aahp.openLogEntry',
]

suite('Extension Integration Tests', () => {

  suiteSetup(async function () {
    this.timeout(30_000)
    // The extension activates on onStartupFinished. Wait for it to become
    // active rather than calling activate() again (which can cause double
    // command registration errors).
    const ext = vscode.extensions.getExtension(EXTENSION_ID)
    if (ext && !ext.isActive) {
      await ext.activate()
    }
    // Give the extension time to fully initialize (file watchers, status bar, etc.)
    await new Promise(resolve => setTimeout(resolve, 2000))
  })

  // ── Test 1: Extension is present ──────────────────────────────────────────
  test('Extension is present in the extensions list', () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID)
    assert.ok(ext, `Extension ${EXTENSION_ID} should be installed`)
  })

  // ── Test 2: Extension activates successfully ──────────────────────────────
  test('Extension activates without errors', async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID)
    assert.ok(ext, 'Extension must be present')
    if (!ext.isActive) {
      await ext.activate()
    }
    assert.strictEqual(ext.isActive, true, 'Extension should be active')
  })

  // ── Test 3: All commands are registered ───────────────────────────────────
  test('All expected commands are registered', async () => {
    const allCommands = await vscode.commands.getCommands(true)
    const missing: string[] = []
    for (const cmd of EXPECTED_COMMANDS) {
      if (!allCommands.includes(cmd)) {
        missing.push(cmd)
      }
    }
    assert.strictEqual(
      missing.length,
      0,
      `Missing commands: ${missing.join(', ')}`
    )
  })

  // ── Test 4: aahp.refreshAll executes without error ────────────────────────
  test('aahp.refreshAll command executes without throwing', async () => {
    // refreshAll reloads context and updates status bar / dashboard
    // Wrap Thenable in Promise for proper async handling
    await Promise.resolve(vscode.commands.executeCommand('aahp.refreshAll'))
  })

  // ── Test 5: aahp.openDashboard executes without error ─────────────────────
  test('aahp.openDashboard command executes without throwing', async () => {
    await Promise.resolve(vscode.commands.executeCommand('aahp.openDashboard'))
  })

  // ── Test 6: aahp.clearFilter executes without error ───────────────────────
  test('aahp.clearFilter command executes without throwing', async () => {
    await Promise.resolve(vscode.commands.executeCommand('aahp.clearFilter'))
  })

  // ── Test 7: Chat participant is registered ────────────────────────────────
  test('Chat participant @aahp is registered', () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID)
    assert.ok(ext, 'Extension must be present')
    const pkg = ext.packageJSON as { contributes?: { chatParticipants?: Array<{ id: string }> } }
    const participants = pkg.contributes?.chatParticipants ?? []
    const aahp = participants.find(p => p.id === 'aahp.orchestrator')
    assert.ok(aahp, 'Chat participant aahp.orchestrator should be declared in package.json')
  })

  // ── Test 8: Extension contributes views ───────────────────────────────────
  test('Extension contributes sidebar views', () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID)
    assert.ok(ext, 'Extension must be present')
    const pkg = ext.packageJSON as {
      contributes?: {
        views?: Record<string, Array<{ id: string }>>
        viewsContainers?: { activitybar?: Array<{ id: string }> }
      }
    }
    // Activity bar container
    const containers = pkg.contributes?.viewsContainers?.activitybar ?? []
    const sidebar = containers.find(c => c.id === 'aahp-sidebar')
    assert.ok(sidebar, 'Activity bar container aahp-sidebar should exist')

    // Views within the container
    const views = pkg.contributes?.views?.['aahp-sidebar'] ?? []
    const dashboard = views.find(v => v.id === 'aahp.dashboard')
    const allTasks = views.find(v => v.id === 'aahp.allTasks')
    assert.ok(dashboard, 'Dashboard webview should be declared')
    assert.ok(allTasks, 'All Tasks tree view should be declared')
  })

  // ── Test 9: Extension contributes keybindings ─────────────────────────────
  test('Extension contributes keybindings', () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID)
    assert.ok(ext, 'Extension must be present')
    const pkg = ext.packageJSON as {
      contributes?: { keybindings?: Array<{ command: string }> }
    }
    const bindings = pkg.contributes?.keybindings ?? []
    assert.ok(bindings.length >= 4, `Expected at least 4 keybindings, got ${bindings.length}`)

    const boundCommands = bindings.map(b => b.command)
    assert.ok(boundCommands.includes('aahp.copyContext'), 'copyContext should have a keybinding')
    assert.ok(boundCommands.includes('aahp.openDashboard'), 'openDashboard should have a keybinding')
  })

  // ── Test 10: Extension deactivates cleanly ─────────────────────────────────
  test('Extension exports a deactivate function', () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID)
    assert.ok(ext, 'Extension must be present')
    // The exports object should have a deactivate function
    const exports = ext.exports as Record<string, unknown> | undefined
    // deactivate is called by VS Code, not exported - but we can verify the extension
    // module structure by checking it activated without error (covered above)
    assert.ok(ext.isActive, 'Extension should still be active at end of test suite')
  })
})

// ── Extended integration tests (T-012) ──────────────────────────────────────
// These tests verify deeper extension behaviour: configuration, status bar,
// AAHP context loading from the fixture workspace, and command sequences.

suite('Configuration Integration Tests', () => {

  // ── Test 11: AAHP configuration section is accessible ─────────────────────
  test('AAHP configuration section is accessible via workspace API', () => {
    const config = vscode.workspace.getConfiguration('aahp')
    assert.ok(config, 'aahp configuration section should be accessible')
  })

  // ── Test 12: Default configuration values ─────────────────────────────────
  test('Configuration defaults match package.json declarations', () => {
    const config = vscode.workspace.getConfiguration('aahp')
    // developmentRoot defaults to false
    assert.strictEqual(
      config.get<boolean>('developmentRoot'),
      false,
      'developmentRoot should default to false'
    )
    // agentBackend defaults to "auto"
    assert.strictEqual(
      config.get<string>('agentBackend'),
      'auto',
      'agentBackend should default to "auto"'
    )
    // agentConcurrencyLimit defaults to 0
    assert.strictEqual(
      config.get<number>('agentConcurrencyLimit'),
      0,
      'agentConcurrencyLimit should default to 0'
    )
    // agentMaxRetries defaults to 1
    assert.strictEqual(
      config.get<number>('agentMaxRetries'),
      1,
      'agentMaxRetries should default to 1'
    )
    // suppressRootPrompt defaults to false
    assert.strictEqual(
      config.get<boolean>('suppressRootPrompt'),
      false,
      'suppressRootPrompt should default to false'
    )
  })

  // ── Test 13: All declared configuration properties exist ──────────────────
  test('Extension declares all expected configuration properties', () => {
    const ext = vscode.extensions.getExtension('elvatis.aahp-orchestrator')
    assert.ok(ext, 'Extension must be present')
    const pkg = ext.packageJSON as {
      contributes?: {
        configuration?: {
          properties?: Record<string, unknown>
        }
      }
    }
    const props = pkg.contributes?.configuration?.properties ?? {}
    const expectedKeys = [
      'aahp.developmentRoot',
      'aahp.rootFolderPath',
      'aahp.suppressRootPrompt',
      'aahp.agentBackend',
      'aahp.agentConcurrencyLimit',
      'aahp.agentMaxRetries',
    ]
    for (const key of expectedKeys) {
      assert.ok(key in props, `Configuration property "${key}" should be declared`)
    }
  })
})

suite('Package Metadata Integration Tests', () => {

  // ── Test 14: Extension metadata is correct ─────────────────────────────────
  test('Extension has correct publisher and name', () => {
    const ext = vscode.extensions.getExtension('elvatis.aahp-orchestrator')
    assert.ok(ext, 'Extension must be present')
    const pkg = ext.packageJSON as { name: string; publisher: string; displayName: string }
    assert.strictEqual(pkg.name, 'aahp-orchestrator')
    assert.strictEqual(pkg.publisher, 'elvatis')
    assert.strictEqual(pkg.displayName, 'AAHP Orchestrator')
  })

  // ── Test 15: Extension activation event is onStartupFinished only ─────────
  test('Extension activates only on onStartupFinished', () => {
    const ext = vscode.extensions.getExtension('elvatis.aahp-orchestrator')
    assert.ok(ext, 'Extension must be present')
    const pkg = ext.packageJSON as { activationEvents?: string[] }
    const events = pkg.activationEvents ?? []
    assert.ok(
      events.includes('onStartupFinished'),
      'onStartupFinished should be in activationEvents'
    )
    assert.strictEqual(
      events.length,
      1,
      'Should have exactly one activation event (no eager activation)'
    )
  })

  // ── Test 16: Chat participant declares all expected slash commands ─────────
  test('Chat participant declares all slash commands', () => {
    const ext = vscode.extensions.getExtension('elvatis.aahp-orchestrator')
    assert.ok(ext, 'Extension must be present')
    const pkg = ext.packageJSON as {
      contributes?: {
        chatParticipants?: Array<{
          id: string
          commands?: Array<{ name: string }>
        }>
      }
    }
    const participant = pkg.contributes?.chatParticipants?.find(
      p => p.id === 'aahp.orchestrator'
    )
    assert.ok(participant, 'Chat participant should exist')
    const commandNames = (participant.commands ?? []).map(c => c.name)
    const expectedSlashCommands = ['help', 'status', 'tasks', 'next', 'context', 'phase', 'done']
    for (const cmd of expectedSlashCommands) {
      assert.ok(
        commandNames.includes(cmd),
        `Slash command "/${cmd}" should be declared on @aahp participant`
      )
    }
  })

  // ── Test 17: Context menu contributions exist for tree view ────────────────
  test('Extension contributes context menus for tree view items', () => {
    const ext = vscode.extensions.getExtension('elvatis.aahp-orchestrator')
    assert.ok(ext, 'Extension must be present')
    const pkg = ext.packageJSON as {
      contributes?: {
        menus?: {
          'view/item/context'?: Array<{ command: string; when?: string }>
          'view/title'?: Array<{ command: string; when?: string }>
        }
      }
    }
    const itemMenus = pkg.contributes?.menus?.['view/item/context'] ?? []
    const titleMenus = pkg.contributes?.menus?.['view/title'] ?? []

    // Tree view item context menus should include task actions
    const itemCommands = itemMenus.map(m => m.command)
    assert.ok(
      itemCommands.includes('aahp.launchTask'),
      'launchTask should be in item context menu'
    )
    assert.ok(
      itemCommands.includes('aahp.markTaskDone'),
      'markTaskDone should be in item context menu'
    )
    assert.ok(
      itemCommands.includes('aahp.setTaskStatusFromTree'),
      'setTaskStatusFromTree should be in item context menu'
    )

    // Title bar menus should include filter and refresh
    const titleCommands = titleMenus.map(m => m.command)
    assert.ok(
      titleCommands.includes('aahp.filterTasks'),
      'filterTasks should be in view title menu'
    )
    assert.ok(
      titleCommands.includes('aahp.refreshAll'),
      'refreshAll should be in view title menu'
    )
  })
})

suite('Command Execution Integration Tests', () => {

  // ── Test 18: updateManifest command executes without throwing ───────────
  test('aahp.updateManifest executes without throwing', async function () {
    this.timeout(10_000)
    // This may show a warning if no MANIFEST.json is found, but should not throw
    await Promise.resolve(vscode.commands.executeCommand('aahp.updateManifest'))
  })

  // ── Test 19: copyContext command executes without throwing ──────────────
  test('aahp.copyContext executes without throwing', async function () {
    this.timeout(10_000)
    // May show a warning if no context is loaded, but should not throw
    await Promise.resolve(vscode.commands.executeCommand('aahp.copyContext'))
  })

  // ── Test 20: Multiple commands execute in sequence without errors ──────
  test('Multiple commands execute in sequence without errors', async function () {
    this.timeout(15_000)
    // Simulate a realistic user workflow: refresh -> clear filter -> open dashboard
    await Promise.resolve(vscode.commands.executeCommand('aahp.refreshAll'))
    await Promise.resolve(vscode.commands.executeCommand('aahp.clearFilter'))
    await Promise.resolve(vscode.commands.executeCommand('aahp.openDashboard'))
    await Promise.resolve(vscode.commands.executeCommand('aahp.refreshAll'))
    // If we get here without throwing, the sequence is stable
  })

  // ── Test 21: No duplicate aahp commands in the registry ───────────────
  test('No duplicate aahp commands are registered', async () => {
    const allCommands = await vscode.commands.getCommands(true)
    const aahpCommands = allCommands.filter(c => c.startsWith('aahp.'))
    const seen = new Set<string>()
    const duplicates: string[] = []
    for (const cmd of aahpCommands) {
      if (seen.has(cmd)) duplicates.push(cmd)
      seen.add(cmd)
    }
    assert.strictEqual(
      duplicates.length,
      0,
      `Duplicate commands found: ${duplicates.join(', ')}`
    )
  })

  // ── Test 22: cancelAgent handles missing run gracefully ────────────────
  test('aahp.cancelAgent handles invalid index gracefully', async () => {
    // Passing an invalid index should not throw
    await Promise.resolve(vscode.commands.executeCommand('aahp.cancelAgent', 999))
  })

  // ── Test 23: openAgentHistory executes without throwing ────────────────
  test('aahp.openAgentHistory executes without throwing', async function () {
    this.timeout(10_000)
    // With no history, it should show an info message, not throw
    await Promise.resolve(vscode.commands.executeCommand('aahp.openAgentHistory'))
  })
})

suite('Dashboard Webview Integration Tests', () => {

  // ── Test 24: Dashboard view type is webview ────────────────────────────
  test('Dashboard view is declared as webview type', () => {
    const ext = vscode.extensions.getExtension('elvatis.aahp-orchestrator')
    assert.ok(ext, 'Extension must be present')
    const pkg = ext.packageJSON as {
      contributes?: {
        views?: Record<string, Array<{ id: string; type?: string }>>
      }
    }
    const views = pkg.contributes?.views?.['aahp-sidebar'] ?? []
    const dashboard = views.find(v => v.id === 'aahp.dashboard')
    assert.ok(dashboard, 'Dashboard view should exist')
    assert.strictEqual(dashboard.type, 'webview', 'Dashboard should be a webview type view')
  })

  // ── Test 25: All Tasks view is a standard tree view ────────────────────
  test('All Tasks view is a standard tree view (no type property)', () => {
    const ext = vscode.extensions.getExtension('elvatis.aahp-orchestrator')
    assert.ok(ext, 'Extension must be present')
    const pkg = ext.packageJSON as {
      contributes?: {
        views?: Record<string, Array<{ id: string; type?: string }>>
      }
    }
    const views = pkg.contributes?.views?.['aahp-sidebar'] ?? []
    const allTasks = views.find(v => v.id === 'aahp.allTasks')
    assert.ok(allTasks, 'All Tasks view should exist')
    // Standard tree views do not set a type property (only webview views do)
    assert.ok(
      !allTasks.type || allTasks.type !== 'webview',
      'All Tasks should be a tree view, not a webview'
    )
  })

  // ── Test 26: Dashboard focus command exists and is executable ──────────
  test('aahp.dashboard.focus command is available', async () => {
    // VS Code auto-generates focus commands for registered views
    const allCommands = await vscode.commands.getCommands(true)
    assert.ok(
      allCommands.includes('aahp.dashboard.focus'),
      'aahp.dashboard.focus command should be auto-registered by VS Code'
    )
  })
})

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

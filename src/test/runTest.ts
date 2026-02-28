import * as path from 'path'
import { runTests } from '@vscode/test-electron'

async function main(): Promise<void> {
  // The folder containing the extension manifest (package.json)
  const extensionDevelopmentPath = path.resolve(__dirname, '../../')

  // The path to the test runner script (compiled index.js that exports run())
  const extensionTestsPath = path.resolve(__dirname, './suite/index')

  // A workspace folder with a test .ai/handoff/MANIFEST.json fixture
  const testWorkspace = path.resolve(__dirname, '../../src/test/fixtures/workspace')

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
      testWorkspace,
      '--disable-extensions',
      '--disable-gpu',
    ],
  })
}

main().catch(err => {
  console.error('Failed to run integration tests:', err)
  process.exit(1)
})

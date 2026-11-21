import * as path from 'path';
import { runTests } from '@vscode/test-electron';

/** Launches a real VS Code (Extension Development Host) and runs e2e/suite.ts inside it. */
async function main(): Promise<void> {
  const root = path.resolve(__dirname, '..', '..');
  const fixtureConfig = path.join(root, 'test', 'fixtures');
  const version = process.env.VSCODE_TEST_VERSION || '1.85.2';
  // When launched from a VS Code terminal / extension, inherited vars (notably
  // ELECTRON_RUN_AS_NODE) make the test VS Code exit immediately.
  for (const key of Object.keys(process.env)) {
    if (key === 'ELECTRON_RUN_AS_NODE' || key.startsWith('VSCODE_')) {
      delete process.env[key];
    }
  }
  try {
    await runTests({
      version,
      extensionDevelopmentPath: root,
      extensionTestsPath: path.join(__dirname, 'suite'),
      // Point the extension at fixture data, never the developer's real sessions.
      extensionTestsEnv: { CLAUDE_CONFIG_DIR: fixtureConfig },
      launchArgs: ['--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
    });
  } catch (err) {
    console.error('E2E tests failed:', err);
    process.exit(1);
  }
}

void main();

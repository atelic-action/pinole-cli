#!/usr/bin/env node
// The prepare step: build dist/ from src/ on install.
//
// npm runs a git dependency's preparation with the outer command's
// configuration in the environment (every npm_config_* variable), so
// `npm install -g --allow-scripts=pinole github:...` prepares the checkout
// as if it were itself a global install, never places the dev dependencies
// the build needs, and would reject a nested project scoped install that
// inherits --allow-scripts. When typescript is missing here, install the
// dev dependencies into this checkout with a scrubbed environment,
// explicitly non global and without scripts (so this step cannot recurse),
// then build.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toLowerCase().startsWith('npm_config_')));
env.npm_config_global = 'false';

function run(args) {
  const result = spawnSync(npm, args, { cwd: root, stdio: 'inherit', env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!existsSync(join(root, 'node_modules', 'typescript'))) {
  run(['install', '--global=false', '--no-save', '--no-audit', '--no-fund', '--ignore-scripts', '--include=dev']);
}
run(['run', 'build']);

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { runPullOpenapi } from '../lib/openapi-pull.js';
import { runGenerateSchemasFile } from '../lib/generate-schemas-file.js';
import { patchGeneratedHttpClient } from '../lib/patch-http-client.js';

export async function codegenClientCommand(cwd: string): Promise<void> {
  await runPullOpenapi(cwd);

  const args = [
    'swagger-typescript-api',
    'generate',
    '--path', './generated/openapi.json',
    '--output', './generated',
    '--name', 'api.ts',
    '--modular',
    '--axios',
  ];

  const customConfigPath = path.join(cwd, 'swagger-typescript-api.config.cjs');
  if (existsSync(customConfigPath)) {
    args.push('--custom-config', './swagger-typescript-api.config.cjs');
  }

  const result = spawnSync('npx', args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  await patchGeneratedHttpClient(cwd);
}

export async function codegenSchemasCommand(cwd: string): Promise<void> {
  await runPullOpenapi(cwd);
  await runGenerateSchemasFile(cwd);
}

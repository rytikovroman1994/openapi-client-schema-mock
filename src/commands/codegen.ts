import { spawnSync } from 'node:child_process';

import { runPullOpenapi } from '../lib/openapi-pull.js';
import { runGenerateSchemasFile } from '../lib/generate-schemas-file.js';

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
    '--templates', './templates/swagger-typescript-api',
    '--custom-config', './swagger-typescript-api.config.cjs',
  ];

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
}

export async function codegenSchemasCommand(cwd: string): Promise<void> {
  await runPullOpenapi(cwd);
  await runGenerateSchemasFile(cwd);
}

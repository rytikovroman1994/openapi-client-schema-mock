import path from 'node:path';

import { generateResponseMocks } from '../lib/generate-response-mocks.js';

export async function codegenMocksCommand(cwd: string, outDir: string): Promise<void> {
  const resolvedOut = path.resolve(cwd, outDir);
  await generateResponseMocks({ cwd, outDir: resolvedOut });
}

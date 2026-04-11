import fs from 'node:fs/promises';
import path from 'node:path';

import {
  createOpenApiHttpClientFromEnv,
  resolvedOpenApiAuthKind,
} from './openapi-auth-factory.js';

export function resolveOpenApiSchemaPath(): string {
  const fromUrl = process.env.SWAGGER_SCHEMA_URL?.trim();
  const fromPath = process.env.SWAGGER_SCHEMA_PATH?.trim();
  const fromEnv = fromUrl ?? fromPath;
  if (!fromEnv) {
    throw new Error('Задайте SWAGGER_SCHEMA_URL (URL или путь) или SWAGGER_SCHEMA_PATH');
  }
  if (fromEnv.startsWith('http')) {
    const url = new URL(fromEnv);
    return `${url.pathname}${url.search}`;
  }
  return fromEnv.startsWith('/') ? fromEnv : `/${fromEnv}`;
}

export async function runPullOpenapi(cwd: string): Promise<void> {
  const outputPath = path.join(cwd, 'generated', 'openapi.json');

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const ctx = await createOpenApiHttpClientFromEnv();
  try {
    const schemaPath = resolveOpenApiSchemaPath();
    const response = await ctx.get(schemaPath, { timeout: 180_000 });

    if (!response.ok()) {
      throw new Error(
        `Не удалось скачать OpenAPI: ${schemaPath} → HTTP ${response.status()}`,
      );
    }

    const body = await response.text();

    try {
      JSON.parse(body);
    } catch {
      throw new Error('Ответ схемы не является валидным JSON — проверьте URL и авторизацию');
    }

    const kind = resolvedOpenApiAuthKind();
    if (kind === 'django-session' && !ctx.cookieNames().includes('sessionid')) {
      throw new Error(
        'Режим django-session: после запроса схемы не найдена cookie sessionid',
      );
    }
    console.log(`Доступ к OpenAPI подтверждён (режим: ${kind})`);

    await fs.writeFile(outputPath, body, 'utf8');
    console.log(`OpenAPI сохранён: ${outputPath} (${body.length} байт)`);
  } finally {
    await ctx.dispose();
  }
}

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SET_HEADER_MARKER = 'public setHeader(name: string, value: string): void';

const HTTP_CLIENT_SNIPPET = `
  public setHeader(name: string, value: string): void {
    this.instance.defaults.headers[name] = value;
  }

  public removeHeader(name: string): void {
    delete this.instance.defaults.headers[name];
  }
`;

/**
 * После `swagger-typescript-api`: дописывает в `generated/http-client.ts` методы
 * `setHeader` / `removeHeader` на axios `defaults.headers` (как в кастомных шаблонах раньше).
 */
export async function patchGeneratedHttpClient(cwd: string): Promise<void> {
  const filePath = path.join(cwd, 'generated', 'http-client.ts');
  let content = await readFile(filePath, 'utf8');

  if (content.includes(SET_HEADER_MARKER)) {
    return;
  }

  const anchor =
    /(public setSecurityData\s*=\s*\(data:\s*SecurityDataType\s*\|\s*null\)\s*=>\s*\{[\s\S]*?\}\s*;?)(\r?\n\s*protected mergeRequestParams)/m;

  if (!anchor.test(content)) {
    throw new Error(
      `[openapi-client-schema-mock] patch-http-client: не найден якорь перед mergeRequestParams в ${filePath}. ` +
        'Обновите регулярное выражение в src/lib/patch-http-client.ts под новую версию swagger-typescript-api.',
    );
  }

  content = content.replace(anchor, `$1\n${HTTP_CLIENT_SNIPPET}$2`);
  await writeFile(filePath, content, 'utf8');
}

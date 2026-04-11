import fs from 'node:fs/promises';
import path from 'node:path';

import { faker } from '@faker-js/faker';

type OpenApiDoc = {
  paths?: Record<string, Record<string, unknown>>;
  components?: { schemas?: Record<string, Record<string, unknown>> };
};

type MediaTypeObject = { schema?: Record<string, unknown> };

type ResponseObject = {
  content?: Record<string, MediaTypeObject>;
  description?: string;
};

type OperationObject = {
  responses?: Record<string, ResponseObject>;
};

type ApiMethodMeta = {
  tag: string;
  operationName: string;
  methodName: string;
  httpMethod: string;
  path: string;
  responseType: string;
};

const SUCCESS_STATUSES = ['200', '201', '202', '203'] as const;

function pickJsonSchemaFromResponses(
  responses: Record<string, ResponseObject> | undefined,
): { status: string; schema?: Record<string, unknown> } | undefined {
  if (!responses) {
    return undefined;
  }
  const picked = SUCCESS_STATUSES.map((code) => {
    const r = responses[code];
    const content = r?.content;
    if (!content) {
      return undefined;
    }
    const jsonKey = Object.keys(content).find((k) => k.includes('json'));
    if (!jsonKey || !content[jsonKey]?.schema) {
      return undefined;
    }
    const schema = content[jsonKey].schema as Record<string, unknown>;
    return { status: code, schema };
  }).find(Boolean);
  if (picked) {
    return picked;
  }
  if (responses['204'] && !responses['204'].content) {
    return { status: '204' };
  }
  return undefined;
}

function getOperation(
  doc: OpenApiDoc,
  apiPath: string,
  method: string,
): OperationObject | undefined {
  const { paths } = doc;
  if (!paths) {
    return undefined;
  }
  const m = method.toLowerCase();
  const direct = paths[apiPath]?.[m] as OperationObject | undefined;
  if (direct) {
    return direct;
  }
  const trimmed = apiPath.endsWith('/') ? apiPath.slice(0, -1) : `${apiPath}/`;
  return paths[trimmed]?.[m] as OperationObject | undefined;
}

function refNameFromRef(ref: string): string | undefined {
  const prefix = '#/components/schemas/';
  if (!ref.startsWith(prefix)) {
    return undefined;
  }
  return ref.slice(prefix.length);
}

function getSchemaByName(
  doc: OpenApiDoc,
  name: string,
): Record<string, unknown> | undefined {
  const s = doc.components?.schemas?.[name];
  return s && typeof s === 'object' ? (s as Record<string, unknown>) : undefined;
}

/** Первый аргумент дженерика `this.request<HERE, any>`. */
function extractFirstRequestGenericArg(source: string, fromIndex: number): string | null {
  const needle = 'this.request<';
  const start = source.indexOf(needle, fromIndex);
  if (start === -1) {
    return null;
  }
  let i = start + needle.length;
  const argStart = i;
  let depth = 1;
  for (; i < source.length; i += 1) {
    const c = source[i];
    if (c === '<') {
      depth += 1;
    } else if (c === '>') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(argStart, i).trim();
      }
    } else if (c === ',' && depth === 1) {
      return source.slice(argStart, i).trim();
    }
  }
  return null;
}

function parseApiTsMethods(apiSource: string): ApiMethodMeta[] {
  const results: ApiMethodMeta[] = [];

  const scanFrom = (pos: number): void => {
    const tagsIdx = apiSource.indexOf('* @tags ', pos);
    if (tagsIdx === -1) {
      return;
    }
    const tagLineEnd = apiSource.indexOf('\n', tagsIdx);
    const tagLine = apiSource.slice(tagsIdx, tagLineEnd);
    const tagMatch = tagLine.match(/\* @tags (\S+)/);
    if (!tagMatch) {
      scanFrom(tagsIdx + 1);
      return;
    }
    const tag = tagMatch[1];
    const windowEnd = Math.min(apiSource.length, tagsIdx + 12000);
    const window = apiSource.slice(tagsIdx, windowEnd);
    const nameMatch = window.match(/\* @name (\S+)/);
    const requestMatch = window.match(/\* @request ([A-Za-z]+):(\S+)/);
    if (!nameMatch || !requestMatch) {
      scanFrom(tagsIdx + 1);
      return;
    }
    const docClose = window.indexOf('*/');
    if (docClose === -1) {
      scanFrom(tagsIdx + 1);
      return;
    }
    const afterClose = window.slice(docClose + 2);
    const methodMatch = afterClose.match(/^\s*(\w+)\s*=/);
    if (!methodMatch) {
      scanFrom(tagsIdx + 1);
      return;
    }
    const methodName = methodMatch[1];
    const absAfterClose = tagsIdx + docClose + 2;
    const searchEnd = Math.min(apiSource.length, absAfterClose + 8000);
    const methodBody = apiSource.slice(absAfterClose, searchEnd);
    const reqPos = methodBody.indexOf('this.request<');
    if (reqPos === -1) {
      scanFrom(tagsIdx + 1);
      return;
    }
    const responseType = extractFirstRequestGenericArg(apiSource, absAfterClose + reqPos);
    if (!responseType) {
      scanFrom(tagsIdx + 1);
      return;
    }
    results.push({
      tag,
      operationName: nameMatch[1],
      methodName,
      httpMethod: requestMatch[1].toLowerCase(),
      path: requestMatch[2].trim(),
      responseType,
    });
    scanFrom(tagsIdx + 1);
  };

  scanFrom(0);
  return results;
}

type TsTypeKind =
  | { kind: 'void' }
  | { kind: 'string' }
  | { kind: 'number' }
  | { kind: 'boolean' }
  | { kind: 'unknown' }
  | { kind: 'any' }
  | { kind: 'array'; inner: string }
  | { kind: 'ref'; name: string };

function classifyTsResponseType(raw: string): TsTypeKind {
  const t = raw.trim();
  if (t === 'void') {
    return { kind: 'void' };
  }
  if (t === 'string') {
    return { kind: 'string' };
  }
  if (t === 'number') {
    return { kind: 'number' };
  }
  if (t === 'boolean') {
    return { kind: 'boolean' };
  }
  if (t === 'unknown') {
    return { kind: 'unknown' };
  }
  if (t === 'any') {
    return { kind: 'any' };
  }
  const parenArray = t.match(/^\(([\w.]+)\)\[\]$/);
  if (parenArray) {
    return { kind: 'array', inner: parenArray[1] };
  }
  const simpleArray = t.match(/^([\w.]+)\[\]$/);
  if (simpleArray) {
    return { kind: 'array', inner: simpleArray[1] };
  }
  const pipe = t.split('|').map((s) => s.trim()).filter(Boolean)[0];
  if (pipe && pipe !== t) {
    return classifyTsResponseType(pipe);
  }
  return { kind: 'ref', name: t };
}

const MAX_SCHEMA_UNWRAP_DEPTH = 80;

function unwrapSchema(
  schema: Record<string, unknown> | undefined,
  doc: OpenApiDoc,
  refChain: string[],
  depth = 0,
): Record<string, unknown> | undefined {
  if (depth > MAX_SCHEMA_UNWRAP_DEPTH) {
    return { type: 'object', properties: {} };
  }
  if (!schema || typeof schema !== 'object') {
    return undefined;
  }
  if (typeof schema.$ref === 'string') {
    const name = refNameFromRef(schema.$ref);
    if (!name) {
      return schema;
    }
    if (refChain.includes(name)) {
      return { type: 'object', properties: {} };
    }
    const resolved = getSchemaByName(doc, name);
    return unwrapSchema(resolved, doc, [...refChain, name], depth + 1) ?? schema;
  }
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    const parts = schema.allOf as Record<string, unknown>[];
    const mergedProps: Record<string, unknown> = {};
    let mergedRequired: string[] = [];
    let enumSchema: Record<string, unknown> | undefined;
    for (let i = 0; i < parts.length; i += 1) {
      const u = unwrapSchema(parts[i] as Record<string, unknown>, doc, refChain, depth + 1);
      if (u) {
        if (Array.isArray(u.enum)) {
          enumSchema = u;
        }
        if (u.type === 'object' && u.properties && typeof u.properties === 'object') {
          Object.assign(mergedProps, u.properties);
          if (Array.isArray(u.required)) {
            mergedRequired = mergedRequired.concat(u.required as string[]);
          }
        }
      }
    }
    if (Object.keys(mergedProps).length > 0) {
      return {
        type: 'object',
        properties: mergedProps,
        required: [...new Set(mergedRequired)],
      };
    }
    if (enumSchema) {
      return enumSchema;
    }
    return unwrapSchema(parts[0] as Record<string, unknown>, doc, refChain, depth + 1);
  }
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return unwrapSchema(schema.oneOf[0] as Record<string, unknown>, doc, refChain, depth + 1);
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return unwrapSchema(schema.anyOf[0] as Record<string, unknown>, doc, refChain, depth + 1);
  }
  return schema;
}

function truncateToMaxLen(value: string, maxLen?: number): string {
  if (maxLen == null || value.length <= maxLen) {
    return value;
  }
  return value.slice(0, maxLen);
}

function exampleScalarFromFormat(
  format: string | undefined,
  keyHint: string,
  maxLength?: number,
): string {
  if (format === 'date') {
    return truncateToMaxLen(
      faker.date.past().toISOString().slice(0, 10),
      maxLength,
    );
  }
  if (format === 'date-time') {
    return truncateToMaxLen(faker.date.recent().toISOString(), maxLength);
  }
  if (format === 'uuid') {
    return faker.string.uuid();
  }
  if (format === 'uri' || format === 'uri-reference') {
    return truncateToMaxLen(
      faker.internet.url({ appendSlash: false }),
      maxLength,
    );
  }
  if (format === 'email') {
    return truncateToMaxLen(faker.internet.email(), maxLength);
  }
  const words = faker.lorem.words({ min: 2, max: 5 });
  return truncateToMaxLen(`${keyHint}: ${words}`, maxLength);
}

const MAX_EXAMPLE_DEPTH = 80;

function exampleFromUnwrappedSchema(
  schema: Record<string, unknown> | undefined,
  doc: OpenApiDoc,
  propertyKey: string,
  refChain: string[],
  depth = 0,
): unknown {
  if (depth > MAX_EXAMPLE_DEPTH) {
    return null;
  }
  if (!schema) {
    return null;
  }
  const unwrapped = unwrapSchema(schema, doc, refChain, depth);
  if (!unwrapped) {
    return null;
  }
  if (Array.isArray(unwrapped.enum) && unwrapped.enum.length > 0) {
    return faker.helpers.arrayElement(unwrapped.enum as (string | number | boolean)[]);
  }
  const t = unwrapped.type;
  if (t === 'string') {
    if (typeof unwrapped.default === 'string') {
      return unwrapped.default;
    }
    const maxLen = typeof unwrapped.maxLength === 'number' ? unwrapped.maxLength : undefined;
    return exampleScalarFromFormat(
      unwrapped.format as string | undefined,
      propertyKey,
      maxLen,
    );
  }
  if (t === 'integer' || t === 'number') {
    if (typeof unwrapped.default === 'number') {
      return unwrapped.default;
    }
    const min = typeof unwrapped.minimum === 'number' ? unwrapped.minimum : undefined;
    const max = typeof unwrapped.maximum === 'number' ? unwrapped.maximum : undefined;
    if (t === 'integer') {
      const lo = min != null ? Math.ceil(min) : 1;
      const hi = max != null ? Math.floor(max) : lo + 9999;
      const safeHi = hi < lo ? lo : hi;
      return faker.number.int({ min: lo, max: safeHi });
    }
    const lo = min != null ? min : 0;
    const hi = max != null ? max : lo + 1;
    const safeHi = hi < lo ? lo : hi;
    return faker.number.float({ min: lo, max: safeHi, fractionDigits: 2 });
  }
  if (t === 'boolean') {
    return typeof unwrapped.default === 'boolean' ? unwrapped.default : faker.datatype.boolean();
  }
  if (t === 'array') {
    const items = unwrapped.items as Record<string, unknown> | undefined;
    const one = exampleFromUnwrappedSchema(items, doc, `${propertyKey}Item`, refChain, depth + 1);
    return [one];
  }
  if (t === 'object' || unwrapped.properties) {
    const props = (unwrapped.properties || {}) as Record<string, Record<string, unknown>>;
    const required = new Set(
      Array.isArray(unwrapped.required) ? (unwrapped.required as string[]) : [],
    );
    const out: Record<string, unknown> = {};
    const keys = Object.keys(props);
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      const propSchema = props[key];
      const isRequired = required.has(key);
      const val = exampleFromUnwrappedSchema(propSchema, doc, key, refChain, depth + 1);
      if (isRequired || (val !== null && val !== undefined)) {
        out[key] = val;
      }
    }
    return out;
  }
  return null;
}

function exampleFromComponentsSchema(
  doc: OpenApiDoc,
  schema: Record<string, unknown>,
): unknown {
  return exampleFromUnwrappedSchema(schema, doc, 'root', []);
}

function fallbackDataFromTsType(doc: OpenApiDoc, responseType: string): unknown {
  const kind = classifyTsResponseType(responseType);
  if (kind.kind === 'void') {
    return undefined;
  }
  if (kind.kind === 'string') {
    return faker.lorem.sentence();
  }
  if (kind.kind === 'number') {
    return faker.number.int({ min: 0, max: 10_000 });
  }
  if (kind.kind === 'boolean') {
    return faker.datatype.boolean();
  }
  if (kind.kind === 'unknown' || kind.kind === 'any') {
    return {};
  }
  if (kind.kind === 'array') {
    const inner = getSchemaByName(doc, kind.inner);
    const item = inner
      ? exampleFromComponentsSchema(doc, inner)
      : {};
    return [item];
  }
  const named = getSchemaByName(doc, kind.name);
  if (named) {
    return exampleFromComponentsSchema(doc, named);
  }
  return {};
}

function resolveMockFromOperation(
  doc: OpenApiDoc,
  apiPath: string,
  httpMethod: string,
  responseType: string,
): { status: number; data: unknown } {
  const op = getOperation(doc, apiPath, httpMethod);
  const picked = pickJsonSchemaFromResponses(op?.responses);
  if (picked?.status === '204') {
    return { status: 204, data: undefined };
  }
  if (picked?.schema) {
    const data = exampleFromComponentsSchema(doc, picked.schema);
    return { status: Number(picked.status), data };
  }
  const kind = classifyTsResponseType(responseType);
  if (kind.kind === 'void') {
    return { status: 200, data: undefined };
  }
  return { status: 200, data: fallbackDataFromTsType(doc, responseType) };
}

function escapeSingleQuotedString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function serializeValue(value: unknown, indent: string): string {
  if (value === undefined) {
    return 'undefined';
  }
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return `'${escapeSingleQuotedString(value)}'`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    const inner = value.map((v) => `${indent}  ${serializeValue(v, `${indent}  `)}`).join(',\n');
    return `[\n${inner},\n${indent}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as object);
    if (keys.length === 0) {
      return '{}';
    }
    const lines = keys.map((k) => {
      const safeKey = /^[a-zA-Z_$][\w$]*$/.test(k) ? k : `'${escapeSingleQuotedString(k)}'`;
      const v = (value as Record<string, unknown>)[k];
      return `${indent}  ${safeKey}: ${serializeValue(v, `${indent}  `)}`;
    });
    return `{\n${lines.join(',\n')},\n${indent}}`;
  }
  return 'null';
}

function sanitizeDirSegment(tag: string): string {
  return tag.replace(/[/\\:*?"<>|]/g, '_');
}

function buildMockFileContent(meta: ApiMethodMeta, status: number, data: unknown): string {
  const exportName = `${meta.methodName}Mock`;
  const body = serializeValue({ status, data }, '');
  return `/* eslint-disable */
/**
 * Автогенерация по OpenAPI и generated/Api.ts — не править вручную.
 * @name ${meta.operationName} ${meta.httpMethod.toUpperCase()} ${meta.path}
 */
export const ${exportName} = ${body};
`;
}

export type GenerateResponseMocksOptions = {
  cwd: string;
  outDir: string;
  apiRelativePath?: string;
  openapiRelativePath?: string;
};

export async function generateResponseMocks(options: GenerateResponseMocksOptions): Promise<void> {
  const {
    cwd,
    outDir,
    apiRelativePath = 'generated/Api.ts',
    openapiRelativePath = 'generated/openapi.json',
  } = options;

  faker.seed(42_424);

  const apiPath = path.resolve(cwd, apiRelativePath);
  const openapiPath = path.resolve(cwd, openapiRelativePath);
  const targetRoot = path.resolve(cwd, outDir);

  const [apiSource, openapiRaw] = await Promise.all([
    fs.readFile(apiPath, 'utf8'),
    fs.readFile(openapiPath, 'utf8'),
  ]);
  const doc = JSON.parse(openapiRaw) as OpenApiDoc;
  const methods = parseApiTsMethods(apiSource);
  if (methods.length === 0) {
    throw new Error(`Не удалось разобрать методы в ${apiRelativePath}`);
  }

  await fs.mkdir(targetRoot, { recursive: true });

  await Promise.all(
    methods.map(async (meta) => {
      const { status, data } = resolveMockFromOperation(
        doc,
        meta.path,
        meta.httpMethod,
        meta.responseType,
      );
      const sub = path.join(targetRoot, sanitizeDirSegment(meta.tag));
      await fs.mkdir(sub, { recursive: true });
      const filePath = path.join(sub, `${meta.methodName}.mock.ts`);
      const content = buildMockFileContent(meta, status, data);
      await fs.writeFile(filePath, content, 'utf8');
    }),
  );

  const indexLines = methods
    .map((meta) => {
      const tag = sanitizeDirSegment(meta.tag);
      return `./${tag}/${meta.methodName}.mock`;
    })
    .sort((a, b) => a.localeCompare(b))
    .map((spec) => `export * from '${spec}';`);

  const indexContent = `/* eslint-disable */
/**
 * Автогенерация — реэкспорт всех моков из подкаталогов.
 */
${indexLines.join('\n')}
`;

  await fs.writeFile(path.join(targetRoot, 'index.ts'), indexContent, 'utf8');

  console.log(
    `Записано ${methods.length} файлов моков и index.ts в ${path.relative(cwd, targetRoot) || '.'}`,
  );
}

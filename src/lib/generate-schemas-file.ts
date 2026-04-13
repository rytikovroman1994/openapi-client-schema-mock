import fs from 'node:fs/promises';
import path from 'node:path';

import { openapiSchemaToJsonSchema } from '@openapi-contrib/openapi-schema-to-json-schema';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'] as const;

/** Локальный helper AJV, который пишется в проект-потребитель. */
const LOCAL_AJV_UTIL_PATH = ['src', 'utils', 'ajv-schemas.util.ts'];
const LOCAL_AJV_UTIL_IMPORT = '../src/utils/ajv-schemas.util';

type OpenApiDoc = {
  paths?: Record<string, Record<string, unknown>>;
};

type MediaTypeObject = { schema?: Record<string, unknown> };

type ParameterObject = {
  name: string;
  in: string;
  required?: boolean;
  schema?: Record<string, unknown>;
};

type RequestBodyObject = {
  content?: Record<string, MediaTypeObject>;
};

type ResponseObject = {
  content?: Record<string, MediaTypeObject>;
};

type OperationObject = {
  operationId?: string;
  parameters?: ParameterObject[];
  requestBody?: RequestBodyObject;
  responses?: Record<string, ResponseObject>;
};

type GeneratedSchemaFn = {
  exportName: string;
  commentLines: string[];
  schema: Record<string, unknown>;
};

function pickJsonMediaContent(
  content?: Record<string, MediaTypeObject>,
): MediaTypeObject | undefined {
  if (!content) {
    return undefined;
  }
  const jsonKey = Object.keys(content).find((k) => k.includes('json'));
  return jsonKey ? content[jsonKey] : undefined;
}

function tryConvertSchema(
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!schema || typeof schema !== 'object') {
    return undefined;
  }
  try {
    return openapiSchemaToJsonSchema(schema as never) as Record<string, unknown>;
  } catch {
    return schema;
  }
}

function parametersToJsonSchema(
  parameters: ParameterObject[] | undefined,
): Record<string, unknown> | undefined {
  if (!parameters?.length) {
    return undefined;
  }
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  parameters.forEach((p) => {
    if (!p.schema) {
      return;
    }
    const converted = tryConvertSchema(p.schema);
    if (converted) {
      properties[p.name] = converted;
    }
    if (p.required) {
      required.push(p.name);
    }
  });

  if (!Object.keys(properties).length) {
    return undefined;
  }

  return {
    type: 'object',
    properties,
    ...(required.length ? { required } : {}),
  };
}

function sanitizeOperationId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_|_$/g, '') || 'unnamed';
}

function capitalizeWord(w: string): string {
  if (!w) {
    return w;
  }
  if (w.length === 1) {
    return w.toUpperCase();
  }
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

function splitKebabSnake(s: string): string[] {
  return s.split(/[-_]/).filter(Boolean);
}

function pathToPascal(pathItem: string): string {
  const segments = pathItem.split('/').filter(Boolean);
  if (!segments.length) {
    return 'Root';
  }
  return segments
    .map((segment) => {
      const inner = segment.startsWith('{') && segment.endsWith('}')
        ? segment.slice(1, -1)
        : segment;
      return splitKebabSnake(inner).map(capitalizeWord).join('');
    })
    .join('');
}

function methodToPascal(method: string): string {
  const m = method.toLowerCase();
  return m.charAt(0).toUpperCase() + m.slice(1);
}

function responseStatusToSuffix(status: string): string {
  if (status === '200') {
    return 'Ok';
  }
  if (status === 'default') {
    return 'Default';
  }
  if (/^\d{3}$/.test(status)) {
    return status;
  }
  return capitalizeWord(sanitizeOperationId(status).replace(/[^a-zA-Z0-9]/g, '_')) || 'Response';
}

function isValidJsIdentifierStart(name: string): boolean {
  return /^[A-Za-z_$]/.test(name);
}

function allocateExportName(base: string, used: Map<string, number>): string {
  let candidate = base;
  if (!isValidJsIdentifierStart(candidate)) {
    candidate = `_${candidate}`;
  }
  const n = used.get(candidate) ?? 0;
  used.set(candidate, n + 1);
  if (n === 0) {
    return candidate;
  }
  return `${candidate}_${n + 1}`;
}

/**
 * Сериализация JSON Schema в литерал объекта TypeScript (без JSON.parse).
 */
function schemaToTsObjectLiteral(value: unknown, indent: number): string {
  const pad = '  '.repeat(indent);
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (!value.length) {
      return '[]';
    }
    const inner = value
      .map((v) => schemaToTsObjectLiteral(v, indent + 1))
      .join(`,\n${pad}  `);
    return `[\n${pad}  ${inner}\n${pad}]`;
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o);
    if (!keys.length) {
      return '{}';
    }
    const inner = keys
      .map((k) => {
        const key = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k) ? k : JSON.stringify(k);
        return `${key}: ${schemaToTsObjectLiteral(o[k], indent + 1)}`;
      })
      .join(`,\n${pad}  `);
    return `{\n${pad}  ${inner}\n${pad}}`;
  }
  return 'null';
}

function collectSchemaFunctions(api: OpenApiDoc): GeneratedSchemaFn[] {
  const paths = api.paths ?? {};
  const usedIds = new Map<string, number>();
  const usedExportNames = new Map<string, number>();
  const out: GeneratedSchemaFn[] = [];

  Object.entries(paths).forEach(([pathItem, pathObj]) => {
    if (!pathObj || typeof pathObj !== 'object') {
      return;
    }

    HTTP_METHODS.forEach((method) => {
      const op = pathObj[method] as OperationObject | undefined;
      if (!op || typeof op !== 'object') {
        return;
      }

      let { operationId } = op;
      if (!operationId) {
        operationId = `${method}_${pathItem}`.replace(/[/{}]/g, '_');
      }

      const baseId = sanitizeOperationId(operationId);
      const count = (usedIds.get(baseId) ?? 0) + 1;
      usedIds.set(baseId, count);
      const uniqueId = count > 1 ? `${baseId}_${count}` : baseId;

      const requestBodyMedia = pickJsonMediaContent(op.requestBody?.content);
      const requestBodySchema = requestBodyMedia?.schema
        ? tryConvertSchema(requestBodyMedia.schema as Record<string, unknown>)
        : undefined;

      const parametersSchema = parametersToJsonSchema(op.parameters);

      const responses: Record<string, Record<string, unknown>> = {};
      if (op.responses) {
        Object.entries(op.responses).forEach(([status, resp]) => {
          const media = pickJsonMediaContent((resp as ResponseObject).content);
          const sch = media?.schema
            ? tryConvertSchema(media.schema as Record<string, unknown>)
            : undefined;
          if (sch) {
            responses[status] = sch;
          }
        });
      }

      const methodPascal = methodToPascal(method);
      const pathPascal = pathToPascal(pathItem);
      const prefix = `${methodPascal}${pathPascal}`;

      if (requestBodySchema) {
        const exportName = allocateExportName(`${prefix}RequestBody`, usedExportNames);
        out.push({
          exportName,
          commentLines: [
            ` * - Method: ${method.toUpperCase()}`,
            ` * - Path: ${pathItem}`,
            ` * - OperationId: ${uniqueId}`,
            ' * - Part: requestBody',
          ],
          schema: requestBodySchema,
        });
      }

      if (parametersSchema) {
        const exportName = allocateExportName(`${prefix}Parameters`, usedExportNames);
        out.push({
          exportName,
          commentLines: [
            ` * - Method: ${method.toUpperCase()}`,
            ` * - Path: ${pathItem}`,
            ` * - OperationId: ${uniqueId}`,
            ' * - Part: parameters',
          ],
          schema: parametersSchema,
        });
      }

      Object.entries(responses).forEach(([status, sch]) => {
        const exportName = allocateExportName(
          `${prefix}${responseStatusToSuffix(status)}`,
          usedExportNames,
        );
        out.push({
          exportName,
          commentLines: [
            ` * - Method: ${method.toUpperCase()}`,
            ` * - Path: ${pathItem}`,
            ` * - OperationId: ${uniqueId}`,
            ' * - Part: response',
            ` * - Code: ${status}`,
          ],
          schema: sch,
        });
      });
    });
  });

  return out;
}

export async function runGenerateSchemasFile(cwd: string): Promise<void> {
  const inputPath = path.join(cwd, 'generated', 'openapi.json');
  const outFile = path.join(cwd, 'generated', 'schemas.ts');
  const ajvUtilFile = path.join(cwd, ...LOCAL_AJV_UTIL_PATH);

  const raw = await fs.readFile(inputPath, 'utf8');
  const api = JSON.parse(raw) as OpenApiDoc;
  const fns = collectSchemaFunctions(api);

  const blocks = fns.map(({ exportName, commentLines, schema }) => {
    const comment = ['/**', ...commentLines, ' */'].join('\n');
    const literal = schemaToTsObjectLiteral(schema, 0);
    const body = `${comment}
export const ${exportName} = (data: any) => ajv.compile(${literal})(data);
`;
    return body;
  });

  const file = `/* eslint-disable */
/* tslint:disable */
// @ts-nocheck
/*
 * Generated from generated/openapi.json — по одной AJV-функции на схему (request / parameters / response).
 * Импорт экземпляра AJV из локального helper-файла.
 */

import { ajvForSchemas as ajv } from '${LOCAL_AJV_UTIL_IMPORT}';

${blocks.join('\n')}
`;

  const ajvUtilContent = `import Ajv from 'ajv';

/**
 * Общий экземпляр AJV для валидации схем из generated/schemas.ts.
 */
export const ajvForSchemas = new Ajv({
  allErrors: true,
  validateSchema: false,
  unknownFormats: 'ignore',
});
`;

  await fs.mkdir(path.dirname(ajvUtilFile), { recursive: true });
  await fs.writeFile(ajvUtilFile, ajvUtilContent, 'utf8');
  await fs.writeFile(outFile, file, 'utf8');
  console.log(`Записан ${ajvUtilFile}`);
  console.log(`Записан ${outFile} (${fns.length} схем-функций)`);
}

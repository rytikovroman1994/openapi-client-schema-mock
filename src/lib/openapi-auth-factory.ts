import type { HttpGetResult, OpenApiHttpClient } from './auth-session.js';
import {
  applyDefaultOpenApiHeaders,
  applySetCookies,
  buildCookieHeader,
  createAuthenticatedApiContextFromEnv,
  createCookieJarOpenApiClient,
  normalizeBaseUrl,
  seedJarFromCookieHeader,
} from './auth-session.js';
import { requireEnv } from './required-env.js';

export type OpenApiAuthKind = 'django-session' | 'bearer' | 'cookie' | 'anonymous';

/**
 * Какой клиент использовать при скачивании OpenAPI (`codegen client` / `codegen schemas`).
 * `OPENAPI_AUTH=auto` (по умолчанию): bearer → cookie → django-session → anonymous.
 */
export function resolvedOpenApiAuthKind(): OpenApiAuthKind {
  const explicit = process.env.OPENAPI_AUTH?.trim().toLowerCase();
  if (explicit === 'django' || explicit === 'django-session') {
    return 'django-session';
  }
  if (explicit === 'bearer') {
    return 'bearer';
  }
  if (explicit === 'cookie') {
    return 'cookie';
  }
  if (explicit === 'anonymous' || explicit === 'none') {
    return 'anonymous';
  }
  if (explicit && explicit !== 'auto') {
    throw new Error(
      `Неизвестный OPENAPI_AUTH=${explicit}. Допустимо: auto, django-session, bearer, cookie, anonymous`,
    );
  }
  if (process.env.OPENAPI_BEARER_TOKEN?.trim() || process.env.AUTH_ACCESS_TOKEN?.trim()) {
    return 'bearer';
  }
  if (process.env.OPENAPI_COOKIE?.trim()) {
    return 'cookie';
  }
  if (process.env.ACCOUNT_LOGIN?.trim() && process.env.ACCOUNT_PASSWORD) {
    return 'django-session';
  }
  return 'anonymous';
}

function resolveBearerToken(): string {
  const t = process.env.OPENAPI_BEARER_TOKEN ?? process.env.AUTH_ACCESS_TOKEN;
  return t?.trim() ?? '';
}

class BearerOpenApiHttpClient implements OpenApiHttpClient {
  private readonly jar = new Map<string, string>();

  constructor(
    private readonly baseURL: string,
    private readonly token: string,
  ) {}

  async get(path: string, options?: { timeout?: number }): Promise<HttpGetResult> {
    const controller = new AbortController();
    const timer = options?.timeout
      ? setTimeout(() => controller.abort(), options.timeout)
      : undefined;
    try {
      const headers = new Headers();
      applyDefaultOpenApiHeaders(headers);
      headers.set('Authorization', `Bearer ${this.token}`);
      const c = buildCookieHeader(this.jar);
      if (c) {
        headers.set('Cookie', c);
      }
      const urlPath = path.startsWith('/') ? path : `/${path}`;
      const res = await fetch(`${this.baseURL}${urlPath}`, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      applySetCookies(res, this.jar);
      const body = await res.text();
      return {
        ok: () => res.ok,
        status: () => res.status,
        text: async () => body,
      };
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  async dispose(): Promise<void> {
    this.jar.clear();
  }

  cookieNames(): string[] {
    return [...this.jar.keys()];
  }
}

export async function createOpenApiHttpClientFromEnv(): Promise<OpenApiHttpClient> {
  const baseURL = normalizeBaseUrl(requireEnv('BASE_URL'));
  const kind = resolvedOpenApiAuthKind();

  if (kind === 'bearer') {
    const token = resolveBearerToken();
    if (!token) {
      throw new Error(
        'Режим bearer: задайте OPENAPI_BEARER_TOKEN или AUTH_ACCESS_TOKEN',
      );
    }
    return new BearerOpenApiHttpClient(baseURL, token);
  }

  if (kind === 'cookie') {
    const header = requireEnv('OPENAPI_COOKIE');
    const jar = new Map<string, string>();
    seedJarFromCookieHeader(jar, header);
    return createCookieJarOpenApiClient(baseURL, jar);
  }

  if (kind === 'django-session') {
    return createAuthenticatedApiContextFromEnv();
  }

  return createCookieJarOpenApiClient(baseURL, new Map());
}

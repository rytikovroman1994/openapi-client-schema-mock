import { requireEnv } from './required-env.js';

export type DjangoFormLoginOptions = {
  baseURL: string;
  login: string;
  password: string;
  remember?: boolean;
};

/** Ответ как у Playwright `APIResponse` (только используемые поля). */
export type HttpGetResult = {
  ok(): boolean;
  status(): number;
  text(): Promise<string>;
};

/** HTTP-клиент для запросов OpenAPI (cookie-jar, bearer и т.д. задаются снаружи). */
export type OpenApiHttpClient = {
  get(path: string, options?: { timeout?: number }): Promise<HttpGetResult>;
  dispose(): Promise<void>;
  /** Имена cookie в jar (диагностика). */
  cookieNames(): string[];
};

const CSRF_INPUT_REGEX = /name="csrfmiddlewaretoken"\s+value="([^"]+)"/;

const DEFAULT_HEADERS: Record<string, string> = {
  Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

export function applyDefaultOpenApiHeaders(headers: Headers): void {
  Object.entries(DEFAULT_HEADERS).forEach(([k, v]) => {
    if (!headers.has(k)) {
      headers.set(k, v);
    }
  });
}

export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/$/, '');
}

export function buildCookieHeader(jar: Map<string, string>): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

export function applySetCookies(response: Response, jar: Map<string, string>): void {
  const headers = response.headers as unknown as { getSetCookie?: () => string[] };
  const list = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : null;
  if (list?.length) {
    list.forEach((line) => {
      const [pair] = line.split(';');
      const idx = pair.indexOf('=');
      if (idx > 0) {
        jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
      }
    });
    return;
  }
  const combined = response.headers.get('set-cookie');
  if (!combined) {
    return;
  }
  const [pair] = combined.split(';');
  const idx = pair.indexOf('=');
  if (idx > 0) {
    jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
}

export function seedJarFromCookieHeader(jar: Map<string, string>, cookieHeaderValue: string): void {
  cookieHeaderValue.split(';').forEach((segment) => {
    const t = segment.trim();
    const eq = t.indexOf('=');
    if (eq > 0) {
      const name = t.slice(0, eq).trim();
      const value = t.slice(eq + 1).trim();
      jar.set(name, value);
    }
  });
}

export function extractCsrfTokenFromLoginHtml(html: string): string {
  const match = html.match(CSRF_INPUT_REGEX);
  if (!match?.[1]) {
    throw new Error('Не удалось извлечь csrfmiddlewaretoken из HTML страницы входа');
  }
  return match[1];
}

async function fetchWithCookies(
  baseURL: string,
  path: string,
  jar: Map<string, string>,
  init: RequestInit,
  timeoutMs?: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = timeoutMs
    ? setTimeout(() => controller.abort(), timeoutMs)
    : undefined;
  try {
    const headers = new Headers(init.headers);
    const c = buildCookieHeader(jar);
    if (c) {
      headers.set('Cookie', c);
    }
    applyDefaultOpenApiHeaders(headers);
    return await fetch(`${baseURL}${path.startsWith('/') ? path : `/${path}`}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

class FetchOpenApiClient implements OpenApiHttpClient {
  constructor(
    private readonly baseURL: string,
    private readonly jar: Map<string, string>,
  ) {}

  async get(path: string, options?: { timeout?: number }): Promise<HttpGetResult> {
    const res = await fetchWithCookies(this.baseURL, path, this.jar, { method: 'GET' }, options?.timeout);
    applySetCookies(res, this.jar);
    const body = await res.text();
    return {
      ok: () => res.ok,
      status: () => res.status,
      text: async () => body,
    };
  }

  async dispose(): Promise<void> {
    this.jar.clear();
  }

  cookieNames(): string[] {
    return [...this.jar.keys()];
  }
}

/** Клиент только с cookie-jar (без входа): публичная схема или заранее заданные cookie. */
export function createCookieJarOpenApiClient(
  rawBaseURL: string,
  jar: Map<string, string> = new Map(),
): OpenApiHttpClient {
  return new FetchOpenApiClient(normalizeBaseUrl(rawBaseURL), jar);
}

/**
 * Форма входа Django: GET /accounts/login/, POST /accounts/login/,
 * далее cookie-jar для запросов.
 */
export async function createAuthenticatedApiContext(
  options: DjangoFormLoginOptions,
): Promise<OpenApiHttpClient> {
  const {
    baseURL: rawBaseURL,
    login,
    password,
    remember = true,
  } = options;

  const baseURL = normalizeBaseUrl(rawBaseURL);
  const jar = new Map<string, string>();

  const loginGet = await fetchWithCookies(baseURL, '/accounts/login/', jar, { method: 'GET' });
  applySetCookies(loginGet, jar);
  const loginHtml = await loginGet.text();
  const csrfToken = extractCsrfTokenFromLoginHtml(loginHtml);

  const form = new URLSearchParams({
    csrfmiddlewaretoken: csrfToken,
    login,
    password,
  });
  if (remember) {
    form.append('remember', 'on');
  }

  const authResponse = await fetchWithCookies(
    baseURL,
    '/accounts/login/',
    jar,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: baseURL,
        Referer: `${baseURL}/accounts/login/`,
      },
      body: form.toString(),
      redirect: 'manual',
    },
  );
  applySetCookies(authResponse, jar);

  const { status } = authResponse;
  if (status !== 302 && status !== 303 && status !== 301) {
    const hint = status === 403
      ? ' (часто CSRF/WAF: проверьте Referer/Origin и cookie csrftoken)'
      : '';
    throw new Error(`Вход не удался: ожидался редирект (30x), получен статус ${status}${hint}`);
  }

  return new FetchOpenApiClient(baseURL, jar);
}

export async function createAuthenticatedApiContextFromEnv(): Promise<OpenApiHttpClient> {
  const baseURL = requireEnv('BASE_URL');
  const login = requireEnv('ACCOUNT_LOGIN');
  const password = requireEnv('ACCOUNT_PASSWORD');

  return createAuthenticatedApiContext({ baseURL, login, password });
}

# openapi-client-schema-mock

CLI toolkit for **downloading OpenAPI** documents with configurable authentication, **generating a TypeScript API client** ([swagger-typescript-api](https://github.com/acacode/swagger-typescript-api)), **AJV-oriented schemas**, and **response mocks**. Configuration is **environment-variable driven** (no interactive prompts).

The published binary is **`ocsm`**.

## Requirements

- **Node.js** 18+
- A consumer project where:
  - `swagger-typescript-api` is available (typically as a **devDependency**; `npx swagger-typescript-api` is used internally).
  - Optional: `swagger-typescript-api.config.cjs` in the project root (see below).

## Install

```bash
npm install --save-dev openapi-client-schema-mock swagger-typescript-api
```

Run the CLI via `npx`:

```bash
npx ocsm --help
npx ocsm codegen --help
```

## Commands

All commands use the **current working directory** as the project root (`process.cwd()`).

### `ocsm codegen client`

1. Downloads the OpenAPI document (with auth from env) into **`generated/openapi.json`**.
2. Verifies HTTP access and (for Django session mode) that `sessionid` exists when expected.
3. Runs **`swagger-typescript-api generate`** (modular client, Axios) into **`generated/`**.
4. **Post-processes** `generated/http-client.ts`: injects **`setHeader`** / **`removeHeader`** helpers on the Axios instance defaults (no custom EJS templates required in your repo).

If **`swagger-typescript-api.config.cjs`** exists in the project root, it is passed as **`--custom-config`**.

### `ocsm codegen schemas`

Downloads OpenAPI (same as above), then generates **`generated/schemas.ts`** for AJV-style validation bundles per operation.

### `ocsm codegen mocks <outDir>`

Generates response mocks under **`<outDir>`** using **`generated/openapi.json`** and **`generated/Api.ts`** (layout follows OpenAPI tags / your generator output).

Example:

```bash
npx ocsm codegen mocks ./src/test-data/dto
```

## Environment variables

### Always required for pull / codegen

| Variable | Description |
|----------|-------------|
| **`BASE_URL`** | Origin of the API (e.g. `https://api.example.com`). Used for schema download and client `baseURL`. |
| **`SWAGGER_SCHEMA_URL`** or **`SWAGGER_SCHEMA_PATH`** | Full URL to the OpenAPI JSON, **or** a path segment (e.g. `/api/schema/`) resolved against `BASE_URL`. |

### Auth mode: `OPENAPI_AUTH`

Controls how the OpenAPI schema is fetched. Default is **`auto`**: tries bearer → cookie → django-session → anonymous based on which credentials are set.

| Value | Behaviour |
|-------|-----------|
| `auto` | Infer from env (default). |
| `bearer` | `Authorization: Bearer …` |
| `cookie` | Raw `Cookie` header from **`OPENAPI_COOKIE`** |
| `django-session` | Login via **`ACCOUNT_LOGIN`** / **`ACCOUNT_PASSWORD`**, then reuse cookies (expects `sessionid`). |
| `anonymous` / `none` | No credentials. |

### Bearer

```bash
export OPENAPI_AUTH=bearer
export OPENAPI_BEARER_TOKEN="your-jwt"   # or AUTH_ACCESS_TOKEN
```

### Static cookie

```bash
export OPENAPI_AUTH=cookie
export OPENAPI_COOKIE="sessionid=abc123; other=value"
```

### Django-style session (login form)

```bash
export OPENAPI_AUTH=django-session
export ACCOUNT_LOGIN="user@example.com"
export ACCOUNT_PASSWORD="secret"
# Optional explicit mode still works:
# export OPENAPI_AUTH=auto
# (auto picks django-session when login + password are set)
```

### Anonymous schema (public spec)

```bash
export OPENAPI_AUTH=anonymous
```

## `package.json` examples

Minimal scripts in a test or app repo:

```json
{
  "scripts": {
    "generate:api": "ocsm codegen client",
    "generate:schemas": "ocsm codegen schemas",
    "generate:mocks": "ocsm codegen mocks ./src/test-data/dto"
  },
  "devDependencies": {
    "openapi-client-schema-mock": "^1.1.1",
    "swagger-typescript-api": "^13.6.0"
  }
}
```

Run from project root (where `.env` lives if you use `dotenv`):

```bash
npm run generate:api
```

### Using a `.env` file

The CLI loads **`dotenv/config`** on startup. Example **`.env`**:

```env
BASE_URL=https://api.example.com
SWAGGER_SCHEMA_URL=https://api.example.com/api/schema/
OPENAPI_AUTH=bearer
OPENAPI_BEARER_TOKEN=eyJhbGciOi...
```

Then:

```bash
npx ocsm codegen client
```

### Optional `swagger-typescript-api.config.cjs`

Place **`swagger-typescript-api.config.cjs`** next to **`package.json`**. It is forwarded to the generator **only if the file exists** (for hooks such as disabling formatters on huge specs).

Example:

```js
/** @type {import('swagger-typescript-api').GenerateApiParams} */
module.exports = {
  hooks: {
    onInit(config, codeGenProcess) {
      const { codeFormatter } = codeGenProcess;
      const originalFormatCode = codeFormatter.formatCode.bind(codeFormatter);
      codeFormatter.formatCode = async (code, options = {}) =>
        originalFormatCode(code, { ...options, format: false });
      return config;
    },
  },
};
```

## Generated layout (typical)

After **`codegen client`**:

```text
generated/
  openapi.json      # downloaded spec
  Api.ts            # modular API class
  data-contracts.ts
  http-client.ts    # Axios HttpClient + post-processed setHeader/removeHeader
  ...
```

## Development (this repository)

```bash
git clone https://github.com/rytikovroman1994/openapi-client-schema-mock.git
cd openapi-client-schema-mock
npm install
npm run build
```

Link into another project while iterating:

```bash
npm link
cd /path/to/your-app
npm link openapi-client-schema-mock
```

## HTTP client post-processing

The default **swagger-typescript-api** Axios template does not ship with **`setHeader` / `removeHeader`**. This package patches **`generated/http-client.ts`** after generation. If **`swagger-typescript-api`** changes the shape of `HttpClient`, update the anchor in **`src/lib/patch-http-client.ts`** (the error message points there).

## License

This package is released under the **MIT** license (see `LICENSE`).

### Direct dependency licenses (SPDX)

| Package | License |
|---------|---------|
| `commander` | MIT |
| `dotenv` | BSD-2-Clause |
| `ajv` | MIT |
| `@faker-js/faker` | MIT |
| `@openapi-contrib/openapi-schema-to-json-schema` | MIT |

Run `npx license-checker --production` before a compliance audit; transitive licenses are not listed here.

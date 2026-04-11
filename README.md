# openapi-client-schema-mock

CLI для выгрузки OpenAPI (в составе `codegen client` / `codegen schemas`), генерации клиента, схем AJV и моков. Доступ к схеме и авторизация проверяются при каждой выгрузке. Настройка только через переменные окружения.

## Установка

```bash
npm install openapi-client-schema-mock
```

Бинарник: **`ocsm`** (см. поле `bin` в `package.json`).

## Разработка

```bash
npm install
npm run build
```

## Лицензии зависимостей

Прямые зависимости и их SPDX-идентификаторы (актуально на момент сборки — перепроверяйте `npm ls` перед релизом):

| Пакет | Лицензия |
|--------|----------|
| `commander` | MIT |
| `dotenv` | BSD-2-Clause |
| `ajv` | MIT |
| `@faker-js/faker` | MIT |
| `@openapi-contrib/openapi-schema-to-json-schema` | MIT |

Транзитивные зависимости (например `lodash`, `yargs` у `@openapi-contrib/...`) обычно MIT / пермиссивные; для коммерческого релиза прогоните `npx license-checker --production` в каталоге пакета.

Публикуемый пакет распространяется под **MIT** (файл `LICENSE`); сочетается с перечисленными лицензиями при типичном использовании как библиотеки/CLI.

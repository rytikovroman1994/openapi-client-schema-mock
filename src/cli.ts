#!/usr/bin/env node
import 'dotenv/config';

import { Command } from 'commander';

import { codegenClientCommand, codegenSchemasCommand } from './commands/codegen.js';
import { codegenMocksCommand } from './commands/codegen-mocks.js';

const program = new Command();

program
  .name('ocsm')
  .description('OpenAPI, кодогенерация (настройка через переменные окружения)')
  .version('1.1.0');

const codegen = program.command('codegen').description('Генерация кода');

codegen
  .command('client')
  .description(
    'Скачать OpenAPI (с авторизацией из .env), проверить доступ, сгенерировать Api.ts',
  )
  .action(async () => {
    await codegenClientCommand(process.cwd());
  });

codegen
  .command('schemas')
  .description(
    'Скачать OpenAPI (с авторизацией из .env), проверить доступ, сгенерировать generated/schemas.ts для AJV',
  )
  .action(async () => {
    await codegenSchemasCommand(process.cwd());
  });

codegen
  .command('mocks')
  .argument('<outDir>', 'Каталог для моков (подкаталоги по @tags из Api.ts)')
  .description('Сгенерировать моки ответов { status, data } по OpenAPI и generated/Api.ts')
  .action(async (outDir: string) => {
    await codegenMocksCommand(process.cwd(), outDir);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});

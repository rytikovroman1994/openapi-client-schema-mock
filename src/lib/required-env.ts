/** Возвращает обязательную переменную окружения или бросает ошибку. */
export function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(`Задайте переменную окружения ${name}`);
  }
  return v;
}

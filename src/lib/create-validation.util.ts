import Ajv from 'ajv';

/**
 * Общий экземпляр AJV для `generated/schemas.ts` (AJV v6, как у зависимостей монорепо).
 */
export const ajvForSchemas = new Ajv({
  allErrors: true,
  validateSchema: false,
  unknownFormats: 'ignore',
});

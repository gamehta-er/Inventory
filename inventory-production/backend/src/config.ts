import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3020),
  DATABASE_URL: z.string().min(1),
  COOKIE_SECRET: z.string().min(32),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
  SESSION_HOURS: z.coerce.number().positive().max(24).default(8),
  ALLOWED_ORIGIN: z.string().default('http://127.0.0.1:3021'),
  UPLOAD_ROOT: z.string().default('./uploads'),
  MAX_IMAGE_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid application configuration: ${parsed.error.issues.map((issue) => issue.path.join('.') + ' ' + issue.message).join('; ')}`);
}

export const config = {
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === 'production',
  cookieSecure: parsed.data.COOKIE_SECURE === 'true',
};

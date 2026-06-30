import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const ConfigSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(10000),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SUPABASE_ANON_KEY: z.string().min(20),
  GEMINI_API_KEY: z.string().min(10),
  GEMINI_MODEL: z.string().default('gemini-2.0-flash-lite'),
  GEMINI_EMBEDDING_MODEL: z.string().default('text-embedding-004'),
  PANEL_ORIGIN: z.string().default('*'),
  ENABLE_BAILEYS: z.enum(['true', 'false']).default('true'),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env = process.env): AppConfig {
  return ConfigSchema.parse(env);
}

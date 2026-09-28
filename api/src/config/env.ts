import { z } from "zod";

/**
 * Environment schema for the API. Everything the service needs is declared here
 * so a missing or malformed variable fails at boot with a single readable error
 * instead of surfacing as `undefined` deep inside a request handler.
 */
const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().min(1).default("0.0.0.0"),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  STELLAR_NETWORK_PASSPHRASE: z.string().min(1),
  STELLAR_RPC_URL: z.string().url(),
  VESTFLOW_CONTRACT_ID: z
    .string()
    .min(1)
    .regex(/^C[0-9A-Z]{55}$/, "must be a Stellar contract id (C...)"),
  CORS_ORIGIN: z.string().default("*"),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  TRUST_PROXY: z
    .enum(["0", "1"])
    .default("0")
    .transform((value) => value === "1"),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
});

export type Env = z.infer<typeof envSchema>;

/** Immutable, fully validated configuration shared by the whole process. */
export interface Config {
  readonly env: Env;
  readonly isProduction: boolean;
  readonly corsOrigins: string[] | "*";
}

/**
 * Parse `source` (defaults to `process.env`) into a `Config`.
 *
 * @throws {z.ZodError} when a variable is missing or malformed.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.parse(source);
  return {
    env: parsed,
    isProduction: parsed.NODE_ENV === "production",
    corsOrigins:
      parsed.CORS_ORIGIN === "*"
        ? "*"
        : parsed.CORS_ORIGIN.split(",")
            .map((origin) => origin.trim())
            .filter((origin) => origin.length > 0),
  };
}

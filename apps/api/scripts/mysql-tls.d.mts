import type { ConnectionOptions } from 'node:tls';
export function databaseTlsOptions(env: Record<string, string | undefined>, projectRoot: string): ConnectionOptions | undefined;

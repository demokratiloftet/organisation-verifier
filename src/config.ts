import { readFile } from 'node:fs/promises';
import type { IssuerConfig, IssuanceScope } from './publisher.js';

export interface AutomationConfig {
  enabled: boolean;
  concurrency?: number;
  jetstream?: string;
  issuer?: IssuerConfig;
}
export async function automationConfig(env = process.env): Promise<AutomationConfig> {
  for (const key of ['AUTOMATION_ENABLED', 'PUBLIC_ISSUANCE_ENABLED', 'PRIVATE_ISSUANCE_ENABLED'])
    if (env[key] && !['true', 'false'].includes(env[key]!)) throw new Error(`${key} must be true or false.`);
  const config: AutomationConfig = {
    enabled: env.AUTOMATION_ENABLED === 'true',
    jetstream: env.JETSTREAM_URL || undefined,
  };
  if (env.WORKER_CONCURRENCY !== undefined) {
    if (!/^[1-8]$/.test(env.WORKER_CONCURRENCY))
      throw new Error('WORKER_CONCURRENCY must be an integer from 1 to 8.');
    config.concurrency = Number(env.WORKER_CONCURRENCY);
  }
  const scope = env.ISSUANCE_SCOPE ?? 'pilot';
  if (!['pilot', 'all_matching'].includes(scope))
    throw new Error('ISSUANCE_SCOPE must be pilot or all_matching.');
  const privateIssuance = env.PRIVATE_ISSUANCE_ENABLED === 'true';
  if (privateIssuance && env.PUBLIC_ISSUANCE_ENABLED === 'true')
    throw new Error('Private and public issuance cannot both be enabled.');
  if (privateIssuance && scope !== 'pilot') throw new Error('Private issuance requires pilot scope.');
  if (privateIssuance || env.PUBLIC_ISSUANCE_ENABLED === 'true') {
    if (!config.enabled) throw new Error('Issuance requires automation.');
    const required = ['ISSUER_PDS', 'ISSUER_DID', 'ISSUER_IDENTIFIER', 'ISSUER_PASSWORD_FILE'] as const;
    if (required.some((key) => !env[key])) throw new Error(`Issuance requires ${required.join(', ')}.`);
    const orgnrs = env.PILOT_ORGNRS?.trim() ? env.PILOT_ORGNRS.split(',').map((value) => value.trim()) : [];
    if (scope === 'pilot' && !orgnrs.length) throw new Error('Pilot issuance requires PILOT_ORGNRS.');
    if (orgnrs.some((id) => !/^\d{9}$/.test(id) || id.startsWith('000')))
      throw new Error('Invalid pilot list.');
    config.issuer = {
      private: privateIssuance,
      scope: scope as IssuanceScope,
      service: env.ISSUER_PDS!,
      did: env.ISSUER_DID!,
      identifier: env.ISSUER_IDENTIFIER!,
      password: (await readFile(env.ISSUER_PASSWORD_FILE!, 'utf8')).trim(),
      orgnrs,
    };
    if (!config.issuer.password) throw new Error('Issuer password file is empty.');
  }
  return config;
}

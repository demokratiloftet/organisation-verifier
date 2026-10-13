import { readFile } from 'node:fs/promises';
import type { IssuerConfig } from './publisher.js';

export interface AutomationConfig {
  enabled: boolean;
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
  const privateIssuance = env.PRIVATE_ISSUANCE_ENABLED === 'true';
  if (privateIssuance && env.PUBLIC_ISSUANCE_ENABLED === 'true')
    throw new Error('Private and public issuance cannot both be enabled.');
  if (privateIssuance || env.PUBLIC_ISSUANCE_ENABLED === 'true') {
    if (!config.enabled) throw new Error('Issuance requires automation.');
    const required = [
      'ISSUER_PDS',
      'ISSUER_DID',
      'ISSUER_IDENTIFIER',
      'ISSUER_PASSWORD_FILE',
      'PILOT_ORGNRS',
    ] as const;
    if (required.some((key) => !env[key])) throw new Error(`Issuance requires ${required.join(', ')}.`);
    const orgnrs = env.PILOT_ORGNRS!.split(',').map((value) => value.trim());
    if (!orgnrs.length || orgnrs.some((id) => !/^\d{9}$/.test(id) || id.startsWith('000')))
      throw new Error('Invalid pilot list.');
    config.issuer = {
      private: privateIssuance,
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

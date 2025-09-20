import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createKickConfig, configureApp, getAppConfig, resetAppConfig } from '../src';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('createKickConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    resetAppConfig();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    resetAppConfig();
  });

  it('builds config from defaults and env mappings', async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'kick-env-default-'));
    const envFile = path.join(temp, '.env');
    await fs.writeFile(envFile, 'KICK_PREFIX=/env\n');
    process.env.KICK_PREFIX = '/env';
    process.env.KICK_LOG_LEVEL = 'debug';
    process.env.KICK_DISCOVERY_ROOTS = JSON.stringify(['apps/api']);

    const config = createKickConfig({
      defaults: { prefix: '/api', telemetry: { trackReactiveHistory: false } },
      env: {
        KICK_PREFIX: 'prefix',
        KICK_LOG_LEVEL: { path: 'logging.level' },
        KICK_DISCOVERY_ROOTS: { path: 'api.discovery.roots', transform: (value) => JSON.parse(value) }
      },
      envFiles: [envFile]
    });

    configureApp(config);

    const resolved = getAppConfig();
    expect(resolved.prefix).toBe('/env');
    expect(resolved.logging.level).toBe('debug');
    expect(resolved.api.discovery.roots).toEqual(['apps/api']);
    expect(resolved.telemetry.trackReactiveHistory).toBe(false);
  });

  it('supports functional env bindings', () => {
    process.env.KICK_OPTS = JSON.stringify({ prefix: '/functional' });

    const config = createKickConfig({
      env: {
        KICK_OPTS: (value) => JSON.parse(value)
      }
    });

    expect(config.prefix).toBe('/functional');
  });
});

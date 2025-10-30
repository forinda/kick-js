import { Command } from 'commander';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createError } from '../../utils/errors';
import { loadKickConfig, mergeConfigWithOptions } from '../utils/config-loader';

interface RunOptions {
  port?: string;
  host?: string;
  watch?: boolean;
  entry?: string;
}

export function registerRunCommands(program: Command) {
  // kick dev command
  program
    .command('dev')
    .description('Start the application in development mode with hot reload')
    .option('-p, --port <port>', 'Port to run the server on')
    .option('-h, --host <host>', 'Host to bind the server to')
    .option('-e, --entry <entry>', 'Entry file path')
    .action(async (options: RunOptions) => {
      await runDev(options);
    });

  // kick start command
  program
    .command('start')
    .description('Start the application in production mode')
    .option('-p, --port <port>', 'Port to run the server on')
    .option('-h, --host <host>', 'Host to bind the server to')
    .option('-e, --entry <entry>', 'Entry file path')
    .action(async (options: RunOptions) => {
      await runStart(options);
    });
}

async function runDev(options: RunOptions) {
  // Load configuration
  const kickConfig = await loadKickConfig();
  const config = mergeConfigWithOptions(kickConfig, options, 'dev');
  
  const entryFile = config.entry!;
  const cwd = process.cwd();
  const entryPath = path.resolve(cwd, entryFile);

  if (!existsSync(entryPath)) {
    throw createError('ENTRY_FILE_NOT_FOUND', `Entry file not found: ${entryPath}`);
  }

  console.log(`🚀 Starting development server...`);
  if (kickConfig.configPath) {
    console.log(`⚙️  Config: ${path.relative(cwd, kickConfig.configPath)}`);
  }
  console.log(`📁 Entry: ${entryFile}`);
  console.log(`🌐 Port: ${config.port}`);
  console.log(`🏠 Host: ${config.host}`);

  // Try tsx first (preferred), then ts-node-dev, then ts-node
  const runners = [
    { cmd: 'tsx', args: ['watch', entryFile] },
    { cmd: 'ts-node-dev', args: ['--respawn', '--transpile-only', entryFile] },
    { cmd: 'ts-node', args: [entryFile] }
  ];

  let runner = null;
  for (const r of runners) {
    if (await commandExists(r.cmd)) {
      runner = r;
      break;
    }
  }

  if (!runner) {
    throw createError(
      'DEV_RUNNER_NOT_FOUND',
      'No development runner found. Please install one of: tsx, ts-node-dev, or ts-node\n' +
      'npm install --save-dev tsx\n' +
      '# or\n' +
      'npm install --save-dev ts-node-dev\n' +
      '# or\n' +
      'npm install --save-dev ts-node'
    );
  }

  const env = {
    ...process.env,
    ...config.env,
    PORT: config.port?.toString(),
    HOST: config.host
  };

  console.log(`🔧 Using runner: ${runner.cmd}`);
  
  // Check if we should use local binary
  const localBinPath = path.resolve(cwd, 'node_modules', '.bin', runner.cmd);
  const commandToRun = existsSync(localBinPath) ? localBinPath : runner.cmd;
  
  const child = spawn(commandToRun, runner.args, {
    stdio: 'inherit',
    env,
    cwd
  });

  child.on('error', (error) => {
    console.error(`❌ Failed to start development server: ${error.message}`);
    process.exit(1);
  });

  child.on('exit', (code) => {
    if (code !== 0) {
      console.error(`❌ Development server exited with code ${code}`);
      process.exit(code || 1);
    }
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down development server...');
    child.kill('SIGINT');
  });

  process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down development server...');
    child.kill('SIGTERM');
  });
}

async function runStart(options: RunOptions) {
  // Load configuration
  const kickConfig = await loadKickConfig();
  const config = mergeConfigWithOptions(kickConfig, options, 'start');
  
  const entryFile = config.entry!;
  const cwd = process.cwd();
  const entryPath = path.resolve(cwd, entryFile);

  if (!existsSync(entryPath)) {
    throw createError(
      'ENTRY_FILE_NOT_FOUND', 
      `Entry file not found: ${entryPath}\n` +
      'Make sure to build your application first with: npm run build'
    );
  }

  console.log(`🚀 Starting production server...`);
  if (kickConfig.configPath) {
    console.log(`⚙️  Config: ${path.relative(cwd, kickConfig.configPath)}`);
  }
  console.log(`📁 Entry: ${entryFile}`);
  console.log(`🌐 Port: ${config.port}`);
  console.log(`🏠 Host: ${config.host}`);

  const env = {
    ...process.env,
    ...config.env,
    PORT: config.port?.toString(),
    HOST: config.host
  };

  const child = spawn('node', [entryFile], {
    stdio: 'inherit',
    env,
    cwd
  });

  child.on('error', (error) => {
    console.error(`❌ Failed to start production server: ${error.message}`);
    process.exit(1);
  });

  child.on('exit', (code) => {
    if (code !== 0) {
      console.error(`❌ Production server exited with code ${code}`);
      process.exit(code || 1);
    }
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down production server...');
    child.kill('SIGINT');
  });

  process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down production server...');
    child.kill('SIGTERM');
  });
}

async function commandExists(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    // First try local node_modules/.bin
    const localBinPath = path.resolve(process.cwd(), 'node_modules', '.bin', command);
    if (existsSync(localBinPath)) {
      resolve(true);
      return;
    }
    
    // Then try global installation
    const child = spawn('which', [command], { stdio: 'ignore' });
    child.on('close', (code) => {
      resolve(code === 0);
    });
    child.on('error', () => {
      resolve(false);
    });
  });
}
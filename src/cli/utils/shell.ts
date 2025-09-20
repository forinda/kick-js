import { spawn } from 'node:child_process';

export function runShellCommand(command: string, options: { cwd?: string } = {}) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, {
      cwd: options.cwd,
      stdio: 'inherit',
      shell: true
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with exit code ${code}: ${command}`));
      }
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

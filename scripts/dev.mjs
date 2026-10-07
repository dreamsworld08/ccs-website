// `npm run dev` starts the local backend (dev-server) and the Astro dev server together.
import { spawn } from 'node:child_process';

const run = (name, cmd, args) => {
  const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  child.on('exit', (code) => {
    if (code) console.error(`[${name}] exited with code ${code}`);
    process.exit(code ?? 0);
  });
  return child;
};
const api = run('api', 'node', ['dev-server/server.mjs']);
const site = run('site', 'npx', ['astro', 'dev', '--host', '127.0.0.1']);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    api.kill();
    site.kill();
    process.exit(0);
  });
}

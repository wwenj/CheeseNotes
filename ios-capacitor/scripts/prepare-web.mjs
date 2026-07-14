import { cp, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, '..');
const repositoryRoot = resolve(appRoot, '..');
const webRoot = resolve(repositoryRoot, 'web');
const sourceDir = resolve(repositoryRoot, 'server/public');
const outputDir = resolve(appRoot, 'www');
const defaultEndpoint = 'http://127.0.0.1:3000';
const endpoint = normalizeEndpoint(process.env.NOTEAI_SERVICE_URL ?? defaultEndpoint);

function normalizeEndpoint(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('NOTEAI_SERVICE_URL 必须使用 http 或 https。');
  return url.href.replace(/\/$/, '');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: appRoot, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function main() {
  run('pnpm', ['--dir', webRoot, 'build']);

  const stagingDir = await mkdtemp(resolve(tmpdir(), 'noteai-capacitor-www-'));
  try {
    await cp(sourceDir, stagingDir, { recursive: true });
    const indexPath = resolve(stagingDir, 'index.html');
    const html = await readFile(indexPath, 'utf8');
    const bootstrap = `<script data-noteai-capacitor-bootstrap>localStorage.setItem('note-service-url', ${JSON.stringify(endpoint)});</script>`;
    if (!/<head>/i.test(html)) throw new Error('Web build output does not contain a <head> element.');
    await writeFile(indexPath, html.replace(/<head>/i, `<head>${bootstrap}`));

    await rm(outputDir, { recursive: true, force: true });
    await rename(stagingDir, outputDir);
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

await main();

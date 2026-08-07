// 打包纯开源源码 zip（不含 node_modules / dist / 构建产物）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'release-v4.6.8', 'JaceCanvas-4.6.8-opensource.zip');
const SKIP = new Set(['node_modules', 'dist', '.git', '.vite', 'opensource-resource', 'release-v4.6.8', 'release-pure-install', 'dist-installer', '.reasonix', 'node_modules.cache', 'data', 'server/data', 'runtime-verify-endpoint-v4.5.1', 'runtime-verify-sw-v4.5.1', 'runtime-verify-v4.5.1']);

const files = [];
function collect(dir, rel = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    if (!entry.isDirectory() && (entry.name.endsWith('.log') || entry.name.endsWith('.pid') || entry.name.endsWith('.exit') || entry.name === 'install-log.txt' || entry.name === 'web-workflows-import.json' || entry.name === 'prompt-settings.json')) continue;
    const full = path.join(dir, entry.name);
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) collect(full, r);
    else files.push([full, r]);
  }
}
collect(root);
// 用 powershell Compress-Archive（系统自带，无需额外依赖）
const staging = path.join(root, 'opensource-staging');
fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });
for (const [src, rel] of files) {
  const dest = path.join(staging, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}
fs.rmSync(out, { force: true });
execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${staging}\\*' -DestinationPath '${out}' -Force"`, { stdio: 'inherit' });
fs.rmSync(staging, { recursive: true, force: true });
console.log(`[opensource-zip] 完成：${out}（${files.length} 个文件）`);

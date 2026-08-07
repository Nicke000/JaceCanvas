// electron-builder beforePack 钩子：生成 opensource-resource（方案 B —— 安装包内置完整开源版本，安装版用户可 AI 改码）
// package.json: "build": { "beforePack": "scripts/prepare-opensource.cjs", ... }
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dst = path.join(root, 'opensource-resource');
const SKIP = new Set(['node_modules', 'dist', '.git', '.vite', 'opensource-resource', 'release-v4.6.8', 'dist-installer', 'node_modules.cache', '.reasonix']);

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (entry.isSymbolicLink()) {
        // junction：解析真实目标复制（打包资源需要真实依赖）
        try { const real = fs.realpathSync(s); copyDir(real, d); } catch { try { fs.symlinkSync(s, d, 'junction'); } catch {} }
      } else copyDir(s, d);
    } else fs.copyFileSync(s, d);
  }
}

module.exports = async function prepareOpensource() {
  const started = Date.now();
  console.log('[prepare-opensource] 生成 opensource-resource（含 node_modules，可能耗时 1-3 分钟）…');
  fs.rmSync(dst, { recursive: true, force: true });
  copyDir(root, dst);
  if (fs.existsSync(path.join(root, 'node_modules'))) copyDir(path.join(root, 'node_modules'), path.join(dst, 'node_modules'));
  for (const f of ['package-lock.json']) { try { fs.rmSync(path.join(dst, f), { force: true }); } catch {} }
  console.log(`[prepare-opensource] 完成：${dst}（${Math.round((Date.now() - started) / 1000)}s）`);
};

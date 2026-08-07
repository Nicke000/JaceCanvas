#!/usr/bin/env node
/**
 * lint-tokens.mjs —— JaceCanvas 设计系统校验（P2 工程保障）
 * 用法：node scripts/lint-tokens.mjs [--strict]
 * 默认 warn（报告）；--strict 时任一类别有命中即退出码 1。
 *
 * 检测项：
 *  1) TSX/TS 内联 #hex / rgba( 硬编码（白名单：主题色板 / 节点个性色板 / CSS :root）
 *  2) 渲染路径 emoji 图标（排除配置数据文件：nodeMeta、apiNodes、nodeRegistry json）
 *  3) var(--xxx) 引用了未在令牌表定义的变量
 *  4) AI 默认单一字体（Inter 无 CJK 回退 / Geist）
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SRC = join(ROOT, 'src');
const strict = process.argv.includes('--strict');

/* ---------- 白名单 ---------- */
// 配置/数据文件（icon 字段为历史数据，不参与渲染）
const DATA_FILES = [/nodeMeta\d*\.ts$/, /apiNodes\.ts$/, /nodeRegistry_p\d*\.json$/, /domainTemplates\.ts$/, /stylePresets\.ts$/];
// 主题定义与工具（颜色来源，允许 hex）
const THEME_FILES = [/themeStore\.ts$/, /nodeIcons\.tsx$/];
// 允许内联 hex 的语义位置：CSS 文件（:root 定义 + 组件 CSS 变量）、主题相关
const allowedFiles = (f) => f.endsWith('.css') || THEME_FILES.some(r => r.test(f));
// 节点个性色板（分类信息，允许在 nodes/index.tsx 等保留 —— P2 收敛目标之一，先报后白）
const NODE_PALETTE = new Set([
  '#7c6df2', '#06b6d4', '#22d3ee', '#34d399', '#fb923c', '#f472b6', '#94a3b8', '#a78bfa', '#0ea5e9',
  '#38bdf8', '#fb7185', '#ec4899', '#a855f7', '#8b5cf6', '#f59e0b', '#14b8a6', '#6366f1', '#f97316',
  '#d4a72c', '#ff7a45', '#60a5fa', '#22c55e', '#fbbf24', '#ef4444', '#3b82f6', '#10b981', '#eab308',
  '#f43f5e', '#e879f9', '#2dd4bf', '#facc15', '#4ade80', '#c084fc', '#f0abfc', '#fda4af',
]);
// 状态/端口类型色（信息色，保留低饱和固定值）
const STATE_COLORS = new Set(['#444', '#22c55e', '#f59e0b', '#ef4444', '#a78bfa', '#f472b6', '#fbbf24', '#34d399', '#38bdf8', '#67e8f9', '#86efac', '#c4b5fd', '#fbbf24', '#86efac', '#888']);
const EMOJI_RANGE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2B00}-\u{2BFF}]/u;
// 功能性状态符号（非"AI 味"装饰图标，允许）：⚠ 警告、✓/✕/★/☆ 状态与收藏、○●◐▤ 等几何符号
const EMOJI_ALLOW = /[\u{26A0}\u{2713}\u{2715}\u{2605}\u{2606}\u{25CB}\u{25CF}\u{25D0}\u{25E4}]/u;
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
const RGBA_RE = /rgba?\([^)]*\)/g;
const VAR_RE = /var\((--[a-zA-Z0-9-]+)/g;

/* ---------- 令牌表（从 index.css :root + themeStore 派生令牌收集） ---------- */
const TOKEN_PREFIXES = [
  '--theme-', '--bg-', '--surface-', '--panel-', '--input-', '--border', '--text-', '--accent', '--edge-',
  '--success', '--warning', '--error', '--shadow-', '--ui-', '--radius', '--transition', '--neon-',
  '--workspace-', '--glass-', '--theme-grid', '--history-', '--brand-',
];
function isKnownToken(name) {
  return TOKEN_PREFIXES.some(p => name.startsWith(p));
}

/* ---------- 收集 ---------- */
const hexHits = [];      // { file, line, raw }
const emojiHits = [];
const varHits = [];
let fontIssues = 0;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === 'director-desk') continue;
      walk(full);
    } else if (/\.(tsx?|jsx?)$/.test(name)) {
      scanFile(full);
    }
  }
}
function scanFile(file) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  if (DATA_FILES.some(r => r.test(rel))) return; // 数据文件跳过 emoji/hex（icon 为历史数据）
  const src = readFileSync(file, 'utf-8');
  const lines = src.split('\n');
  const isAllowed = allowedFiles(rel);
  lines.forEach((line, i) => {
    // 1) hex / rgba
    if (!isAllowed) {
      for (const m of line.matchAll(HEX_RE)) {
        const val = m[0].toLowerCase();
        if (NODE_PALETTE.has(val) || STATE_COLORS.has(val)) continue;
        hexHits.push({ file: rel, line: i + 1, raw: m[0] });
      }
      for (const m of line.matchAll(RGBA_RE)) {
        // rgba(0,0,0,0.3) 阴影/透明层允许（通用中性），彩色 rgba 报
        const inner = m[0].replace(/^rgba?\(/, '').replace(/\)$/, '');
        const [r, g, b] = inner.split(',').map(x => parseInt(x.trim(), 10));
        if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) continue;
        if (r === g && g === b) continue; // 中性灰 rgba 允许
        hexHits.push({ file: rel, line: i + 1, raw: m[0] });
      }
    }
    // 2) emoji（渲染路径）
    if (!/^\s*(\/\/|\*)/.test(line) && EMOJI_RANGE.test(line) && !EMOJI_ALLOW.test(line) && !/[\u4E00-\u9FFF]/.test(line.replace(EMOJI_RANGE, ''))) {
      emojiHits.push({ file: rel, line: i + 1, raw: line.trim().slice(0, 60) });
    }
    // 3) var() 未定义令牌
    for (const m of line.matchAll(VAR_RE)) {
      if (!isKnownToken(m[1])) varHits.push({ file: rel, line: i + 1, raw: m[1] });
    }
    // 4) AI 默认字体：font-family 单一 Inter（无 CJK 回退）
    if (/font-family:\s*['"]?Inter['"]?[,;]/.test(line) && !/PingFang|YaHei|Noto|system-ui/.test(line)) {
      fontIssues++;
      console.log(`  ⚠ 字体: ${rel}:${i + 1} — 单一 Inter 无 CJK 回退`);
    }
  });
}

walk(SRC);

/* ---------- 输出 ---------- */
let failed = false;
function report(title, hits, cap) {
  if (!hits.length) { console.log(`  ✓ ${title}: 0`); return; }
  console.log(`  ✗ ${title}: ${hits.length}（显示前 ${cap}）`);
  hits.slice(0, cap).forEach(h => console.log(`    ${h.file}:${h.line} — ${h.raw}`));
  failed = true;
}
console.log('JaceCanvas 设计令牌校验' + (strict ? '（--strict）' : '（报告模式）'));
report('内联 #hex/rgba 硬编码', hexHits, 20);
report('渲染路径 emoji', emojiHits, 10);
report('未定义 CSS 变量', varHits, 10);

if (strict && (failed || fontIssues)) {
  console.log('\n✗ lint-tokens 未通过');
  process.exit(1);
}
console.log(fontIssues ? `\n（另有 ${fontIssues} 处字体问题，非 strict 不计失败）` : '');
console.log(strict ? '\n✓ lint-tokens 通过' : '\n（报告模式结束，--strict 才 fail）');

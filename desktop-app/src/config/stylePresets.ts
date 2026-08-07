export interface StylePreset { id: string; name: string; desc: string; suffix: string; }
export const STYLE_PRESETS: StylePreset[] = [
  { id: 'none', name: '无（默认）', desc: '不附加风格', suffix: '' },
  { id: 'cinematic', name: '电影感', desc: '电影级光影构图', suffix: 'cinematic lighting, film grain, shallow depth of field, professional color grading, epic composition' },
  { id: 'cyberpunk', name: '赛博朋克', desc: '霓虹都市夜景', suffix: 'cyberpunk style, neon lights, rainy night city, high contrast, blade runner aesthetic' },
  { id: 'guofeng', name: '国风水墨', desc: '东方水墨意境', suffix: 'chinese ink wash painting style, traditional guofeng, elegant, minimalist, artistic' },
  { id: 'japanese', name: '日系清新', desc: '清新治愈胶片感', suffix: 'japanese clean style, soft light, pastel tones, film photography, airy' },
  { id: '3d', name: '3D 渲染', desc: '皮克斯风格 3D', suffix: '3d render, pixar style, soft global illumination, cute, high quality' },
  { id: 'realistic', name: '超写实', desc: '照片级真实感', suffix: 'ultra realistic, 8k, detailed textures, natural light, photorealistic' },
  { id: 'anime', name: '动漫', desc: '日系动漫风', suffix: 'anime style, cel shading, vibrant colors, detailed lineart' },
];

const CUSTOM_KEY = 'ai-canvas-custom-styles';
export interface CustomStyle { id: string; name: string; suffix: string; }
export function getCustomStyles(): CustomStyle[] { try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]'); } catch { return []; } }
export function saveCustomStyle(name: string, suffix: string): string { const list = getCustomStyles(); const id = 'custom-' + Date.now(); list.push({ id, name, suffix }); localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); return id; }
export function deleteCustomStyle(id: string): void { localStorage.setItem(CUSTOM_KEY, JSON.stringify(getCustomStyles().filter(x => x.id !== id))); }
export function getAllStyles(): StylePreset[] { return [...STYLE_PRESETS, ...getCustomStyles().map(x => ({ id: x.id, name: x.name, desc: '自定义风格', suffix: x.suffix }))]; }

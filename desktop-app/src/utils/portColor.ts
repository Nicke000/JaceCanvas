/** 端口数据类型 → 颜色（连线/连接点统一配色，自动区分数据流，无需手动自定义）。
 *  与节点端口 handle 的颜色保持一致：图片=天蓝、文本=紫、视频=粉、音频=橙、3D=绿。 */
export function portTypeColor(type?: string): string {
  switch (String(type || '').toLowerCase()) {
    case 'text': return '#a78bfa';
    case 'number': return '#60a5fa';
    case 'boolean': return '#94a3b8';
    case 'video': return '#f472b6';
    case 'audio': return '#f59e0b';
    case '3d': return '#34d399';
    case 'image': return '#38bdf8';
    default: return '#38bdf8'; // 默认/通用/图片
  }
}

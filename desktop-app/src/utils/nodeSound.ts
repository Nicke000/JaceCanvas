/** 节点执行完成提示音：每次任务成功或失败时播放本地音频。
 *  开源适配：不再硬编码用户机器路径。内置声音随应用分发（public/success.mp3，
 *  打包后位于 dist/ 下，与 index.html 同根，可直接相对引用）。
 *  用户可在设置中自定义提示音文件（写入 localStorage 'jacecanvas-sound-file'，
 *  支持本地绝对路径 / URL / data: 音频）。
 *  全局单例，避免并发创建多个 Audio 实例。 */
let audio: HTMLAudioElement | null = null;
let cachedSource: string | null = null;

function resolveSoundSource(): string | null {
  try {
    const custom = localStorage.getItem('jacecanvas-sound-file');
    if (custom && custom.trim()) return custom.trim();
  } catch { /* 忽略 */ }
  return './success.mp3';
}

export function playNodeDoneSound(): void {
  try {
    const source = resolveSoundSource();
    if (!source) return;
    if (cachedSource !== source) { audio = null; cachedSource = source; }
    try {
      if (!audio) {
        audio = new Audio(source);
        audio.preload = 'auto';
      }
      audio.currentTime = 0;
      void audio.play().catch(() => undefined);
    } catch {
      // 某些受限环境下 new Audio(file://) 可能失败；降级用报错不抛。
    }
  } catch {
    /* 服务端/无 DOM 环境忽略 */
  }
}
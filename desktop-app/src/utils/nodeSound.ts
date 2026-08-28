/** 节点执行完成提示音：每次任务成功或失败时播放本地音频。
 *  路径为绝对本地文件（Electron 以 file:// 加载，可直接引用）。
 *  全局单例，避免并发创建多个 Audio 实例。 */
let audio: HTMLAudioElement | null = null;
const SOUND_FILE = 'E:/AIhuabu/调研文档/成功.mp3';

export function playNodeDoneSound(): void {
  try {
    try {
      if (!audio) {
        audio = new Audio(SOUND_FILE);
        audio.preload = 'auto';
      }
      audio.currentTime = 0;
      void audio.play().catch(() => undefined);
    } catch {
      // 某些受限环境下 new Audio file:// 可能失败；降级用报错不抛。
    }
  } catch {
    /* 服务端/无 DOM 环境忽略 */
  }
}

import { useEffect } from 'react';
import { CloseOutlined } from '@ant-design/icons';
import { Button, message } from 'antd';
import { DirectorDeskShell } from '@/director-desk/app/layout/DirectorDeskShell';
import { DirectorCanvas } from '@/director-desk/editor/canvas/DirectorCanvas';
import { clearDirectorDeskHostBridge, initDirectorDeskHostBridge } from '@/director-desk/editor/io/hostBridge';
import { useCanvasStore } from '@/stores/canvasStore';
import '@/director-desk/styles/index.css';

interface DirectorCaptureMessage {
  type?: string;
  payload?: { captures?: Array<{ dataUrl?: unknown; fileName?: unknown }> };
}

/**
 * StoryAI 3D 导演台的 JaceCanvas 宿主适配层。
 * 参考项目负责完整的 3D 编辑器；这里负责 Electron 页面生命周期和画布互通。
 */
export function StoryAIDirectorDesk({ onClose }: { onClose: () => void }) {
  const addNode = useCanvasStore((state) => state.addNode);

  useEffect(() => {
    initDirectorDeskHostBridge();

    const handleCapture = (event: MessageEvent<DirectorCaptureMessage>) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'storyai:director-desk-captures-sent') return;
      const capture = event.data.payload?.captures?.find((item) => typeof item.dataUrl === 'string');
      if (!capture || typeof capture.dataUrl !== 'string') return;

      addNode('directorStudio', { x: 320, y: 160 }, {
        label: 'StoryAI 3D导演台 · 当前镜头',
        config: { snapshot: capture.dataUrl, prompt: '', actors: [], shot: { shotSize: '自定义', duration: 0 } },
      });
      message.success('导演台截图已同步到画布');
    };

    window.addEventListener('message', handleCapture);
    return () => {
      window.removeEventListener('message', handleCapture);
      clearDirectorDeskHostBridge();
    };
  }, [addNode]);

  return (
    <div className="storyai-director-host" role="dialog" aria-label="StoryAI 3D导演台">
      <div className="storyai-director-host__bar">
        <strong>StoryAI 3D导演台</strong>
        <span>完整导演台 · 对象树 · 角色姿势 · 机位构图 · 模型/全景导入 · 开源工具/模型提示</span>
        <Button type="text" icon={<CloseOutlined />} onClick={onClose} aria-label="关闭导演台" />
      </div>
      <div className="storyai-director-host__body">
        <div style={{position:'absolute',zIndex:5,left:12,bottom:12,maxWidth:520,padding:'7px 10px',border:'1px solid #6b4f1d',borderRadius:6,background:'rgba(20,16,8,.92)',color:'#f6c66b',fontSize:10,lineHeight:1.5,pointerEvents:'none'}}>
          开源本地工具/模型提示：Video2X 及相关模型可能不适配所有电脑。请自行确认软件、模型和素材许可证；本应用不授予商业授权，禁止侵权或造成来源误会。
        </div>
        <DirectorDeskShell>
          <DirectorCanvas />
        </DirectorDeskShell>
      </div>
    </div>
  );
}
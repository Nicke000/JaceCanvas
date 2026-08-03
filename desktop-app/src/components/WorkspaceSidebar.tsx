import React, { useEffect, useState } from 'react';
import { AppstoreOutlined, CloseOutlined, FolderOpenOutlined, PictureOutlined, RocketOutlined } from '@ant-design/icons';
import { Button, Segmented } from 'antd';
import { AssetLibrary } from '@/components/AssetLibrary';
import { Toolbar } from '@/components/Toolbar';
import { useCanvasStore } from '@/stores/canvasStore';
import type { NodeComponentType } from '@/types';
import type { PaidCapability } from '@/services/paidApi.service';
import { PAID_CAPABILITIES } from '@/services/paidApi.service';
import { PAID_API_ADAPTERS, PAID_PROVIDER_IDS, getPaidProvidersForCapability } from '@/config/paidApiAdapters';

type MainTab = 'assets' | 'nodes';
type NodeTab = 'fixed' | 'paid' | 'workflow';

const FIXED_NODES: Array<{ type: NodeComponentType; label: string; icon: string }> = [
  { type:'textInput', label:'文本', icon:'T' }, { type:'scriptInput', label:'剧本', icon:'▤' },
  { type:'uploadNode', label:'上传', icon:'↥' }, { type:'sceneSettings', label:'场景设定', icon:'⚙' },
  { type:'imageCrop', label:'修图裁切', icon:'✂' }, { type:'videoTrim', label:'视频剪辑', icon:'✂' },
  { type:'video2xLocal', label:'视频超分/补帧', icon:'⚙' }, { type:'preview', label:'结果预览', icon:'◉' },
  { type:'compare', label:'前后对比', icon:'◐' }, { type:'storyboardPrompt', label:'剧情分镜', icon:'▤' },
  { type:'cinematographyKnowledge', label:'影视知识库', icon:'✦' },
];
const PAID_IMAGE_NODES: Array<{ type: NodeComponentType; label: string; icon: string; config?: Record<string, unknown> }> = [
  ...(['text-to-image', 'image-to-image', 'image-upscale', 'remove-background', 'outpaint', 'background-generation', 'style-transfer'] as PaidCapability[]).map(capability => ({
    type: 'paidCapability' as NodeComponentType,
    label: PAID_CAPABILITIES[capability].label,
    icon: capability === 'remove-background' ? '✂️' : capability === 'image-upscale' ? '🔍' : '✨',
    config: { capability, provider: getPaidProvidersForCapability(capability)[0]?.id || '' },
  })).filter(item => getPaidProvidersForCapability(item.config?.capability as PaidCapability).length > 0),
];
const PAID_VIDEO_NODES: Array<{ type: NodeComponentType; label: string; icon: string; config?: Record<string, unknown> }> = [
  ...(['text-to-video', 'image-to-video', 'first-last-to-video', 'reference-to-video', 'motion-video', 'video-edit', 'dance-video', 'lipsync'] as PaidCapability[]).map(capability => ({
    type: 'paidCapability' as NodeComponentType,
    label: PAID_CAPABILITIES[capability].label,
    icon: capability === 'video-edit' ? '✂️' : capability === 'motion-video' ? '🏃' : capability === 'lipsync' ? '🗣️' : '🎞️',
    config: { capability, provider: getPaidProvidersForCapability(capability)[0]?.id || '' },
  })).filter(item => getPaidProvidersForCapability(item.config?.capability as PaidCapability).length > 0),
];
const PAID_MANAGE_NODES: Array<{ type: NodeComponentType; label: string; icon: string; config?: Record<string, unknown> }> = [
  ...(['element-manage', 'voice-manage'] as PaidCapability[]).map(capability => ({
    type: 'paidCapability' as NodeComponentType,
    label: PAID_CAPABILITIES[capability].label,
    icon: capability === 'element-manage' ? '👤' : '🎙️',
    config: { capability, provider: getPaidProvidersForCapability(capability)[0]?.id || '' },
  })).filter(item => getPaidProvidersForCapability(item.config?.capability as PaidCapability).length > 0),
];
const PAID_CHAT_NODE = { type:'chatNode' as NodeComponentType, label:'AI聊天', icon:'💬' };

export const WorkspaceSidebar: React.FC = () => {
  const [open, setOpen] = useState(() => localStorage.getItem('jacecanvas-workspace-open') === 'true');
  const [mainTab, setMainTab] = useState<MainTab>('assets');
  const [nodeTab, setNodeTab] = useState<NodeTab>('fixed');
  const addNode = useCanvasStore(s => s.addNode);
  const center = () => ((window as any).__canvasCenter?.() || { x: 320, y: 200 });
  useEffect(() => {
    const openLibrary = () => { setOpen(true); localStorage.setItem('jacecanvas-workspace-open', 'true'); setMainTab('nodes'); setNodeTab('workflow'); };
    window.addEventListener('ai-canvas-open-node-library', openLibrary);
    return () => window.removeEventListener('ai-canvas-open-node-library', openLibrary);
  }, []);
  const toggleOpen = (value: boolean) => { setOpen(value); localStorage.setItem('jacecanvas-workspace-open', String(value)); };
  if (!open) return <Button className="workspace-sidebar-toggle" icon={<FolderOpenOutlined />} onClick={() => toggleOpen(true)}>资产 / 节点</Button>;
  const add = (type: NodeComponentType) => addNode(type, center(), { label: undefined } as any);
  const grid = (nodes: Array<{ type: NodeComponentType; label: string; icon: string; config?: Record<string, unknown> }>) => <div className="workspace-node-grid">{nodes.map(item => <button key={`${item.type}-${item.label}`} onClick={() => addNode(item.type, center(), item.config ? { config: item.config, label: item.label } as any : { label: item.label } as any)}><i>{item.icon}</i><span>{item.label}</span></button>)}</div>;
  return <aside className="workspace-sidebar">
    <header><div className="workspace-sidebar__brand"><AppstoreOutlined /> 创作工作区</div><Button type="text" icon={<CloseOutlined />} onClick={() => toggleOpen(false)} /></header>
    <Segmented block value={mainTab} onChange={value => setMainTab(value as MainTab)} options={[{ label:<span><PictureOutlined /> 资产</span>, value:'assets' }, { label:<span><RocketOutlined /> 节点</span>, value:'nodes' }]} />
    <section className="workspace-sidebar__body">
      {mainTab === 'assets' && <AssetLibrary embedded collapsed={false} onToggle={() => toggleOpen(false)} />}
      {mainTab === 'nodes' && <>
        <Segmented className="workspace-sidebar__node-tabs" block value={nodeTab} onChange={value => setNodeTab(value as NodeTab)} options={[{label:'固定节点',value:'fixed'},{label:'付费 API',value:'paid'},{label:'工作流节点',value:'workflow'}]} />
        {nodeTab === 'fixed' && grid(FIXED_NODES)}
        {nodeTab === 'paid' && <div className="workspace-paid-node-groups">
          <div className="workspace-sidebar__hint">只显示已配置或可由厂商能力目录识别的入口。添加后可在节点内选择模型和输入参数。</div>
          <h4>图片</h4>{grid(PAID_IMAGE_NODES)}
          <h4>视频</h4>{grid(PAID_VIDEO_NODES)}
          <h4>管理</h4>{grid(PAID_MANAGE_NODES)}
          <h4>通用</h4>{grid([PAID_CHAT_NODE])}
        </div>}
        {nodeTab === 'workflow' && <Toolbar embedded onClose={() => setOpen(false)} />}
      </>}
    </section>
  </aside>;
};
import React, { useEffect, useState } from 'react';
import { AppstoreOutlined, CloseOutlined, FolderOpenOutlined, PictureOutlined, RocketOutlined } from '@ant-design/icons';
import { Button, Segmented } from 'antd';
import { AssetLibrary } from '@/components/AssetLibrary';
import { Toolbar } from '@/components/Toolbar';
import { useCanvasStore } from '@/stores/canvasStore';
import { NodeIcon } from '@/config/nodeIcons';
import type { NodeComponentType } from '@/types';
import type { PaidCapability } from '@/services/paidApi.service';
import { PAID_CAPABILITIES } from '@/services/paidApi.service';
import { PAID_API_ADAPTERS, PAID_PROVIDER_IDS, getPaidProvidersForCapability } from '@/config/paidApiAdapters';
import { DOMAIN_TEMPLATES, type DomainTemplate } from '@/config/domainTemplates';
import { createWorkflowNode } from '@/utils/workflowNode';

type MainTab = 'assets' | 'nodes';
type NodeTab = 'fixed' | 'paid' | 'workflow' | 'template';

const FIXED_NODES: Array<{ type: NodeComponentType; label: string }> = [
  { type:'textInput', label:'文本' }, { type:'scriptInput', label:'剧本' },
  { type:'uploadNode', label:'上传' }, { type:'sceneSettings', label:'场景设定' },
  { type:'imageCrop', label:'修图裁切' }, { type:'videoTrim', label:'视频剪辑' },
  { type:'preview', label:'结果预览' },
  { type:'compare', label:'前后对比' }, { type:'storyboardPrompt', label:'剧情分镜' }, { type:'storyboardRender', label:'分镜出图' }, { type:'timelineRender', label:'时间线合成' },
  { type:'cinematographyKnowledge', label:'影视知识库' },
];
const PAID_IMAGE_NODES: Array<{ type: NodeComponentType; label: string; config?: Record<string, unknown> }> = [
  ...(['text-to-image', 'image-to-image', 'image-upscale', 'remove-background', 'outpaint', 'background-generation', 'style-transfer'] as PaidCapability[]).map(capability => ({
    type: 'paidCapability' as NodeComponentType,
    label: PAID_CAPABILITIES[capability].label,
    config: { capability, provider: getPaidProvidersForCapability(capability)[0]?.id || '' },
  })).filter(item => getPaidProvidersForCapability(item.config?.capability as PaidCapability).length > 0),
];
const PAID_VIDEO_NODES: Array<{ type: NodeComponentType; label: string; config?: Record<string, unknown> }> = [
  ...(['text-to-video', 'image-to-video', 'first-last-to-video', 'reference-to-video', 'motion-video', 'video-edit', 'dance-video', 'lipsync'] as PaidCapability[]).map(capability => ({
    type: 'paidCapability' as NodeComponentType,
    label: PAID_CAPABILITIES[capability].label,
    config: { capability, provider: getPaidProvidersForCapability(capability)[0]?.id || '' },
  })).filter(item => getPaidProvidersForCapability(item.config?.capability as PaidCapability).length > 0),
];
const PAID_MANAGE_NODES: Array<{ type: NodeComponentType; label: string; config?: Record<string, unknown> }> = [
  ...(['element-manage', 'voice-manage'] as PaidCapability[]).map(capability => ({
    type: 'paidCapability' as NodeComponentType,
    label: PAID_CAPABILITIES[capability].label,
    config: { capability, provider: getPaidProvidersForCapability(capability)[0]?.id || '' },
  })).filter(item => getPaidProvidersForCapability(item.config?.capability as PaidCapability).length > 0),
];
const PAID_AUDIO_NODES: Array<{ type: NodeComponentType; label: string; config?: Record<string, unknown> }> = [
  ...(['text-to-speech'] as PaidCapability[]).map(capability => ({
    type: 'paidCapability' as NodeComponentType,
    label: PAID_CAPABILITIES[capability].label,
    config: { capability, provider: getPaidProvidersForCapability(capability)[0]?.id || '' },
  })).filter(item => getPaidProvidersForCapability(item.config?.capability as PaidCapability).length > 0),
];
const PAID_3D_NODES: Array<{ type: NodeComponentType; label: string; config?: Record<string, unknown> }> = [
  ...(['text-to-3d', 'image-to-3d'] as PaidCapability[]).map(capability => ({
    type: 'paidCapability' as NodeComponentType,
    label: PAID_CAPABILITIES[capability].label,
    config: { capability, provider: getPaidProvidersForCapability(capability)[0]?.id || '' },
  })).filter(item => getPaidProvidersForCapability(item.config?.capability as PaidCapability).length > 0),
];


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
  // hooks 必须在任何条件 return 之前无条件调用（否则收起/展开切换时 hooks 数量变化 → React error #310 崩溃）
  const [favs, setFavs] = React.useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('jacecanvas-fav-nodes') || '[]'); } catch { return []; } });
  const toggleFav = (type: string) => setFavs(prev => { const next = prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]; localStorage.setItem('jacecanvas-fav-nodes', JSON.stringify(next)); return next; });
  if (!open) return <Button className="workspace-sidebar-toggle" icon={<FolderOpenOutlined />} onClick={() => toggleOpen(true)}>资产 / 节点</Button>;
  const add = (type: NodeComponentType) => addNode(type, center(), { label: undefined } as any);
  const grid = (nodes: Array<{ type: NodeComponentType; label: string; config?: Record<string, unknown> }>, withFav = false) => <div className="workspace-node-grid">{nodes.map(item => <button key={`${item.type}-${item.label}`} onClick={() => addNode(item.type, center(), item.config ? { config: item.config, label: item.label } as any : { label: item.label } as any)} style={{ position: 'relative' }}><i><NodeIcon type={item.type} size={13} /></i><span>{item.label}</span>{withFav && <span title={favs.includes(item.type) ? '取消收藏' : '收藏'} onClick={e => { e.stopPropagation(); toggleFav(item.type); }} style={{ position: 'absolute', top: 2, right: 5, fontSize: 10, cursor: 'pointer', opacity: favs.includes(item.type) ? 1 : 0.3 }}>{favs.includes(item.type) ? '★' : '☆'}</span>}</button>)}</div>;
  return <aside className="workspace-sidebar">
    <header><div className="workspace-sidebar__brand"><AppstoreOutlined /> 创作工作区</div><Button type="text" icon={<CloseOutlined />} onClick={() => toggleOpen(false)} /></header>
    <Segmented block value={mainTab} onChange={value => setMainTab(value as MainTab)} options={[{ label:<span><PictureOutlined /> 资产</span>, value:'assets' }, { label:<span><RocketOutlined /> 节点</span>, value:'nodes' }]} />
    <section className="workspace-sidebar__body">
      {mainTab === 'assets' && <AssetLibrary embedded collapsed={false} onToggle={() => toggleOpen(false)} />}
      {mainTab === 'nodes' && <>
        <Segmented className="workspace-sidebar__node-tabs" block value={nodeTab} onChange={value => setNodeTab(value as NodeTab)} options={[{label:'固定节点',value:'fixed'},{label:'付费 API',value:'paid'},{label:'工作流节点',value:'workflow'},{label:'模板',value:'template'}]} />
        {nodeTab === 'fixed' && <>
          {favs.length > 0 && <div style={{ marginBottom: 4 }}><div style={{ fontSize: 10, color: 'var(--theme-muted)', margin: '6px 2px 4px' }}>⭐ 常用</div>{grid(FIXED_NODES.filter(n => favs.includes(n.type)), true)}</div>}
          {FIXED_NODES.filter(n => !favs.includes(n.type)).length > 0 && grid(FIXED_NODES.filter(n => !favs.includes(n.type)), true)}
        </>}
        {nodeTab === 'paid' && <div className="workspace-paid-node-groups">
          <div className="workspace-sidebar__hint">只显示已配置或可由厂商能力目录识别的入口。添加后可在节点内选择模型和输入参数。</div>
          <h4>图片</h4>{grid(PAID_IMAGE_NODES)}
          <h4>视频</h4>{grid(PAID_VIDEO_NODES)}
          <h4>管理</h4>{grid(PAID_MANAGE_NODES)}
          <h4>音频</h4>{grid(PAID_AUDIO_NODES)}
          <h4>3D</h4>{grid(PAID_3D_NODES)}
          {/* AI 聊天已移至右下角悬浮助手（FloatingAssistant） */}
        </div>}
        {nodeTab === 'workflow' && <Toolbar embedded onClose={() => setOpen(false)} />}
        {nodeTab === 'template' && <TemplateLibrary />}
      </>}
    </section>
  </aside>;
};

/** 专业领域模板库：一键添加预置节点组合 */
const TemplateLibrary: React.FC = () => {
  const [domain, setDomain] = useState<'全部' | '短剧' | '电商' | '通用'>('全部');
  const [applying, setApplying] = useState<string | null>(null);
  const dropCount = React.useRef(0);
  const list = DOMAIN_TEMPLATES.filter(tpl => domain === '全部' || tpl.domain === domain);
  const applyTemplate = async (tpl: DomainTemplate) => {
    setApplying(tpl.id);
    try {
      const store = useCanvasStore.getState();
      const ids: string[] = [];
      const startX = 80; const startY = 120 + (dropCount.current % 10) * 44; const dx = 340; dropCount.current += 1;
      for (let i = 0; i < tpl.steps.length; i++) {
        const step = tpl.steps[i];
        const pos = { x: startX + i * dx, y: startY };
        if (step.type === 'apiNode' && step.workflowId) {
          const id = await createWorkflowNode(step.workflowId, pos, step.config, step.label);
          ids.push(id);
        } else {
          let cfg = { ...(step.config || {}) };
          if (step.capability) {
            cfg = { capability: step.capability, provider: step.provider || getPaidProvidersForCapability(step.capability as PaidCapability)[0]?.id || '', ...cfg };
          }
          const id = store.addNode(step.type as NodeComponentType, pos, { label: step.label, config: cfg });
          ids.push(id);
        }
      }
      tpl.links.forEach(link => {
        if (ids[link.from] && ids[link.to]) {
          store.onConnect({ source: ids[link.from], sourceHandle: link.fromPort || 'output', target: ids[link.to], targetHandle: link.toPort || 'input' });
        }
      });
      setApplying(null);
    } catch (error) {
      setApplying(null);
      console.error('模板添加失败', error);
    }
  };
  return <div className="workspace-template-library">
    <Segmented block size="small" value={domain} onChange={value => setDomain(value as typeof domain)} options={['全部', '短剧', '电商', '通用']} style={{ marginBottom: 8 }} />
    {list.length === 0 && <div className="workspace-sidebar__hint">该领域暂无预置模板</div>}
    {list.map(tpl => <div key={tpl.id} className="workspace-template-card">
      <div className="workspace-template-card__head">
        <b>{tpl.name}</b>
        <span className={'workspace-template-card__domain workspace-template-card__domain--' + tpl.domain}>{tpl.domain}</span>
      </div>
      <p>{tpl.desc}</p>
      <Button size="small" type="primary" loading={applying === tpl.id} onClick={() => void applyTemplate(tpl)}>一键添加</Button>
    </div>)}
  </div>;
};
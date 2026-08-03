import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App, Badge, Button, Empty, Input, Segmented, Spin, Tag, Tooltip } from 'antd';
import { AppstoreOutlined, CloseOutlined, ReloadOutlined, SearchOutlined, StarFilled, ThunderboltOutlined, EyeOutlined, EditOutlined, UploadOutlined, DiffOutlined, FileTextOutlined } from '@ant-design/icons';
import { useCanvasStore } from '@/stores/canvasStore';
import { fetchWorkflowConfig, fetchWorkflows, getCachedWorkflowDirectory, importWorkflowDirectory, type ServerWorkflow } from '@/services/comfyui.service';
import { getWorkflowDefaults } from '@/services/workflowDefaults';
import type { CanvasNodeData } from '@/types';
import { mediaTypeForField, getWorkflowConfig } from '@/config/workflowConfig';

type Category = '全部' | '图像' | '视频' | '数字人' | '音频' | '其他';
const VERIFIED_WORKFLOWS = new Set(['Z-image-Nunchaku加速文生图', 'Qwen编辑Nunchaku']);
const FEATURED_ORDER: Record<string, number> = { 'Qwen编辑Nunchaku': 0, 'Z-image-Nunchaku加速文生图': 1 };

function categoryOf(workflow: ServerWorkflow): Category {
  const text = `${workflow.id} ${workflow.name || ''} ${workflow.kind || ''}`.toLowerCase();
  if (workflow.kind === 'audio' || /音频|声音|audio|fish|音乐|tts|语音/.test(text)) return '音频';
  if (workflow.kind === 'digital_human' || /数字人|对口型|infinitetalk|动作迁移|lipsync|lip-sync|人物替换/.test(text)) return '数字人';
  if (workflow.kind === 'video' || /视频|ltx|wan2|wan|首尾帧|animate|短剧|video|motion|补帧/.test(text)) return '视频';
  if (workflow.kind === 'image' || /文生图|生图|图像|qwen|krea|zimage|高清|放大|分镜|洗图|多视图|三视图|图生图|image|flux|sdxl|编辑/.test(text)) return '图像';
  return '其他';
}

function visual(category: Category) {
  if (category === '视频') return { icon: '▶', color: '#34d399' };
  if (category === '数字人') return { icon: '◉', color: '#fbbf24' };
  if (category === '音频') return { icon: '♪', color: '#fb923c' };
  if (category === '图像') return { icon: '◆', color: '#8b7cf6' };
  return { icon: '◇', color: '#94a3b8' };
}

/**
 * 桌面端节点库以服务器主控的 /api/workflow/list 为准。
 * 本地目录只作为服务器不可用时的离线兜底，不能覆盖服务器返回的节点。
 */
function localWorkflows(): ServerWorkflow[] {
  // 生成类节点必须来自用户自己的主控。
  return [];
}

function usableDirectory(items: ServerWorkflow[]): boolean {
  return items.length > 0 && items.every(item => item.id && !/[\u0000-\u001f�]/.test(item.id));
}

function localWorkflowFields(workflowId: string) {
  const config = getWorkflowConfig(workflowId);
  if (!config) return [];
  return [...config.coreParams, ...config.advancedParams].map(field => ({
    key: `${field.nodeId}:${field.fieldName}`,
    label: field.label,
    value: field.default,
    field: field.fieldName,
    nodeTitle: field.nodeTitle,
    type: field.type,
    fileType: mediaTypeForField(field.nodeClass, field.fieldName),
  }));
}

function workflowFields(remote: Awaited<ReturnType<typeof fetchWorkflowConfig>>) {
  const enabled = remote.api_config?.enabledParams || {};
  const labels = remote.api_config?.customLabels || {};
  const values = remote.api_config?.formValues || {};
  const template = remote.workflow_template || {};
  const optionsFor = (field: string, value: unknown) => {
    if (Array.isArray(value)) return value.map(option => ({ label: String(option), value: String(option) }));
    if (field === 'sampler_name') return [{ label: 'Euler', value: 'euler' }, { label: 'Euler A', value: 'euler_ancestral' }, { label: 'DPM++ 2M', value: 'dpmpp_2m' }, { label: 'DPM++ SDE', value: 'dpmpp_sde' }, { label: 'DDIM', value: 'ddim' }];
    if (field === 'scheduler') return [{ label: 'Normal', value: 'normal' }, { label: 'Karras', value: 'karras' }, { label: 'Simple', value: 'simple' }, { label: 'Exponential', value: 'exponential' }];
    if (field === 'aspect_ratio') return [{ label: '1:1', value: '1:1' }, { label: '9:16 竖屏', value: '9:16' }, { label: '16:9 横屏', value: '16:9' }, { label: '3:4', value: '3:4' }, { label: '4:3', value: '4:3' }];
    return undefined;
  };
  return Object.keys(enabled).filter(key => enabled[key]).map(key => {
    const split = key.indexOf(':'); const nodeId = key.slice(0, split); const field = key.slice(split + 1);
    const node = template[nodeId] || {}; const value = values[key] ?? node.inputs?.[field];
    const cls = String(node.class_type || '').toLowerCase();
    const exactMediaField = /^(image|video|audio|file)$/i.test(field) ? field.toLowerCase() : '';
    const fileType = cls.includes('loadaudio') || exactMediaField === 'audio' ? 'audio' : (cls.includes('loadvideo') || cls.includes('vhs_loadvideo') || exactMediaField === 'video') ? 'video' : (cls.includes('loadimage') || /image|mask|reference|file|path|font/i.test(field)) ? 'image' : undefined;
    const boolValue = typeof value === 'boolean' || /^(true|false)$/i.test(String(value ?? ''));
    const numberValue = typeof value === 'number';
    const options = optionsFor(field, node.inputs?.[field]?.options || node.inputs?.[field]?.values);
    return { key, label: labels[key] || field, value, field, nodeTitle: node._meta?.title || `节点 ${nodeId}`, fileType, type: boolValue ? 'boolean' : numberValue ? 'number' : options?.length ? 'select' : 'text', options };
  });
}

export const Toolbar: React.FC<{ embedded?: boolean; onClose?: () => void }> = ({ embedded = false, onClose }) => {
  const [open, setOpen] = useState(true);
  const [workflows, setWorkflows] = useState<ServerWorkflow[]>(() => {
    const cached = getCachedWorkflowDirectory();
    return usableDirectory(cached) ? cached : localWorkflows();
  });
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<string | null>(null);
  const [category, setCategory] = useState<Category>('全部');
  const [search, setSearch] = useState('');
  const directoryInput = useRef<HTMLInputElement>(null);
  const addNode = useCanvasStore(s => s.addNode);
  const { message } = App.useApp();
  const center=useCallback(()=>((window as any).__canvasCenter?.()||{x:360,y:220}) as {x:number;y:number},[]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const remote = await fetchWorkflows();
      // 主控返回的目录优先，包含新增、删除和改名；只有接口失败才使用缓存。
      setWorkflows(usableDirectory(remote) ? remote : localWorkflows());
    }
    catch { setWorkflows([]); }
    finally { setLoading(false); }
  }, [message]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const openLibrary=()=>setOpen(true); window.addEventListener('ai-canvas-open-node-library',openLibrary); return()=>window.removeEventListener('ai-canvas-open-node-library',openLibrary); }, []);

  const importDirectory = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = importWorkflowDirectory(JSON.parse(String(reader.result)));
        if (!imported.length) throw new Error('文件中没有有效的工作流目录');
        setWorkflows(imported);
        message.success(`已导入 ${imported.length} 个工作流节点`);
      } catch (error) { message.error(error instanceof Error ? error.message : '工作流目录格式错误'); }
    };
    reader.readAsText(file);
  };

  const filtered = useMemo(() => workflows
    .filter(w => category === '全部' || categoryOf(w) === category)
    .filter(w => !search.trim() || `${w.id} ${w.name}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => (FEATURED_ORDER[a.id] ?? 99) - (FEATURED_ORDER[b.id] ?? 99) || Number(b.pinned) - Number(a.pinned) || (b.run_count || 0) - (a.run_count || 0)),
  [workflows, category, search]);

  const addWorkflow = useCallback(async (workflow: ServerWorkflow, position?: {x:number;y:number}) => {
    if (position) setOpen(false);
    setAdding(workflow.id);
    try {
      let fields: ReturnType<typeof workflowFields> | ReturnType<typeof localWorkflowFields> = [];
      let remoteDefaults: Record<string, unknown> = {};
      try {
        const remote = await fetchWorkflowConfig(workflow.id);
        fields = workflowFields(remote);
        remoteDefaults = Object.fromEntries(fields.map(f => [f.key, f.value]));
      } catch {
        // API 未连接时使用桌面端内置配置，节点仍可创建；真正执行时再提示连接问题。
        fields = localWorkflowFields(workflow.id);
        remoteDefaults = Object.fromEntries(fields.map(f => [f.key, f.value]));
      }
      const savedDefaults = getWorkflowDefaults(workflow.id);
      const cat = categoryOf(workflow); const style = visual(cat);
      const data: Partial<CanvasNodeData> = {
        label: workflow.name || workflow.id, color: style.color,
        config: { workflow_id: workflow.id, _apiName: workflow.id, _apiLabel: workflow.id, _apiFields: fields, _serverDefaults: remoteDefaults, ...remoteDefaults, ...savedDefaults },
      };
      addNode('apiNode', position || center(), data);
      message.success(`已添加：${workflow.id}`);
    } catch (error) { message.error(error instanceof Error ? error.message : '节点添加失败'); }
    finally { setAdding(null); }
  }, [addNode, center, message]);

  useEffect(() => {
    (window as any).__addRemoteWorkflow = (workflow: ServerWorkflow, position: {x:number;y:number}) => addWorkflow(workflow, position);
    return () => { delete (window as any).__addRemoteWorkflow; };
  }, [addWorkflow]);

  if (!open && !embedded) return <Tooltip title="打开节点库"><Button className="node-library-toggle" icon={<AppstoreOutlined/>} onClick={() => setOpen(true)}>节点库</Button></Tooltip>;
  return <aside className={`node-library ${embedded ? 'node-library--embedded' : ''}`}>
    <div className="node-library__header">
      <div><div className="node-library__title">工作流节点</div><div className="node-library__subtitle">{workflows.length} 个服务器 API</div></div>
      <Tooltip title="刷新服务器目录"><Button type="text" icon={<ReloadOutlined spin={loading}/>} onClick={load}/></Tooltip>
      <Tooltip title="导入网页版工作流目录 JSON"><Button type="text" icon={<UploadOutlined/>} onClick={() => directoryInput.current?.click()}/></Tooltip>
      <Button type="text" icon={<CloseOutlined/>} onClick={() => embedded ? onClose?.() : setOpen(false)}/>
    </div>
    <input ref={directoryInput} type="file" accept=".json,application/json" hidden onChange={importDirectory}/>
    {!embedded && <div className="node-library__quick">
      <Button icon={<EditOutlined/>} onClick={()=>addNode('textInput',center())}>文本节点</Button>
      <Button icon={<FileTextOutlined/>} onClick={()=>addNode('scriptInput',center())}>剧本输入</Button>
      <Button icon={<EditOutlined/>} onClick={()=>addNode('sceneSettings',center())}>场景设定</Button>
      <Button icon={<UploadOutlined/>} onClick={()=>addNode('uploadNode',center())}>上传节点</Button>
      <Button icon={<span>💬</span>} onClick={()=>addNode('chatNode',center(),{label:'AI聊天'})}>AI聊天</Button>
      <Button icon={<EyeOutlined/>} onClick={()=>addNode('preview',center(),{label:'结果预览'})}>预览节点</Button>
      <Button icon={<DiffOutlined/>} onClick={()=>addNode('compare',center())}>前后对比</Button>
      <Button icon={<span>✂</span>} onClick={()=>addNode('videoTrim',center(),{label:'视频剪辑'})}>视频剪辑</Button>
      <Button icon={<span>✂️</span>} onClick={()=>addNode('imageCrop',center(),{label:'修图裁切'})}>修图裁切</Button>
      <Button icon={<span>⚙</span>} onClick={()=>addNode('video2xLocal',center(),{label:'Video2X超分/补帧（开源本地）'})}>Video2X超分/补帧</Button>
      <Button icon={<FileTextOutlined/>} onClick={()=>addNode('storyboardPrompt',center(),{label:'剧情分镜提示词'})}>剧情分镜</Button>
      <Button icon={<ThunderboltOutlined/>} onClick={()=>addNode('cinematographyKnowledge',center(),{label:'影视专业效果知识库'})}>影视知识库</Button>
    </div>}
    <div className="node-library__filters">
      <Input allowClear prefix={<SearchOutlined/>} value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索工作流..."/>
      <Segmented block value={category} onChange={v => setCategory(v as Category)} options={['全部','图像','视频','数字人','音频','其他']}/>
    </div>
    <div className="node-library__content">
      {loading ? <div className="node-library__loading"><Spin/><span>正在读取服务器节点...</span></div> : filtered.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配节点"/> :
        <div className="node-library__grid">{filtered.map(workflow => {
          const cat = categoryOf(workflow); const style = visual(cat); const verified = VERIFIED_WORKFLOWS.has(workflow.id); const isQwenEdit = workflow.id === 'Qwen编辑Nunchaku';
          return <button key={workflow.id} className="workflow-card" onClick={() => addWorkflow(workflow)} draggable
            onDragStart={e => { e.dataTransfer.setData('application/remote-workflow', JSON.stringify(workflow)); e.dataTransfer.effectAllowed = 'copy'; }}>
            <span className="workflow-card__icon" style={{color:style.color,background:`${style.color}18`}}>{style.icon}</span>
            <span className="workflow-card__body"><span className="workflow-card__name">{workflow.name || workflow.id}</span><span className="workflow-card__meta"><Tag color={style.color}>{isQwenEdit?'图像编辑':cat}</Tag>{verified && <Tag color="green"><ThunderboltOutlined/> 已验证</Tag>}{workflow.pinned && <StarFilled style={{color:'#fbbf24'}}/>}</span></span>
            {(workflow.run_count || 0) > 0 && <Badge count={workflow.run_count} overflowCount={999} color="#3730a3"/>}
            {adding === workflow.id && <span className="workflow-card__adding"><Spin size="small"/></span>}
          </button>;
        })}</div>}
    </div>
  </aside>;
};
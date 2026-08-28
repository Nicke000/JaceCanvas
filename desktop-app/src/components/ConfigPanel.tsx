import React, { useEffect, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { Button, Form, Input, InputNumber, Space, Tag, Select, Switch, App, Modal } from 'antd';
import { CloseOutlined, PlayCircleOutlined, ThunderboltOutlined, SettingOutlined, MessageOutlined, EyeOutlined, EyeInvisibleOutlined } from '@ant-design/icons';
import { parseWorkflowParams, defaultParamVisible, isPositivePromptField, isNegativePromptField, shouldShowInputPort, setPortShow, type LocalWorkflowParam } from '@/utils/comfyWorkflow';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { fetchWorkflows, type ServerWorkflow } from '@/services/comfyui.service';
import { getApiNodeFormFields } from '@/config/apiNodes';
import { PromptActions } from '@/components/PromptActions';
import { sendChat } from '@/services/chat.service';
import { promptKindForNode } from '@/services/promptOptimizer.service';
import { BAILIAN_RATIO_OPTIONS, BAILIAN_RESOLUTION_OPTIONS, BAILIAN_VIDEO_RATIO_OPTIONS, BAILIAN_VIDEO_RESOLUTION_OPTIONS, getBailianImageSize } from '@/services/bailianTextToImage.service';
import { PAID_API_ADAPTERS, getPaidModelsForAdapter, getPaidProvidersForCapability, type PaidProviderId } from '@/config/paidApiAdapters';
import { PAID_CAPABILITIES, type PaidCapability } from '@/services/paidApi.service';
import { getPaidParamKinds } from '@/config/paidApiParamSchema';
import { getAllStyles } from '@/config/stylePresets';
import { CAMERA_MOTIONS } from '@/config/cameraMotions';
import { NODE_MAP } from '@/config/registry';
import { runningHubParamLabel, runningHubParamHelp, type RunningHubModelContract } from '@/config/runninghubCatalog';

function randomSeedLike(value: unknown): number {
  const current = Number(value);
  const digits = Number.isFinite(current) && Math.abs(Math.trunc(current)) >= 1 ? String(Math.abs(Math.trunc(current))).length : 9;
  const min = digits === 1 ? 0 : 10 ** (digits - 1);
  const max = 10 ** digits - 1;
  return Math.floor(min + Math.random() * (max - min + 1));
}

export const ConfigPanel: React.FC = () => {
  const sid = useCanvasStore(s => s.selectedNodeId);
  const nodes = useCanvasStore(s => s.nodes);
  const setSelected = useCanvasStore(s => s.setSelectedNodeId);
  const setConfig = useCanvasStore(s => s.setNodeConfig);
  const updateNodeData = useCanvasStore(s => s.updateNodeData);
  const servers = useSettingsStore(s => s.servers);
  const paidApiProviders = useSettingsStore(s => s.paidApiProviders);
  const execute = useCanvasStore(s => s.enqueueNode);
  const executeFrom = useCanvasStore(s => s.executeFromNode);
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [workflows, setWorkflows] = useState<ServerWorkflow[]>([]);
  const node = nodes.find(item => item.id === sid);
  const config = node?.data.config || {};
  const nodeType = node?.data.nodeType;

  // ===== 选中节点上下文对话（hooks 必须在条件 return 之前）=====
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMsgs, setChatMsgs] = useState<Array<{ role: 'user' | 'ai'; text: string }>>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [dispOpen, setDispOpen] = useState(false); // 本地工作流参数显示设置弹窗
  useEffect(() => { fetchWorkflows().then(setWorkflows).catch(() => setWorkflows([])); }, [node?.id]);
  useEffect(() => { if (node) form.setFieldsValue(node.data.config); }, [node?.id, node?.data.updatedAt, form]);
  if (!node) return null;

  const nodeContext = (() => {
    const n = nodes.find(x => x.id === sid);
    if (!n) return '';
    const parts: string[] = [`【当前节点】${n.data.label}（${n.data.nodeType}）`, `配置：${JSON.stringify(n.data.config || {}).slice(0, 800)}`, n.data.resultUrl ? `结果：${String(n.data.resultUrl)}` : ''];
    const allEdges = useCanvasStore.getState().edges;
    nodes.forEach(src => { if (src.id === n.id) return; const incoming = allEdges.filter(e => e.target === n.id && e.source === src.id); if (incoming.length) parts.push(`【上游节点】${src.data.label}：${JSON.stringify(src.data.config || {}).slice(0, 400)}`); });
    return parts.filter(Boolean).join('\n');
  })();
  const sendNodeChat = async (text: string) => {
    if (!text.trim() || chatBusy) return;
    setChatMsgs(m => [...m, { role: 'user', text }]);
    setChatInput(''); setChatBusy(true);
    try {
      const history = [{ role: 'user' as const, content: `以下是画布节点上下文，请基于它回答，不要臆造不存在的内容：\n${nodeContext}` }];
      const result = await sendChat(text, [], history, undefined, {});
      setChatMsgs(m => [...m, { role: 'ai', text: result.text || '（无回复）' }]);
    } catch (e: any) { setChatMsgs(m => [...m, { role: 'ai', text: '出错了：' + String(e?.message || e) + '（请先在设置中配置聊天 AI）' }]); }
    finally { setChatBusy(false); }
  };

  const change = (key: string, value: unknown) => { setConfig(node.id, { ...(useCanvasStore.getState().nodes.find(n => n.id === node.id)?.data.config || {}), [key]: value }); form.setFieldValue(key, value); };
  const isSeed = (name: string) => /(?:^|_)(?:seed|noise_seed|random_seed)$/i.test(name);
  // 「呈现连接点」开关：控制该参数是否生成输入端口。默认只显示素材/文本类，可手动补开。
  const setPortVisible = (key: string, type: string | undefined, show: boolean) => setConfig(node.id, setPortShow(config as Record<string, unknown>, key, show));
  const portToggle = (key: string, type?: string, size: 'small' | 'default' = 'small') => (
    <Switch size={size} checked={shouldShowInputPort(key, type, config as Record<string, unknown>)} onChange={v => setPortVisible(key, type, v)} title="是否呈现连接点" />
  );
  // 参数标签 + 右上角「呈现连接点」开关，供各 render 复用
  const labelWithPort = (text: React.ReactNode, key: string, type?: string) => (
    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%' }}>{text}<span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flex: 'none' }}>{portToggle(key, type)}</span></span>
  );
  // 像素宽高/分辨率字段：给常用尺寸快捷选项（宽高一起则一起给，分开则分开给）
  const renderDimQuick = (key: string, label: string, fieldName: string) => {
    const lower = fieldName.toLowerCase();
    const isWidth = /width|宽/.test(lower);
    const isHeight = /height|高/.test(lower);
    const isRes = /resolution|res|尺寸|分辨|size/.test(lower);
    if (!isWidth && !isHeight && !isRes) return null;
    const allFields = (config._apiFields as Array<any>) || [];
    const widthKey = allFields.find(f => /width|宽/.test(String(f.field || f.key)))?.key;
    const heightKey = allFields.find(f => /height|高/.test(String(f.field || f.key)))?.key;
    const widthValue = widthKey ? Number(config[widthKey] ?? 1024) : 1024;
    const heightValue = heightKey ? Number(config[heightKey] ?? 1024) : 1024;
    // 宽高字段同时存在 → 一起给常见比例；否则给单侧常见数值
    const chips: Array<{ label: string; w?: number; h?: number; v?: number }> = (widthKey && heightKey)
      ? [
          { label: '1:1 512²', w: 512, h: 512 }, { label: '1:1 768²', w: 768, h: 768 }, { label: '1:1 1024²', w: 1024, h: 1024 },
          { label: '16:9', w: 1344, h: 768 }, { label: '9:16', w: 768, h: 1344 },
          { label: '4:3', w: 1152, h: 896 }, { label: '3:4', w: 896, h: 1152 },
          { label: '自定义', w: widthValue, h: heightValue },
        ]
      : [512, 640, 768, 896, 1024, 1344, 1440, 1920, 2560].map(v => ({ label: String(v), v }));
    return <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 4 }}>
      {chips.map(c => <button key={c.label} type="button" onClick={() => {
        if (c.w && c.h && widthKey && heightKey) { change(widthKey, c.w); change(heightKey, c.h); }
        else if (c.v !== undefined) change(key, c.v);
      }} style={{ padding: '1px 7px', fontSize: 9, border: '1px solid var(--theme-border)', background: 'var(--theme-input)', color: 'var(--theme-text-2)', borderRadius: 4, cursor: 'pointer' }}>{c.label}</button>)}
    </div>;
  };
  const renderNumber = (key: string, label: string, value: unknown, fieldName = key) => {
    const quick = renderDimQuick(key, label, fieldName);
    // 兼容带描述字符串值（如 "0.4 | 864 x 480"）：提取数字显示，改时只存数字
    let numValue: number | null = null;
    if (value !== '' && value != null) {
      const n = Number(value);
      numValue = Number.isFinite(n) ? n : (() => { const m = String(value).match(/^\s*(-?\d+(?:\.\d+)?)/); return m ? Number(m[1]) : null; })();
    }
    return <div key={key} style={{ marginBottom: 10 }}><div style={{ color: 'var(--theme-muted)', fontSize: 11, marginBottom: 3 }}>{label}</div>{quick}<Space.Compact style={{ width: '100%' }}><InputNumber style={{ width: isSeed(fieldName) ? 'calc(100% - 58px)' : '100%' }} value={numValue} onChange={v => change(key, v)} />{isSeed(fieldName) && <Button onClick={() => change(key, randomSeedLike(value))}>随机</Button>}</Space.Compact></div>;
  };
  const renderApi = () => {
    const fields = (config._apiFields as Array<any>) || [];
    if (!fields.length) return <div style={{ color: 'var(--theme-muted)', fontSize: 12 }}>当前节点没有可用的服务器参数，请重新从节点库添加。</div>;
    // 兼容旧节点：ResolutionSelector 的 aspect_ratio 在旧 _apiFields 里可能是 text 类型且无 options，
    // 动态补全为 select（合法值是 ComfyUI 官方预设 "宽:高 (描述)"）；megapixels/multiple 是 FLOAT/INT 数字，保持数字输入
    const AR_OPTIONS = ['1:1 (Square)','2:3 (Portrait Photo)','3:2 (Photo)','3:4 (Portrait Standard)','4:3 (Standard)','9:16 (Portrait Widescreen)','16:9 (Widescreen)','21:9 (Ultrawide)'];
    const render = (field: any) => {
      let f = field;
      if ((field.field === 'aspect_ratio' || (field.key && field.key.split(':')[1] === 'aspect_ratio')) && !field.options?.length) {
        f = { ...field, type: 'select', options: AR_OPTIONS.map(v => ({ label: v, value: v })) };
      }
      const value = config[f.key] ?? f.value ?? '';
      if (f.fileType) return <Form.Item key={f.key} label={labelWithPort(f.label, f.key, f.fileType)}><Input value={String(value)} onChange={e => change(f.key, e.target.value)} placeholder={`输入或连接${f.fileType}资源`} /></Form.Item>;
      if (f.type === 'boolean') return <Form.Item key={f.key} label={labelWithPort(f.label, f.key, 'boolean')}><Switch checked={value === true || String(value).toLowerCase() === 'true'} onChange={v => change(f.key, v)} /></Form.Item>;
      if (f.type === 'number') return <Form.Item key={f.key} label={labelWithPort(f.label, f.key, 'number')}>{renderNumber(f.key, f.label, value, f.field || f.key)}</Form.Item>;
      if (f.type === 'select' && f.options) {
        // 兼容旧值：aspect_ratio 值可能是纯比例（旧数据/手填），映射到带官方描述的选项
        const arShortMap: Record<string, string> = {
          '1:1': '1:1 (Square)', '2:3': '2:3 (Portrait Photo)', '3:2': '3:2 (Photo)', '3:4': '3:4 (Portrait Standard)',
          '4:3': '4:3 (Standard)', '9:16': '9:16 (Portrait Widescreen)', '16:9': '16:9 (Widescreen)', '21:9': '21:9 (Ultrawide)',
        };
        const cur = String(value);
        // 值匹配：完整值、短值（arShortMap）、或数字匹配（megapixels 0.4 → "0.4 | 864 x 480"）
        const numCur = Number(cur);
        const matchedOpt = f.options.find((o: any) => String(o.value) === cur || arShortMap[String(o.value)] === cur || (Number.isFinite(numCur) && String(o.value).startsWith(cur + ' |')));
        return <Form.Item key={f.key} label={labelWithPort(f.label, f.key, 'select')}><Select style={{ width: '100%' }}
          value={matchedOpt ? String(matchedOpt.value) : cur}
          options={f.options.map((o: any) => ({ label: o.label, value: String(o.value) }))}
          onChange={v => change(f.key, v)} /></Form.Item>;
      }
      const long = /text|prompt|negative|positive|script|description|system/i.test(field.field || field.key);
      return <Form.Item key={field.key} label={labelWithPort(<span style={{ display: 'flex', justifyContent: 'space-between' }}>{field.label}{long && <PromptActions nodeId={node.id} value={String(value)} kind={promptKindForNode(nodeType || 'apiNode')} fieldKey={field.key} onChange={v => change(field.key, v)} />}</span>, field.key, 'text')}>{long ? <Input.TextArea value={String(value)} autoSize={{ minRows: 3, maxRows: 10 }} onChange={e => change(field.key, e.target.value)} /> : <Input value={String(value)} onChange={e => change(field.key, e.target.value)} />}</Form.Item>;
    };
    return <><Tag color="purple" style={{ marginBottom: 10 }}>{String(config.workflow_id || config._apiName || '服务器工作流')}</Tag>{fields.map(render)}</>;
  };
  const renderLocalWorkflow = () => {
    const wfJson = config.workflowJson as Record<string, any>;
    if (!wfJson) return <div style={{ color: 'var(--theme-muted)', fontSize: 12 }}>未配置工作流 JSON — 从节点库点「导入 JSON」粘贴/选择 ComfyUI 工作流，生成节点后在此调整参数。</div>;
    const params = parseWorkflowParams(wfJson);
    if (!params.length) return <div style={{ color: 'var(--theme-muted)', fontSize: 12 }}>工作流没有可调参数（全是节点连接）。</div>;
    const visibility = (config.paramVisibility || {}) as Record<string, boolean>;
    const isVisible = (key: string) => visibility[key] ?? defaultParamVisible(key.split(':')[1]);
    const setVisible = (key: string, v: boolean) => setConfig(node.id, { ...config, paramVisibility: { ...visibility, [key]: v } });
    const setParam = (key: string, value: unknown) => setConfig(node.id, { ...config, params: { ...(config.params || {}), [key]: value } });
    const notes = (config.paramNotes || {}) as Record<string, string>;
    const setNote = (key: string, v: string) => setConfig(node.id, { ...config, paramNotes: { ...notes, [key]: v } });
    const randomSeed = (p: LocalWorkflowParam) => {
      const cur = Math.abs(Math.floor(Number(((config.params || {}) as Record<string, unknown>)[p.key] ?? p.value) || 0));
      const digits = String(cur).length || 10;
      const min = Math.pow(10, digits - 1), max = Math.pow(10, digits) - 1;
      setParam(p.key, Math.floor(min + Math.random() * (max - min + 1)));
    };
    const groups: Record<string, LocalWorkflowParam[]> = {};
    params.forEach(p => { (groups[p.nodeTitle] = groups[p.nodeTitle] || []).push(p); });
    const visibleCount = params.filter(p => isVisible(p.key)).length;
    return <div>
      <Space style={{ marginBottom: 10 }} wrap>
        <Button size="small" icon={<SettingOutlined />} onClick={() => setDispOpen(true)}>显示设置（{visibleCount}/{params.length}）</Button>
        <Tag color="blue">{params.length} 参数 · 显示 {visibleCount}</Tag>
        <span style={{ fontSize: 10, color: 'var(--theme-muted)' }}>只显示勾选的参数，每个节点可分别设置</span>
      </Space>
      {Object.entries(groups).map(([title, list]) => {
        const shown = list.filter(p => isVisible(p.key));
        if (!shown.length) return null;
        return <div key={title} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--theme-muted)', marginBottom: 4, fontWeight: 600 }}>{title}</div>
          {shown.map(p => {
            const value = ((config.params || {}) as Record<string, unknown>)[p.key] ?? p.value;
            return <div key={p.key} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--theme-muted)', marginBottom: 3, display: 'flex', alignItems: 'center' }}>{p.label}{p.type === 'number' && /^seed$/i.test(p.field) && <Button size="small" type="text" title="随机种子（保持相同位数）" onClick={() => randomSeed(p)} style={{ fontSize: 10, padding: '0 4px', marginLeft: 4 }}>🎲</Button>}
                {notes[p.key] && <span title={notes[p.key]} style={{ fontSize: 10, color: 'var(--theme-muted)', marginLeft: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}><MessageSquare size={11} /> {notes[p.key]}</span>}
                <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, flex: 'none' }}>{portToggle(p.key, p.type)}</span></div>
              {p.type === 'number' ? <InputNumber style={{ width: '100%' }} value={value === '' || value == null ? null : Number(value)} onChange={v => setParam(p.key, v)} /> :
                p.type === 'boolean' ? <Switch checked={value === true || String(value).toLowerCase() === 'true'} onChange={v => setParam(p.key, v)} /> :
                (isPositivePromptField(p.field, { class_type: p.nodeClass, _meta: { title: p.nodeTitle } }) || isNegativePromptField(p.field, { class_type: p.nodeClass, _meta: { title: p.nodeTitle } }, value)) ? <Input.TextArea value={String(value)} autoSize={{ minRows: 2, maxRows: 6 }} onChange={e => setParam(p.key, e.target.value)} /> :
                <Input value={String(value)} onChange={e => setParam(p.key, e.target.value)} />}
            </div>;
          })}
        </div>;
      })}
      <Modal title="控制面板显示设置" open={dispOpen} onCancel={() => setDispOpen(false)} footer={<Button size="small" onClick={() => setDispOpen(false)}>完成</Button>} width={440}>
        <p style={{ fontSize: 11, color: 'var(--theme-muted)' }}>勾选要在控制面板显示的参数，未勾选的不显示（仅本节点生效）。</p>
        <div style={{ maxHeight: 380, overflow: 'auto', marginTop: 8 }}>
          {params.map(p => (
            <div key={p.key} style={{ padding: '5px 0', borderBottom: '1px solid var(--theme-border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Switch size="small" checked={isVisible(p.key)} onChange={v => setVisible(p.key, v)} />
                <span style={{ fontSize: 11, color: 'var(--theme-text)', flexShrink: 0 }}>{p.nodeTitle} · {p.label}</span>
                <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--theme-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>{String(((config.params || {}) as Record<string, unknown>)[p.key] ?? p.value)}</span>
              </div>
              <Input size="small" placeholder="参数备注（显示在面板参数旁）" value={notes[p.key] || ''} onChange={e => setNote(p.key, e.target.value)} style={{ marginTop: 4, fontSize: 11 }} />
            </div>
          ))}
        </div>
      </Modal>
    </div>;
  };
  const renderPaid = () => {
    const legacyCapability = nodeType === 'paidImageToImage' ? 'image-to-image' : nodeType === 'paidTextToVideo' ? 'text-to-video' : nodeType === 'paidImageToVideo' ? 'image-to-video' : 'text-to-image';
    const capability = String(config.capability || legacyCapability) as PaidCapability;
    const info = PAID_CAPABILITIES[capability];
    const providerIds = getPaidProvidersForCapability(capability).map(item => item.id);
    const providerId = String(config.provider || providerIds[0] || '') as PaidProviderId;
    const provider = PAID_API_ADAPTERS[providerId];
    const profile = paidApiProviders?.[providerId];
    const staticModels = getPaidModelsForAdapter(providerId, capability);
    const selectedFromSettings = String(profile?.selectedModel || '');
    const models = selectedFromSettings && !staticModels.some(model => model.id === selectedFromSettings)
      ? [...staticModels, { id:selectedFromSettings, label:selectedFromSettings, capabilities:[capability] }]
      : staticModels;
    const selectedModel = String(config.model || selectedFromSettings || models[0]?.id || '');
    const isCustomModel = Boolean(config.model) && !models.some(model => model.id === String(config.model));
    const supported = new Set(getPaidParamKinds(providerId, capability));
    const isVideo = info?.output === 'video';
    const isAudio = info?.output === 'audio';
    const is3d = info?.output === '3d';
    const isBailian = providerId === 'bailian';
    const ratio = String(config.aspectRatio || (isVideo ? '16:9' : '1:1'));
    const resolution = Number(config.resolution) || (isVideo ? 1080 : 1024);
    const ratioOptions = isBailian ? (isVideo ? BAILIAN_VIDEO_RATIO_OPTIONS : BAILIAN_RATIO_OPTIONS) : [{ label:'1:1', value:'1:1' }, { label:'16:9', value:'16:9' }, { label:'9:16', value:'9:16' }, { label:'4:3', value:'4:3' }, { label:'3:4', value:'3:4' }];
    const updateRatio = (value: string) => {
      const next: Record<string, unknown> = { aspectRatio: value };
      if (isBailian && !isVideo && value !== 'custom') {
        const [width, height] = getBailianImageSize(resolution, value).split('*').map(Number);
        Object.assign(next, { width, height });
      }
      change('aspectRatio', value);
      Object.entries(next).filter(([key]) => key !== 'aspectRatio').forEach(([key, value]) => change(key, value));
    };
    return <div className="paid-inspector">
      <div className="config-section-heading">{info?.label || '付费 API'} <small>{provider?.label || '选择厂商'}</small></div>
      <Form.Item label="厂商"><Select value={providerId} options={providerIds.map(id => ({ value:id, label:PAID_API_ADAPTERS[id].label }))} onChange={value => { change('provider', value); change('model', ''); }} /></Form.Item>
      <Form.Item label="模型"><Select value={isCustomModel ? '__custom__' : (selectedModel || undefined)} options={[...models.map(model => ({ value:model.id, label:model.label })), { value:'__custom__', label:'自定义模型 ID…' }]} onChange={value => change('model', value === '__custom__' ? 'custom-model-id' : value)} showSearch optionFilterProp="label" /></Form.Item>
      {isCustomModel && <Form.Item label="自定义模型 ID"><Input value={String(config.model || '')} onChange={event => change('model', event.target.value)} placeholder="填写厂商或网关返回的模型 ID" /></Form.Item>}
      {!profile?.apiKey && <div className="config-warning">当前厂商尚未配置 API Key。请在设置中的“付费 API”完成配置。</div>}
      <Form.Item label={<span style={{ display:'flex', justifyContent:'space-between' }}>提示词<PromptActions nodeId={node.id} value={String(config.prompt || '')} kind={promptKindForNode(nodeType || 'paidCapability')} fieldKey="prompt" onChange={value => change('prompt', value)} /></span>}><Input.TextArea value={String(config.prompt || '')} onChange={event => change('prompt', event.target.value)} autoSize={{ minRows: 4, maxRows: 10 }} placeholder={info?.input === 'image' ? '编辑指令（可选）' : '输入提示词，或从文本节点连接'} /></Form.Item>
      {!isAudio && !is3d && <Form.Item label="风格"><Select value={String(config.style || 'none')} options={getAllStyles().map(style => ({ value:style.id, label:style.name }))} onChange={value => change('style', value)} /></Form.Item>}
      {!isAudio && !is3d && supported.has('negative') && <Form.Item label="负面提示词"><Input.TextArea value={String(config.negativePrompt || '')} onChange={event => change('negativePrompt', event.target.value)} autoSize={{ minRows: 2, maxRows: 6 }} /></Form.Item>}
      {isAudio && <Form.Item label="音色"><Input value={String(config.voice_id || '')} onChange={event => change('voice_id', event.target.value)} placeholder="使用厂商支持的音色 ID" /></Form.Item>}
      {!isAudio && !is3d && <Form.Item label="画面比例"><Select value={ratio} options={[...ratioOptions, ...(supported.has('size') ? [{ label:'自定义尺寸', value:'custom' }] : [])]} onChange={updateRatio} /></Form.Item>}
      {!isAudio && !is3d && ratio === 'custom' && supported.has('size') && <Space.Compact style={{ width:'100%', marginBottom:12 }}><InputNumber value={Number(config.width) || 1024} min={1} onChange={value => change('width', value || 1024)} addonBefore="宽" style={{ width:'50%' }} /><InputNumber value={Number(config.height) || 1024} min={1} onChange={value => change('height', value || 1024)} addonBefore="高" style={{ width:'50%' }} /></Space.Compact>}
      {isBailian && !isAudio && !is3d && supported.has('size') && <Form.Item label="像素档"><Select value={resolution} options={BAILIAN_RESOLUTION_OPTIONS.map(item => ({ value:item.value, label:`${item.value}px` }))} onChange={value => { change('resolution', value); if (ratio !== 'custom') { const [width, height] = getBailianImageSize(value, ratio).split('*').map(Number); change('width', width); change('height', height); } }} /></Form.Item>}
      {!isAudio && !is3d && supported.has('seed') && <Form.Item label="种子"><InputNumber value={Number.isFinite(Number(config.seed)) ? Number(config.seed) : -1} min={-1} onChange={value => change('seed', value ?? -1)} style={{ width:'100%' }} /></Form.Item>}
      {!isAudio && !is3d && supported.has('variants') && <Form.Item label="变体数量"><InputNumber value={Number(config.variants) || 1} min={1} max={8} onChange={value => change('variants', Math.max(1, Math.min(8, value || 1)))} style={{ width:'100%' }} /></Form.Item>}
      {!isAudio && !is3d && supported.has('duration') && <Form.Item label="时长（秒）"><InputNumber value={Number(config.duration) || 5} min={1} max={60} onChange={value => change('duration', value || 5)} style={{ width:'100%' }} /></Form.Item>}
      {isVideo && supported.has('resolution') && <Form.Item label="输出分辨率"><Select value={resolution} options={BAILIAN_VIDEO_RESOLUTION_OPTIONS.map(value => ({ value, label:`${value}P` }))} onChange={value => change('resolution', value)} /></Form.Item>}
      {supported.has('fps') && <Form.Item label="帧率"><InputNumber value={Number(config.frameRate) || 24} min={1} max={120} onChange={value => change('frameRate', value || 24)} style={{ width:'100%' }} addonAfter="fps" /></Form.Item>}
      {isVideo && supported.has('camera') && <Form.Item label="运镜"><Select value={String(config.cameraMotion || '')} options={CAMERA_MOTIONS.map(motion => ({ value:motion.value, label:motion.label }))} onChange={value => change('cameraMotion', value)} /></Form.Item>}
    </div>;
  };
  const renderBasic = () => {
    const entry = nodeType ? NODE_MAP.get(nodeType as any) : undefined;
    const registryInputs = entry?.config?.inputs || [];
    return <Form form={form} layout="vertical" onValuesChange={(_, all) => setConfig(node.id, { ...config, ...all })}>
      {nodeType === 'textInput' && <Form.Item name="text" label="文本内容"><Input.TextArea autoSize={{ minRows: 3, maxRows: 10 }} /></Form.Item>}
      {nodeType === 'scriptInput' && <Form.Item name="scripts" label="剧本数据"><Input.TextArea value={JSON.stringify(config.scripts || [], null, 2)} onChange={e => { try { change('scripts', JSON.parse(e.target.value)); } catch {} }} autoSize={{ minRows: 5, maxRows: 12 }} /></Form.Item>}
      {nodeType === 'sceneSettings' && <Form.Item name="settings" label="场景设定"><Input.TextArea autoSize={{ minRows: 4, maxRows: 12 }} /></Form.Item>}
      {!['textInput','scriptInput','sceneSettings'].includes(String(nodeType)) && registryInputs.length > 0 ? registryInputs.map((field: any) => {
        const value = config[field.name] ?? field.default ?? '';
        if (field.type === 'number') return <Form.Item key={field.name} label={labelWithPort(field.label, field.name, 'number')}>{renderNumber(field.name, field.label, value, field.name)}</Form.Item>;
        if (field.type === 'select' && field.options) return <Form.Item key={field.name} label={labelWithPort(field.label, field.name, 'select')}><Select value={String(value)} options={field.options.map((o: any) => ({ value: o.value, label: o.label }))} onChange={v => change(field.name, v)} /></Form.Item>;
        return <Form.Item key={field.name} label={labelWithPort(field.label, field.name, 'text')}><Input value={String(value)} onChange={e => change(field.name, e.target.value)} /></Form.Item>;
      }) : !['textInput','scriptInput','sceneSettings'].includes(String(nodeType)) && <div style={{ color: 'var(--theme-muted)', fontSize: 12 }}>此节点没有可迁移的标量参数。</div>}
    </Form>;
  };
  const renderBailian = () => <Form form={form} layout="vertical" onValuesChange={(_, all) => setConfig(node.id, { ...config, ...all })}>
    <Form.Item name="prompt" label="提示词"><Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} placeholder="也可以从文本节点连接提示词" /></Form.Item>
    <Form.Item name="ratio" label="比例"><Select options={[...BAILIAN_RATIO_OPTIONS]} /></Form.Item>
    <Form.Item name="resolution" label="像素档"><Select options={[...BAILIAN_RESOLUTION_OPTIONS]} /></Form.Item>
    <Form.Item name="seed" label="随机种子"><InputNumber style={{ width:'100%' }} min={-1} max={2147483647} /></Form.Item>
  </Form>;
  const renderRunningHub = () => {
    const contract = config.runningHubContract as RunningHubModelContract | undefined;
    if (!contract || !Array.isArray(contract.params) || !contract.params.length) return <div style={{ color: 'var(--theme-muted)', fontSize: 12 }}>当前节点没有已解析的 RunningHub 参数，请在节点上点击「加载契约」后重试。</div>;
    return <Form form={form} layout="vertical" onValuesChange={(_, all) => setConfig(node.id, { ...config, ...all })}>
      {contract.params.map((param) => {
        const value = config[param.fieldKey] ?? param.defaultValue ?? '';
        const pType = param.type === 'IMAGE' ? 'image' : param.type === 'VIDEO' ? 'video' : param.type === 'AUDIO' ? 'audio' : param.type === 'BOOLEAN' ? 'boolean' : (param.type === 'INT' || param.type === 'FLOAT') ? 'number' : 'text';
        if (param.type === 'BOOLEAN') return <Form.Item key={param.fieldKey} label={labelWithPort(runningHubParamLabel(param), param.fieldKey, 'boolean')}><Switch checked={value === true || String(value).toLowerCase() === 'true'} onChange={v => change(param.fieldKey, v)} /></Form.Item>;
        if (param.type === 'LIST') return <Form.Item key={param.fieldKey} label={labelWithPort(runningHubParamLabel(param), param.fieldKey, 'select')}><Select style={{ width: '100%' }} value={String(value)} options={(param.options || []).map((o: any) => ({ value: String(o.value ?? o.description ?? ''), label: o.description || o.descriptionEn || o.value }))} onChange={v => change(param.fieldKey, v)} /></Form.Item>;
        if (['IMAGE','VIDEO','AUDIO'].includes(param.type)) return <Form.Item key={param.fieldKey} label={<span>{runningHubParamLabel(param)}<small style={{ color: 'var(--theme-muted)', marginLeft: 6 }}>从上方连接点连接</small>{portToggle(param.fieldKey, pType)}</span>}><Input value={String(value)} disabled placeholder="在画布左侧连接该资源" /></Form.Item>;
        return <Form.Item key={param.fieldKey} label={labelWithPort(runningHubParamLabel(param), param.fieldKey, pType)}><Input value={String(value)} onChange={e => change(param.fieldKey, e.target.value)} /></Form.Item>;
      })}
    </Form>;
  };
  return <aside className="config-panel workspace-panel" style={{ position: 'absolute', right: 0, top: 40, width: 370, height: 'calc(100vh - 40px)', background: 'var(--theme-panel)', borderLeft: '1px solid var(--theme-border)', zIndex: 15, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
    <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--theme-border)', display: 'flex', alignItems: 'center', gap: 8 }}><strong style={{ flex: 1, color: 'var(--theme-text)' }}>{node.data.label}</strong><Tag color={node.data.status === 'running' ? 'blue' : node.data.status === 'error' ? 'red' : 'default'}>{node.data.status}</Tag><Button type="text" icon={<MessageOutlined />} title="与 AI 对话（带节点及上游上下文）" onClick={() => { setChatOpen(true); setChatMsgs(m => m.length ? m : [{ role: 'ai', text: '已读取当前节点及上游节点上下文，想让我帮你做什么？' }]); }} /><Button type="text" icon={<CloseOutlined />} onClick={() => setSelected(null)} /></div>
    <div className="config-panel__body" style={{ padding: '10px 14px', overflow: 'auto' }}><div className="config-action-bar"><Button type="primary" size="small" icon={<PlayCircleOutlined />} onClick={() => void execute(node.id)}>执行</Button><Button size="small" icon={<ThunderboltOutlined />} onClick={() => void executeFrom(node.id)}>从此执行</Button><span className="config-action-bar__hint">修改后可直接重跑</span></div>
      {servers.length > 0 && <div className="config-server-section" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="config-section-label">服务器</span>
        <Select size="small" style={{ flex: 1 }} value={String(node.data.serverId || '')} onChange={v => updateNodeData(node.id, { serverId: v || undefined })}
          options={[{ label: '跟随默认', value: '' }, ...servers.map(s => ({ label: s.name, value: s.id }))]} />
      </div>}
      <div className="config-parameters-section"><div className="config-section-heading">参数 <small>核心设置</small></div>{['paidTextToImage','paidImageToImage','paidTextToVideo','paidImageToVideo','paidCapability'].includes(String(nodeType)) ? renderPaid() : nodeType === 'localWorkflow' ? renderLocalWorkflow() : nodeType === 'apiNode' ? renderApi() : nodeType === 'runningHubWorkflow' ? renderRunningHub() : renderBasic()}</div></div>
      <Modal title={`与 AI 对话 · ${node.data.label}`} open={chatOpen} onCancel={() => setChatOpen(false)} footer={null} width={480} destroyOnClose={false}>
        <div style={{ maxHeight: 340, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          {chatMsgs.map((m, i) => (
            <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '90%', padding: '6px 10px', borderRadius: 10, fontSize: 12, lineHeight: 1.6, background: m.role === 'user' ? 'rgba(99,102,241,.25)' : 'rgba(255,255,255,.08)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.text}</div>
          ))}
          {chatBusy && <div style={{ fontSize: 11, color: 'var(--theme-muted)' }}>正在思考…</div>}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Input.TextArea value={chatInput} onChange={e => setChatInput(e.target.value)} onPressEnter={e => { if (!e.shiftKey) { e.preventDefault(); void sendNodeChat(chatInput); } }} placeholder="问点什么…（Enter 发送，Shift+Enter 换行）" autoSize={{ minRows: 1, maxRows: 3 }} style={{ flex: 1 }} />
          <Button type="primary" disabled={chatBusy || !chatInput.trim()} onClick={() => void sendNodeChat(chatInput)}>发送</Button>
        </div>
      </Modal>
  </aside>;
};

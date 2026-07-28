import React, { useEffect, useState } from 'react';
import { Button, Form, Input, InputNumber, Space, Tag, Select, Switch, App } from 'antd';
import { CloseOutlined, PlayCircleOutlined, ThunderboltOutlined, SettingOutlined } from '@ant-design/icons';
import { useCanvasStore } from '@/stores/canvasStore';
import { fetchWorkflows, type ServerWorkflow } from '@/services/comfyui.service';
import { getApiNodeFormFields } from '@/config/apiNodes';
import { PromptActions } from '@/components/PromptActions';
import { promptKindForNode } from '@/services/promptOptimizer.service';

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
  const execute = useCanvasStore(s => s.executeNode);
  const executeFrom = useCanvasStore(s => s.executeFromNode);
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [workflows, setWorkflows] = useState<ServerWorkflow[]>([]);
  const node = nodes.find(item => item.id === sid);
  const config = node?.data.config || {};
  const nodeType = node?.data.nodeType;

  useEffect(() => { fetchWorkflows().then(setWorkflows).catch(() => setWorkflows([])); }, [node?.id]);
  useEffect(() => { if (node) form.setFieldsValue(node.data.config); }, [node?.id, node?.data.updatedAt, form]);
  if (!node) return null;

  const change = (key: string, value: unknown) => { setConfig(node.id, { ...config, [key]: value }); form.setFieldValue(key, value); };
  const isSeed = (name: string) => /(?:^|_)(?:seed|noise_seed|random_seed)$/i.test(name);
  const renderNumber = (key: string, label: string, value: unknown, fieldName = key) => <div key={key} style={{ marginBottom: 10 }}><div style={{ color: '#999', fontSize: 11, marginBottom: 3 }}>{label}</div><Space.Compact style={{ width: '100%' }}><InputNumber style={{ width: isSeed(fieldName) ? 'calc(100% - 58px)' : '100%' }} value={value === '' || value == null ? null : Number(value)} onChange={v => change(key, v)} />{isSeed(fieldName) && <Button onClick={() => change(key, randomSeedLike(value))}>随机</Button>}</Space.Compact></div>;
  const renderApi = () => {
    const fields = (config._apiFields as Array<any>) || [];
    if (!fields.length) return <div style={{ color: '#999', fontSize: 12 }}>当前节点没有可用的服务器参数，请重新从节点库添加。</div>;
    const render = (field: any) => {
      const value = config[field.key] ?? field.value ?? '';
      if (field.fileType) return <Form.Item key={field.key} label={field.label}><Input value={String(value)} onChange={e => change(field.key, e.target.value)} placeholder={`输入或连接${field.fileType}资源`} /></Form.Item>;
      if (field.type === 'boolean') return <Form.Item key={field.key} label={field.label}><Switch checked={Boolean(value)} onChange={v => change(field.key, v)} /></Form.Item>;
      if (field.type === 'number') return renderNumber(field.key, field.label, value, field.field || field.key);
      if (field.type === 'select' && field.options) return <Form.Item key={field.key} label={field.label}><Select style={{ width: '100%' }} value={String(value)} options={field.options} onChange={v => change(field.key, v)} /></Form.Item>;
      const long = /text|prompt|negative|positive|script|description|system/i.test(field.field || field.key);
      return <Form.Item key={field.key} label={<span style={{ display: 'flex', justifyContent: 'space-between' }}>{field.label}{long && <PromptActions nodeId={node.id} value={String(value)} kind={promptKindForNode(nodeType)} fieldKey={field.key} onChange={v => change(field.key, v)} />}</span>}>{long ? <Input.TextArea value={String(value)} autoSize={{ minRows: 3, maxRows: 10 }} onChange={e => change(field.key, e.target.value)} /> : <Input value={String(value)} onChange={e => change(field.key, e.target.value)} />}</Form.Item>;
    };
    return <><Tag color="purple" style={{ marginBottom: 10 }}>{String(config.workflow_id || config._apiName || '服务器工作流')}</Tag>{fields.map(render)}</>;
  };
  const renderBasic = () => <Form form={form} layout="vertical" onValuesChange={(_, all) => setConfig(node.id, { ...config, ...all })}>{nodeType === 'textInput' && <Form.Item name="text" label="文本内容"><Input.TextArea autoSize={{ minRows: 3, maxRows: 10 }} /></Form.Item>}{nodeType === 'scriptInput' && <Form.Item name="scripts" label="剧本数据"><Input.TextArea value={JSON.stringify(config.scripts || [], null, 2)} onChange={e => { try { change('scripts', JSON.parse(e.target.value)); } catch {} }} autoSize={{ minRows: 5, maxRows: 12 }} /></Form.Item>}{nodeType === 'sceneSettings' && <Form.Item name="settings" label="场景设定"><Input.TextArea autoSize={{ minRows: 4, maxRows: 12 }} /></Form.Item>}{!['textInput','scriptInput','sceneSettings'].includes(String(nodeType)) && <div style={{ color: '#999', fontSize: 12 }}>此为通用工具节点，参数由节点自身处理。</div>}</Form>;
  return <aside className="config-panel" style={{ position: 'absolute', right: 0, top: 40, width: 370, height: 'calc(100vh - 40px)', background: '#16162a', borderLeft: '1px solid #2a2a3e', zIndex: 15, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
    <div style={{ padding: '10px 14px', borderBottom: '1px solid #2a2a3e', display: 'flex', alignItems: 'center', gap: 8 }}><strong style={{ flex: 1, color: '#e0e0f0' }}>{node.data.label}</strong><Tag color={node.data.status === 'running' ? 'blue' : node.data.status === 'error' ? 'red' : 'default'}>{node.data.status}</Tag><Button type="text" icon={<CloseOutlined />} onClick={() => setSelected(null)} /></div>
    <div style={{ padding: '10px 14px', overflow: 'auto' }}><Space style={{ marginBottom: 10 }}><Button type="primary" size="small" icon={<PlayCircleOutlined />} onClick={() => void execute(node.id)}>执行</Button><Button size="small" icon={<ThunderboltOutlined />} onClick={() => void executeFrom(node.id)}>从此执行</Button></Space>{nodeType === 'apiNode' ? renderApi() : renderBasic()}</div>
  </aside>;
};

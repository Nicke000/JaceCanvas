import React, { useState } from 'react';
import { Button, Space, Tooltip, message } from 'antd';
import { TranslationOutlined, ThunderboltOutlined, BulbOutlined } from '@ant-design/icons';
import { Dropdown } from 'antd';
import { optimizePrompt, type PromptKind, type PromptAction } from '@/services/promptOptimizer.service';
import { useCanvasStore } from '@/stores/canvasStore';

export function syncPromptToSources(nodeId: string, text: string) {
  const store = useCanvasStore.getState();
  const incoming = store.edges.filter(edge => edge.target === nodeId);
  for (const edge of incoming) {
    const source = store.nodes.find(node => node.id === edge.source);
    if (!source) continue;
    if (source.data.nodeType === 'textInput') {
      store.setNodeConfig(source.id, { text });
      store.propagateData(source.id, 'text', text);
    } else if (source.data.nodeType === 'scriptInput') {
      const scripts = (source.data.config.scripts as Array<{ id: string; label: string; text: string }> || []);
      if (scripts.length) {
        const next = scripts.map((item, index) => index === 0 ? { ...item, text } : item);
        store.setNodeConfig(source.id, { scripts: next });
        store.propagateData(source.id, `script-${next[0].id}`, text);
      }
    }
  }
}

export const PromptActions: React.FC<{ nodeId: string; value: string; kind: PromptKind; fieldKey?: string; imageContext?: string[]; onChange: (value: string) => void }> = ({ nodeId, value, kind, fieldKey = 'prompt', imageContext, onChange }) => {
  const [busy, setBusy] = useState<PromptAction | null>(null);
  const run = async (action: PromptAction) => {
    if (!value.trim()) { message.warning('请先输入提示词'); return; }
    setBusy(action);
    try {
      const result = await optimizePrompt({ text: value, action, kind, imageContext });
      onChange(result);
      const store = useCanvasStore.getState();
      store.setNodeConfig(nodeId, { [fieldKey]: result });
      syncPromptToSources(nodeId, result);
      message.success(action === 'optimize' ? '提示词已优化并同步' : '提示词已翻译并同步');
    } catch (error) { message.error(error instanceof Error ? error.message : '提示词处理失败'); }
    finally { setBusy(null); }
  };
  return <Space size={2}>
    <Tooltip title="使用已配置的提示词 AI 优化"><Button size="small" type="text" loading={busy === 'optimize'} icon={<ThunderboltOutlined/>} onClick={() => void run('optimize')}>优化</Button></Tooltip>
    <Tooltip title="翻译为英文提示词"><Button size="small" type="text" loading={busy === 'translate'} icon={<TranslationOutlined/>} onClick={() => void run('translate')}>翻译</Button></Tooltip>
    <Dropdown menu={{ items: [
      { key: 'continue', label: '续写', onClick: () => void run('continue') },
      { key: 'expand', label: '扩写', onClick: () => void run('expand') },
      { key: 'summarize', label: '总结', onClick: () => void run('summarize') },
    ] }}>
      <Tooltip title="AI 文本操作（续写/扩写/润色/总结）"><Button size="small" type="text" loading={!!busy && busy !== 'optimize' && busy !== 'translate'} icon={<BulbOutlined/>}>AI</Button></Tooltip>
    </Dropdown>
  </Space>;
};
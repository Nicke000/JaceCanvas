import React, { useState } from 'react';
import { Button, Space, Tooltip, message } from 'antd';
import { TranslationOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { optimizePrompt, type PromptKind } from '@/services/promptOptimizer.service';
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
  const [busy, setBusy] = useState<'optimize' | 'translate' | null>(null);
  const run = async (action: 'optimize' | 'translate') => {
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
  </Space>;
};
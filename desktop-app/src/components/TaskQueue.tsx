import React from 'react';
import { Button, Empty, Progress, Tooltip } from 'antd';
import { CloseOutlined, DeleteOutlined, PauseOutlined, PlayCircleOutlined, VerticalAlignTopOutlined, VerticalAlignBottomOutlined, FieldTimeOutlined } from '@ant-design/icons';
import { useCanvasStore } from '@/stores/canvasStore';
import type { NodeStatus } from '@/types';

interface TaskQueueProps { open: boolean; onClose: () => void; onToggle: () => void; embedded?: boolean; }

const statusText: Record<NodeStatus, string> = { idle: '等待', queued: '排队中', running: '执行中', paused: '已暂停', success: '完成', error: '失败' };

export const TaskQueue: React.FC<TaskQueueProps> = ({ open, onClose, onToggle, embedded = false }) => {
  const nodes = useCanvasStore(s => s.nodes);
  const pauseNode = useCanvasStore(s => s.pauseNode);
  const enqueueNode = useCanvasStore(s => s.enqueueNode);
  const setNodeStatus = useCanvasStore(s => s.setNodeStatus);
  const queued = nodes.filter(node => node.data.status === 'queued' || (node.data.status === 'idle' && node.data.queuedAt)).sort((a, b) => Number(a.data.queueOrder || 0) - Number(b.data.queueOrder || 0));
  const active = nodes.filter(node => ['running', 'paused'].includes(node.data.status || 'idle') && (node.data.status === 'running' || node.data.queuedAt));
  const tasks = [...active, ...queued];
  const busyCount = active.filter(n => n.data.status === 'running').length + queued.length;
  const reorder = (id: string, direction: -1 | 1) => {
    const index = queued.findIndex(node => node.id === id); const next = queued[index + direction];
    if (!next) return;
    const currentOrder = Number(queued[index].data.queueOrder || index); const nextOrder = Number(next.data.queueOrder || index + direction);
    useCanvasStore.getState().updateNodeData(id, { queueOrder: nextOrder });
    useCanvasStore.getState().updateNodeData(next.id, { queueOrder: currentOrder });
  };
  const remove = (id: string) => {
    pauseNode(id);
    setNodeStatus(id, 'idle');
    useCanvasStore.getState().updateNodeData(id, { queuedAt: undefined, queueOrder: undefined, content: '已从本地队列移除' });
  };
  return <>
    {!embedded && <Tooltip title="运行中心：查看队列、生成历史与任务状态"><Button className="task-queue-fab" onClick={onToggle}><FieldTimeOutlined /> 运行中心{busyCount > 0 && <em>{busyCount}</em>}</Button></Tooltip>}
    {open && <aside className={embedded ? 'task-queue-panel task-queue-panel--embedded' : 'task-queue-panel'}>
    <header><div><b>运行中心</b><small>{active.filter(node => node.data.status === 'running').length} 执行中 · {queued.length} 排队</small></div><div className="task-queue-panel__header-actions"><Button type="text" size="small" onClick={() => window.dispatchEvent(new Event('ai-canvas-open-history'))}>生成历史</Button><Button type="text" icon={<CloseOutlined />} onClick={onClose} /></div></header>
    <div className="task-queue-panel__hint">单 GPU 模式：排队任务不会提前提交到 ComfyUI。</div>
    <section>{tasks.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无执行任务" /> : tasks.map((node, index) => {
      const status = node.data.status || 'idle'; const percent = Math.max(0, Math.min(100, Number(node.data.progress || 0)));
      return <div className={`task-queue-item task-queue-item--${status}`} key={node.id}>
        <div className="task-queue-item__main"><span className="task-queue-item__dot" /><div><b>{node.data.label}</b><small>{statusText[status]}{node.data.error ? ` · ${node.data.error}` : ''}</small></div></div>
        {status === 'running' && <Progress percent={percent} size="small" showInfo={false} strokeColor="var(--theme-primary)" />}
        <div className="task-queue-item__actions">
          {status === 'running' && <Tooltip title="暂停/取消"><Button type="text" size="small" icon={<PauseOutlined />} onClick={() => pauseNode(node.id)} /></Tooltip>}
          {status === 'paused' && <Tooltip title="重新加入队列"><Button type="text" size="small" icon={<PlayCircleOutlined />} onClick={() => { useCanvasStore.getState().updateNodeData(node.id, { queuedAt: Date.now(), queueOrder: Date.now(), status: 'queued' }); }} /></Tooltip>}
          {(status === 'queued' || status === 'idle') && <><Tooltip title="上移"><Button type="text" size="small" icon={<VerticalAlignTopOutlined />} onClick={() => reorder(node.id, -1)} /></Tooltip><Tooltip title="下移"><Button type="text" size="small" icon={<VerticalAlignBottomOutlined />} onClick={() => reorder(node.id, 1)} /></Tooltip><Tooltip title="重新排队"><Button type="text" size="small" icon={<PlayCircleOutlined />} onClick={() => enqueueNode(node.id)} /></Tooltip></>}
          <Tooltip title="删除"><Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => remove(node.id)} /></Tooltip>
        </div>
      </div>;
    })}</section>
    </aside>}
  </>;
};
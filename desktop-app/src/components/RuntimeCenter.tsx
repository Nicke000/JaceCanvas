import React, { useState } from 'react';
import { Button } from 'antd';
import { CloseOutlined, FieldTimeOutlined, HistoryOutlined, DashboardOutlined } from '@ant-design/icons';
import { TaskQueue } from '@/components/TaskQueue';
import { GenerationHistory } from '@/components/GenerationHistory';
import { PerformanceBar } from '@/components/PerformanceBar';

type RuntimeTab = 'queue' | 'history' | 'performance';

interface RuntimeCenterProps {
  open: boolean;
  tab: RuntimeTab;
  onTabChange: (tab: RuntimeTab) => void;
  onClose: () => void;
  onHistoryHeightChange?: (height: number) => void;
}

export const RuntimeCenter: React.FC<RuntimeCenterProps> = ({ open, tab, onTabChange, onClose, onHistoryHeightChange }) => {
  if (!open) return <Button className="runtime-center-fab" icon={<FieldTimeOutlined />} onClick={() => window.dispatchEvent(new Event('ai-canvas-open-runtime-center'))}>运行中心</Button>;
  return <aside className="runtime-center" aria-label="运行中心">
    <header className="runtime-center__header">
      <div className="runtime-center__title"><FieldTimeOutlined /><strong>运行中心</strong><span>任务、历史与性能</span></div>
      <Button type="text" icon={<CloseOutlined />} onClick={onClose} aria-label="关闭运行中心" />
    </header>
    <nav className="runtime-center__tabs" aria-label="运行中心视图">
      <button className={tab === 'queue' ? 'is-active' : ''} onClick={() => onTabChange('queue')}><FieldTimeOutlined />队列</button>
      <button className={tab === 'history' ? 'is-active' : ''} onClick={() => onTabChange('history')}><HistoryOutlined />生成历史</button>
      <button className={tab === 'performance' ? 'is-active' : ''} onClick={() => onTabChange('performance')}><DashboardOutlined />性能</button>
    </nav>
    <div className="runtime-center__body">
      {tab === 'queue' && <TaskQueue open onClose={onClose} onToggle={() => undefined} embedded />}
      {tab === 'history' && <GenerationHistory onOpenChange={() => undefined} onHeightChange={onHistoryHeightChange} embedded />}
      {tab === 'performance' && <PerformanceBar embedded />}
    </div>
  </aside>;
};

import React, { useEffect, useState } from 'react';
import { Button, ColorPicker, Divider, Popover, Space, Tooltip } from 'antd';
import { BgColorsOutlined, CheckOutlined } from '@ant-design/icons';
import { useThemeStore } from '@/stores/themeStore';

export const ThemeSelector: React.FC = () => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('ai-canvas-open-theme', show);
    return () => window.removeEventListener('ai-canvas-open-theme', show);
  }, []);
  const { themes, themeId, custom, setTheme, setCustom, resetCustom } = useThemeStore();
  const colorFields = [
    ['bg', '画布背景'], ['surface', '顶部/卡片'], ['panel', '侧栏/节点'], ['input', '输入框'],
    ['primary', '强调色'], ['border', '边框'], ['text', '主要文字'], ['muted', '辅助文字'], ['edge', '连线'],
  ] as const;
  const content = <div className="theme-selector">
    <div className="theme-selector__heading"><strong>界面主题</strong><small>主题会应用到画布、节点、侧栏、弹窗和控件</small></div>
    <div className="theme-selector__grid">
      {themes.map(item => <button key={item.id} className={`theme-card ${themeId === item.id ? 'is-active' : ''}`} onClick={() => setTheme(item.id)}>
        <i className="theme-card__preview" style={{ background: item.colors.bg, borderColor: item.colors.border }}><b style={{ background: item.colors.primary }} /><em style={{ background: item.colors.edge }} /></i>
        <span>{item.name}</span>
        {themeId === item.id && <CheckOutlined />}
      </button>)}
    </div>
    <Divider plain>自定义完整颜色</Divider>
    <div className="theme-color-grid">{colorFields.map(([key, label]) => <label key={key}><ColorPicker value={custom[key] || undefined} onChange={(_, hex) => setCustom(key, hex)} /><span>{label}</span></label>)}</div>
    <Space align="center" className="theme-selector__footer">
      <Button size="small" type="link" onClick={() => { setOpen(false); window.dispatchEvent(new Event('ai-canvas-open-appearance')); }}>完整外观设置 ›</Button>
      <Button size="small" type="link" onClick={resetCustom}>恢复当前主题默认颜色</Button>
    </Space>
  </div>;
  return <Popover open={open} onOpenChange={setOpen} trigger="click" content={content} placement="bottomRight">
    <Tooltip title="主题与颜色"><Button type="text" size="small" icon={<BgColorsOutlined />} className="app-topbar__tool">主题</Button></Tooltip>
  </Popover>;
};
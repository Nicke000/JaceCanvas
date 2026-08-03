import React from 'react';
import { Button, ColorPicker, Divider, Segmented, Slider, Switch, Tooltip } from 'antd';
import { CheckOutlined, ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useThemeStore } from '@/stores/themeStore';
import type { UIGridStyle, UIMotion, UIRadius, UIDensity, UIPreferences } from '@/stores/themeStore';

type UIFontScale = UIPreferences['fontScale'];

const colorFields = [
  ['bg', '画布背景'], ['surface', '顶部/卡片'], ['panel', '侧栏/节点'], ['input', '输入框'],
  ['primary', '强调色'], ['border', '边框'], ['text', '主要文字'], ['muted', '辅助文字'], ['edge', '连线'],
] as const;

const radiusOptions: Array<{ label: string; value: UIRadius }> = [
  { label: '圆润', value: 'small' }, { label: '标准', value: 'standard' }, { label: '大气', value: 'large' },
];
const densityOptions: Array<{ label: string; value: UIDensity }> = [
  { label: '舒适', value: 'cozy' }, { label: '紧凑', value: 'compact' },
];
const motionOptions: Array<{ label: string; value: UIMotion }> = [
  { label: '完整动画', value: 'full' }, { label: '减弱动画', value: 'reduced' },
];
const fontScaleOptions = [
  { label: '小', value: 'small' }, { label: '标准', value: 'standard' }, { label: '大', value: 'large' },
];
const gridStyleOptions: Array<{ label: string; value: UIGridStyle }> = [
  { label: '圆点', value: 'dots' }, { label: '网格线', value: 'lines' }, { label: '十字', value: 'cross' },
];

/**
 * 4.6.8 外观设置中心：主题配色 + 界面偏好，全部实时生效并自动保存。
 * 它不依赖设置弹窗的 Form，避免把外观偏好混入 API 设置。
 */
export const AppearanceSettings: React.FC = () => {
  const { themes, themeId, custom, setTheme, setCustom, resetCustom, preferences, setPreference, resetPreferences } = useThemeStore();
  return <div className="appearance-settings">
    <div className="appearance-settings__hint"><ThunderboltOutlined /> 所有外观调整都会<b>实时生效</b>并自动保存，无需点击保存按钮。</div>

    <h4 className="settings-tab-title">主题配色</h4>
    <div className="appearance-theme-grid">
      {themes.map(item => (
        <button key={item.id} type="button" className={`appearance-theme-card ${themeId === item.id ? 'is-active' : ''}`} onClick={() => setTheme(item.id)}>
          <i className="appearance-theme-card__preview" style={{ background: item.colors.bg, borderColor: item.colors.border }}>
            <b style={{ background: item.colors.primary }} />
            <em style={{ background: item.colors.edge }} />
          </i>
          <span>{item.name}</span>
          {themeId === item.id && <CheckOutlined />}
        </button>
      ))}
    </div>

    <Divider plain className="appearance-settings__divider">自定义完整颜色</Divider>
    <div className="theme-color-grid appearance-settings__colors">
      {colorFields.map(([key, label]) => (
        <label key={key}><ColorPicker value={custom[key] || undefined} onChange={(_, hex) => setCustom(key, hex)} /><span>{label}</span></label>
      ))}
    </div>
    <Button size="small" type="link" icon={<ReloadOutlined />} onClick={resetCustom}>恢复当前主题默认颜色</Button>

    <Divider plain className="appearance-settings__divider">界面偏好</Divider>
    <div className="appearance-prefs">
      <div className="appearance-pref-row">
        <span>圆角大小</span>
        <Segmented size="small" value={preferences.radius} onChange={value => setPreference({ radius: value as UIRadius })} options={radiusOptions} />
      </div>
      <div className="appearance-pref-row">
        <span>界面密度</span>
        <Segmented size="small" value={preferences.density} onChange={value => setPreference({ density: value as UIDensity })} options={densityOptions} />
      </div>
      <div className="appearance-pref-row">
        <span>动画效果</span>
        <Segmented size="small" value={preferences.motion} onChange={value => setPreference({ motion: value as UIMotion })} options={motionOptions} />
      </div>
      <div className="appearance-pref-row">
        <span>字体大小</span>
        <Segmented size="small" value={preferences.fontScale} onChange={value => setPreference({ fontScale: value as UIFontScale })} options={fontScaleOptions} />
      </div>
      <div className="appearance-pref-row">
        <span>画布网格</span>
        <Segmented size="small" value={preferences.gridStyle} onChange={value => setPreference({ gridStyle: value as UIGridStyle })} options={gridStyleOptions} />
      </div>
      <div className="appearance-pref-row">
        <span>毛玻璃效果 <small>面板半透明模糊</small></span>
        <Switch size="small" checked={preferences.glass} onChange={checked => setPreference({ glass: checked })} />
      </div>
      <div className="appearance-pref-row">
        <span>背景氛围光 <small>画布顶部渐变光晕</small></span>
        <Switch size="small" checked={preferences.ambient} onChange={checked => setPreference({ ambient: checked })} />
      </div>
      <div className="appearance-pref-row">
        <span>强调色强度</span>
        <Tooltip title={preferences.accentIntensity.toFixed(2)}>
          <Slider className="appearance-pref-slider" min={0.6} max={1.4} step={0.05} value={preferences.accentIntensity} onChange={value => setPreference({ accentIntensity: value })} />
        </Tooltip>
      </div>
    </div>
    <Button size="small" type="link" icon={<ReloadOutlined />} onClick={resetPreferences}>恢复全部外观默认</Button>
  </div>;
};

import React, { useEffect, useMemo, useState } from 'react';
import { Button, Input, Select, Space, Tag, message } from 'antd';
import { ApiOutlined, CheckCircleOutlined, KeyOutlined, SaveOutlined } from '@ant-design/icons';
import { PAID_API_ADAPTERS, PAID_PROVIDER_IDS, type PaidProviderId } from '@/config/paidApiAdapters';
import { useSettingsStore } from '@/stores/settingsStore';

export const PaidApiSettings: React.FC = () => {
  const settings = useSettingsStore();
  const [provider, setProvider] = useState<PaidProviderId>('bailian');
  const adapter = PAID_API_ADAPTERS[provider];
  const current = settings.paidApiProviders?.[provider] || { provider, apiKey: '', baseUrl: '', models: [] };
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [region, setRegion] = useState('cn-beijing');
  const [workspaceId, setWorkspaceId] = useState('');

  useEffect(() => {
    setApiKey(current.apiKey || '');
    setBaseUrl(current.baseUrl || adapter.defaultBaseUrl);
    setRegion(current.region || 'cn-beijing');
    setWorkspaceId(current.workspaceId || '');
  }, [provider, current.apiKey, current.baseUrl, current.region, current.workspaceId, adapter.defaultBaseUrl]);

  const saveProvider = () => {
    settings.setPaidApiProvider(provider, {
      apiKey: apiKey.trim(),
      baseUrl: baseUrl.trim() || adapter.defaultBaseUrl,
      region: region as any,
      workspaceId: workspaceId.trim(),
      models: adapter.models.map(item => item.id),
      selectedModel: current.selectedModel || adapter.models[0]?.id || '',
    });
    message.success(`${adapter.label} 配置已保存`);
  };

  return <div className="paid-api-settings">
    <div className="settings-section-hint">这里只管理厂商凭据和厂商专属资源。节点中的厂商、模型和输入参数由节点自身决定；没有官方节点适配的厂商不会出现在这里。</div>
    <div className="paid-api-vendor-tabs">
      {PAID_PROVIDER_IDS.map(id => {
        const item = PAID_API_ADAPTERS[id];
        const configured = Boolean(settings.paidApiProviders?.[id]?.apiKey);
        return <button key={id} className={provider === id ? 'is-active' : ''} onClick={() => setProvider(id)}>
          <span className="paid-api-vendor-tabs__icon">{item.shortLabel.slice(0, 1)}</span>
          <span>{item.shortLabel}</span>{configured && <CheckCircleOutlined className="paid-api-vendor-tabs__ok" />}
        </button>;
      })}
    </div>
    <div className="paid-api-provider-card">
      <div className="paid-api-provider-card__header"><div><h4>{adapter.label}</h4><p>{adapter.description}</p></div><Tag color={apiKey ? 'green' : 'default'}>{apiKey ? '已配置' : '未配置'}</Tag></div>
      <div className="settings-form-grid">
        <div><label className="paid-api-field-label"><KeyOutlined /> API Key</label><Input.Password value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="填写该厂商自己的 API Key" /></div>
        <div><label className="paid-api-field-label"><ApiOutlined /> 认证方式</label><Input value={adapter.authMode === 'query-key' ? 'Query 参数 key' : 'Authorization Bearer'} disabled /></div>
      </div>
      <div className="paid-api-field"><label className="paid-api-field-label">接口地址</label><Input value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder={adapter.defaultBaseUrl} /></div>
      {adapter.regions && <div className="settings-form-grid"><div><label className="paid-api-field-label">地域</label><Select value={region} onChange={setRegion} options={adapter.regions.map(item => ({ value:item.value, label:item.label }))} style={{ width:'100%' }} /></div><div><label className="paid-api-field-label">Workspace ID（可选）</label><Input value={workspaceId} onChange={event => setWorkspaceId(event.target.value)} placeholder="百炼业务空间 ID" /></div></div>}
      <div className="paid-api-model-summary"><strong>节点可用模型</strong><div>{adapter.models.map(model => <Tag key={model.id}>{model.label}</Tag>)}</div></div>
      <Space style={{ marginTop:16 }}><Button type="primary" icon={<SaveOutlined />} onClick={saveProvider}>保存 {adapter.shortLabel} 配置</Button><span className="settings-section-hint">切换厂商不会清除其他厂商已保存的配置。</span></Space>
    </div>
  </div>;
};
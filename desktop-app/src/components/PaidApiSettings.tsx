import React, { useEffect, useMemo, useState } from 'react';
import { Button, Input, Select, Space, Tag, message } from 'antd';
import { ApiOutlined, CheckCircleOutlined, KeyOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { PAID_API_ADAPTERS, PAID_PROVIDER_IDS, type PaidProviderId } from '@/config/paidApiAdapters';
import { useSettingsStore } from '@/stores/settingsStore';
import { testPaidConnection, fetchPaidModels as fetchPaidModelsFromApi } from '@/services/paidApi.service';

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
    if (!apiKey.trim()) { message.warning('请填写 API 密钥后再保存'); return; }
    settings.setPaidApiProvider(provider, {
      apiKey: apiKey.replace(/\s+/g, ''),
      baseUrl: baseUrl.trim() || adapter.defaultBaseUrl,
      region: region as any,
      workspaceId: workspaceId.trim(),
      models: liveModels.length ? liveModels : adapter.models.map(item => item.id),
      selectedModel: (liveModels.length && current.selectedModel && liveModels.includes(current.selectedModel)) ? current.selectedModel : (liveModels[0] || current.selectedModel || adapter.models[0]?.id || ''),
    });
    message.success(`${adapter.label} 配置已保存`);
  };
  const [testing, setTesting] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  const [liveModels, setLiveModels] = useState<string[]>([]);
  const handleTest = async () => {
    if (!apiKey.trim()) { message.warning('请先填写 API Key'); return; }
    setTesting(true); setTestMsg(null);
    try {
      const r = await testPaidConnection({ provider, baseUrl: baseUrl.trim() || adapter.defaultBaseUrl, apiKey: apiKey.trim(), model: adapter.models[0]?.id || '' });
      setTestMsg({ ok: r.ok, msg: r.message });
    } catch (e: any) { setTestMsg({ ok: false, msg: e.message || '连接失败' }); }
    finally { setTesting(false); }
  };
  const handleFetchModels = async () => {
    if (!apiKey.trim()) { message.warning('请先填写 API Key'); return; }
    setFetchingModels(true);
    try {
      const list = await fetchPaidModelsFromApi(provider, baseUrl.trim() || adapter.defaultBaseUrl, apiKey.trim(), { authMode: adapter.authMode });
      setLiveModels(list || []);
      if (!list?.length) message.info('未拉取到模型列表（可能无需拉取或路径不同）');
      else {
        // 当前所选模型不在新列表（已下线/改名）→ 自动切换到列表第一个并保存，避免节点执行 404
        const curModel = settings.paidApiProviders?.[provider]?.selectedModel || '';
        if (curModel && list.length && !list.includes(curModel)) {
          settings.setPaidApiProvider(provider, { ...settings.paidApiProviders[provider], models: list, selectedModel: list[0] });
          message.warning(`所选模型「${curModel}」已不在列表，已自动切换为「${list[0]}」（可在下方重新选择）`);
        } else message.success(`拉取到 ${list.length} 个模型`);
      }
    } catch (e: any) { message.error('拉取模型失败：' + (e.message || e)); }
    finally { setFetchingModels(false); }
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
      <Space style={{ marginTop:16 }} wrap><Button type="primary" icon={<SaveOutlined />} onClick={saveProvider}>保存 {adapter.shortLabel} 配置</Button><Button icon={<ApiOutlined />} loading={testing} onClick={() => void handleTest()}>测试连接</Button><Button icon={<ReloadOutlined />} loading={fetchingModels} onClick={() => void handleFetchModels()}>拉取模型</Button></Space>
      <div className="settings-section-hint" style={{ marginTop: 8, fontSize: 11 }}>切换厂商不会清除其他厂商已保存的配置。</div>
      {testMsg && <div style={{ marginTop: 10, fontSize: 11, color: testMsg.ok ? 'var(--theme-success)' : 'var(--theme-error)', background: 'var(--theme-input)', border: '1px solid var(--theme-border)', borderRadius: 6, padding: '6px 10px' }}>{testMsg.ok ? '✓ 连接成功：' : '✗ 连接失败：'}{testMsg.msg}</div>}
      {liveModels.length > 0 && <div style={{ marginTop: 10 }}><strong style={{ fontSize: 11 }}>实时模型列表（{liveModels.length}）</strong><div style={{ marginTop: 6 }}>{liveModels.map(m => <Tag key={m} style={{ marginBottom: 4 }}>{m}</Tag>)}</div></div>}
    </div>
  </div>;
};
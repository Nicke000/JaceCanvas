import React, { useEffect, useState } from 'react';
import { Modal, Form, Input, InputNumber, Button, Space, Divider, message, Select, Switch, Tag } from 'antd';
import { SettingOutlined, ApiOutlined, CheckCircleOutlined, CloseCircleOutlined, GithubOutlined, QqOutlined, RobotOutlined, CodeOutlined, KeyOutlined, LinkOutlined, ThunderboltOutlined, InfoCircleOutlined, BgColorsOutlined, PlusOutlined, WarningOutlined, ReloadOutlined, FolderOpenOutlined, CopyOutlined } from '@ant-design/icons';
import { useSettingsStore, PAID_API_NODE_KINDS, parseSshCommand, type PaidApiProfile, type PaidApiNodeKind, type ServerProfile } from '@/stores/settingsStore';
import { testConnection, getModels } from '@/services/comfyui.service';
import { fetchModelsFromApi } from '@/services/chat.service';
import { fetchPaidModels as fetchPaidModelsFromApi, testPaidConnection } from '@/services/paidApi.service';
import { BAILIAN_REGION_OPTIONS, callBailianTextToImage } from '@/services/bailianTextToImage.service';
import { PAID_CAPABILITIES, type PaidCapability } from '@/services/paidApi.service';
import { getPaidModelsForCapability, getSupportedPaidCapabilities, PAID_CAPABILITY_LABELS } from '@/config/paidCapabilityCatalog';
import { DEFAULT_STORYBOARD_SYSTEM_PROMPT } from '@/services/storyboard.service';
import { SYSTEM_PROMPTS } from '@/services/promptOptimizer.service';
import { APP_VERSION } from '@/config/appVersion';
import { PaidApiSettings } from '@/components/PaidApiSettings';
import { LogTab } from './LogTab';
import { AppearanceSettings } from '@/components/AppearanceSettings';

const providerOptions = [
  { label: 'OpenAI 兼容接口', value: 'openai' },
  { label: 'Google Gemini', value: 'gemini' },
  { label: 'Anthropic Claude', value: 'anthropic' },
  { label: 'Ollama / 本地模型', value: 'ollama' },
];

const paidProviderOptions = [
  { label: '通用任务网关（文档模板）', value: 'gateway' },
  { label: '快手·可灵 (Kling)', value: 'kling' },
  { label: '字节·即梦 (Jimeng)', value: 'jimeng' },
  { label: '阿里·通义万相', value: 'tongyi' },
  { label: '智谱·清影 (Zhipu)', value: 'zhipu' },
  { label: 'MiniMax·海螺AI', value: 'minimax' },
  { label: '百度·文心', value: 'baidu' },
  { label: 'Runway Gen-3', value: 'runway' },
  { label: 'OpenAI (Sora/DALL-E)', value: 'openai' },
  { label: 'Google (Veo/Imagen)', value: 'google' },
  { label: 'Pika Labs', value: 'pika' },
  { label: 'Luma Dream Machine', value: 'luma' },
  { label: 'Midjourney代理', value: 'midjourney' },
  { label: 'Stability AI', value: 'stability' },
  { label: '自定义接口', value: 'custom' },
];

const thinkingModeOptions = [
  { label: '自动（默认）', value: 'auto' },
  { label: '快速模式', value: 'fast' },
  { label: '深度思考', value: 'deep' },
];

type SettingTab = 'connection' | 'chat' | 'devagent' | 'optimizer' | 'paidapi' | 'performance' | 'appearance' | 'log' | 'about';
export const SettingsButton: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connection, setConnection] = useState<{ ok: boolean; message: string } | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [linkTest, setLinkTest] = useState<{ label: string; ok: boolean; message: string }[]>([]);
  const [fetchedChatModels, setFetchedChatModels] = useState<string[]>([]);
  const [fetchedOptimizerModels, setFetchedOptimizerModels] = useState<string[]>([]);
  const [fetchedPaidModels, setFetchedPaidModels] = useState<string[]>([]);
  const [fetchingChat, setFetchingChat] = useState(false);
  const [fetchedDevAgentModels, setFetchedDevAgentModels] = useState<string[]>([]);
  const [fetchingDevAgent, setFetchingDevAgent] = useState(false);
  const [fetchingOptimizer, setFetchingOptimizer] = useState(false);
  const [fetchingPaid, setFetchingPaid] = useState(false);
  const [testingChat, setTestingChat] = useState(false);
  const [testingOptimizer, setTestingOptimizer] = useState(false);
  const [testingPaid, setTestingPaid] = useState(false);
  const [testingBailian, setTestingBailian] = useState(false);
  const [bailianTestResult, setBailianTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [paidNodeModels, setPaidNodeModels] = useState<Record<string, string[]>>({});
  const [paidNodeBusy, setPaidNodeBusy] = useState<Record<string, boolean>>({});
  const [paidNodeResults, setPaidNodeResults] = useState<Record<string, { ok: boolean; message: string } | null>>({});
  // 多服务器管理
  const servers = useSettingsStore(s => s.servers);
  const activeServerId = useSettingsStore(s => s.activeServerId);
  const setActiveServer = useSettingsStore(s => s.setActiveServer);
  const upsertServer = useSettingsStore(s => s.upsertServer);
  const removeServer = useSettingsStore(s => s.removeServer);
  const [serverEditorOpen, setServerEditorOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<ServerProfile | null>(null);
  const [serverTest, setServerTest] = useState<Record<string, { ok: boolean; loading?: boolean } | undefined>>({});
  const [serverForm] = Form.useForm();

  const openServerEditor = (server: ServerProfile | null) => {
    setEditingServer(server);
    serverForm.setFieldsValue(server ? { name: server.name, baseUrl: server.baseUrl, apiKey: server.apiKey, type: server.type || 'comfyui', perfUrl: server.perfUrl || '' } : { name: '', baseUrl: '', apiKey: '', type: 'comfyui', perfUrl: '' });
    setServerEditorOpen(true);
  };
  const saveServer = () => {
    serverForm.validateFields().then(values => {
      const id = editingServer?.id || `srv-${Date.now().toString(36)}`;
      upsertServer({ id, name: String(values.name || '未命名服务器'), baseUrl: String(values.baseUrl || '').replace(/\/+$/, ''), apiKey: String(values.apiKey || ''), type: String(values.type || 'comfyui') as ServerProfile['type'], perfUrl: String(values.perfUrl || '').replace(/\/+$/, '') || undefined });
      message.success(editingServer ? '服务器已更新' : '服务器已添加');
      setServerEditorOpen(false);
    }).catch(() => { /* 校验失败 */ });
  };
  const testServer = async (server: ServerProfile) => {
    if (!String(server.baseUrl || '').trim()) { message.warning('请先填写服务器地址'); return; }
    setServerTest(prev => ({ ...prev, [server.id]: { ok: false, loading: true } }));
    try {
      // 复用统一 testConnection：自动补协议 + /api/health 非 2xx 回退 /system_stats + proxy 绕 CORS。
      // 旧实现直接原生 fetch /api/health，ComfyUI 无此端点（404 常态）导致所有 ComfyUI 直连都误报失败。
      const result = await testConnection(server.id);
      setServerTest(prev => ({ ...prev, [server.id]: { ok: result.ok, loading: false } }));
      if (result.ok) message.success('连接正常：' + result.message);
      else message.error('连接失败：' + result.message);
    } catch (e) {
      setServerTest(prev => ({ ...prev, [server.id]: { ok: false, loading: false } }));
      message.error('连接失败：' + (e instanceof Error ? e.message : String(e)));
    }
  };
  const [chatTestResult, setChatTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [optimizerTestResult, setOptimizerTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [paidTestResult, setPaidTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [activeTab, setActiveTab] = useState<SettingTab>('connection');
  const [form] = Form.useForm();
  const settings = useSettingsStore();
  const paidApiProvider = Form.useWatch('paidApiProvider', form);
  const [unsaved, setUnsaved] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [activePaidProfileId, setActivePaidProfileId] = useState<string | null>(null);
  const [activePaidNodeKind, setActivePaidNodeKind] = useState<PaidApiNodeKind>('paidTextToImage');
  const [activePaidCapability, setActivePaidCapability] = useState<PaidCapability>('text-to-image');
  useEffect(() => {
    const open = () => openSettings();
    window.addEventListener('ai-canvas-open-settings', open);
    const openAppearance = () => { setActiveTab('appearance'); setOpen(true); };
    window.addEventListener('ai-canvas-open-appearance', openAppearance);
    return () => {
      window.removeEventListener('ai-canvas-open-settings', open);
      window.removeEventListener('ai-canvas-open-appearance', openAppearance);
    };
  }, []);

  const openSettings = () => {
    const firstProfile = settings.paidApiProfiles[0];
    form.setFieldsValue({ ...settings, ...(firstProfile ? { paidApiProfileName:firstProfile.name, paidApiProvider:firstProfile.provider, paidApiKey:firstProfile.apiKey, paidApiBaseUrl:firstProfile.baseUrl, paidApiSelectedModel:firstProfile.selectedModel } : {}) });
    for (const kind of PAID_API_NODE_KINDS) {
      const node = settings.paidApiNodes?.[kind];
      form.setFieldsValue({ [`${kind}Provider`]: node?.provider || '', [`${kind}BaseUrl`]: node?.baseUrl || '', [`${kind}ApiKey`]: node?.apiKey || '', [`${kind}SelectedModel`]: node?.selectedModel || '', [`${kind}ModelsPath`]: node?.modelsPath || '', [`${kind}ImagePath`]: node?.imagePath || '', [`${kind}VideoPath`]: node?.videoPath || '', [`${kind}TaskPath`]: node?.taskPath || '', [`${kind}CapabilityPath`]: node?.capabilityPath || '', [`${kind}AuthMode`]: node?.authMode || 'bearer', [`${kind}EnabledCapabilities`]: node?.enabledCapabilities || [] });
      setPaidNodeModels(current => ({ ...current, [kind]: node?.models || [] }));
    }
    setFetchedPaidModels(firstProfile?.models || []);
    form.setFieldsValue({
      bailianApiKey: settings.bailianTextToImage?.apiKey || '',
      bailianRegion: settings.bailianTextToImage?.region || 'cn-beijing',
      bailianWorkspaceId: settings.bailianTextToImage?.workspaceId || '',
      bailianBaseUrl: settings.bailianTextToImage?.baseUrl || '',
    });
    setActivePaidProfileId(firstProfile?.id || null);
    setActivePaidNodeKind('paidTextToImage');
    setActivePaidCapability('text-to-image');
    setUnsaved(false); setOpen(true);
  };
  const readPaidNodeValues = (kind: PaidApiNodeKind) => {
    const values = form.getFieldsValue();
    const node = settings.paidApiNodes?.[kind];
    const field = (name: string, fallback: string) => values[name] !== undefined ? String(values[name] || '') : fallback;
    return {
      provider: field(`${kind}Provider`, node?.provider || ''),
      baseUrl: field(`${kind}BaseUrl`, node?.baseUrl || ''),
      apiKey: field(`${kind}ApiKey`, node?.apiKey || ''),
      selectedModel: field(`${kind}SelectedModel`, node?.selectedModel || ''),
      models: paidNodeModels[kind] || node?.models || [],
      modelsPath: field(`${kind}ModelsPath`, node?.modelsPath || ''),
      imagePath: field(`${kind}ImagePath`, node?.imagePath || ''),
      videoPath: field(`${kind}VideoPath`, node?.videoPath || ''),
      taskPath: field(`${kind}TaskPath`, node?.taskPath || ''),
      capabilityPath: field(`${kind}CapabilityPath`, node?.capabilityPath || ''),
      authMode: field(`${kind}AuthMode`, node?.authMode || 'bearer') as 'bearer' | 'x-api-key' | 'query-key' | 'none',
      enabledCapabilities: Array.isArray(values[`${kind}EnabledCapabilities`]) ? values[`${kind}EnabledCapabilities`] : (node?.enabledCapabilities || []),
    };
  };
  const updatePaidNode = (kind: PaidApiNodeKind, patch: Partial<ReturnType<typeof readPaidNodeValues>>) => {
    const current = readPaidNodeValues(kind);
    useSettingsStore.getState().setPaidApiNode(kind, { ...current, ...patch });
  };
  const fetchPaidNodeModels = async (kind: PaidApiNodeKind) => {
    const node = readPaidNodeValues(kind);
    if (!node.provider || !node.apiKey) { message.warning('请先填写当前节点的供应商和 API 密钥'); return; }
    setPaidNodeBusy(current => ({ ...current, [kind]: true }));
    try {
      const models = await fetchPaidModelsFromApi(node.provider, node.baseUrl, node.apiKey, { modelsPath: node.modelsPath, authMode: node.authMode });
      setPaidNodeModels(current => ({ ...current, [kind]: models }));
      updatePaidNode(kind, { models, selectedModel: models[0] || node.selectedModel });
      form.setFieldValue(`${kind}SelectedModel`, models[0] || node.selectedModel);
      if (models.length) message.success(`${kindLabel(kind)}已获取 ${models.length} 个模型`); else message.warning('未获取到模型列表，仍可手动填写模型名');
    } catch (error) { message.error(error instanceof Error ? error.message : '拉取模型失败'); }
    finally { setPaidNodeBusy(current => ({ ...current, [kind]: false })); }
  };
  const testPaidNode = async (kind: PaidApiNodeKind) => {
    const node = readPaidNodeValues(kind);
    setPaidNodeBusy(current => ({ ...current, [kind]: true }));
    try {
      const result = await testPaidConnection({ provider: node.provider, apiKey: node.apiKey, baseUrl: node.baseUrl, model: node.selectedModel, modelsPath: node.modelsPath, authMode: node.authMode });
      setPaidNodeResults(current => ({ ...current, [kind]: result }));
      if (result.ok) updatePaidNode(kind, node);
    } catch (error) { setPaidNodeResults(current => ({ ...current, [kind]: { ok: false, message: error instanceof Error ? error.message : '连接失败' } })); }
    finally { setPaidNodeBusy(current => ({ ...current, [kind]: false })); }
  };
  const kindLabel = (kind: PaidApiNodeKind) => ({ paidTextToImage:'文生图', paidImageToImage:'图生图 / 改图', paidTextToVideo:'文生视频', paidImageToVideo:'图生视频', paidCapability:'扩展能力（首尾帧 / 清晰 / 抠图 / 扩图 / 视频工具）' }[kind]);
  const activePaidNode = settings.paidApiNodes?.[activePaidNodeKind] || {};
  const activePaidModels = paidNodeModels[activePaidNodeKind] || activePaidNode.models || [];
  const activeCapabilityOptions = (Object.keys(PAID_CAPABILITIES) as PaidCapability[]).filter(capability => {
    const provider = activePaidNode.provider || '';
    if (!provider) return true;
    return getSupportedPaidCapabilities(provider, activePaidModels, activePaidNode.enabledCapabilities || []).includes(capability);
  });
  const loadPaidProfile = (id: string) => {
    const profile = settings.paidApiProfiles.find(item => item.id === id);
    if (!profile) return;
    setActivePaidProfileId(id);
    setFetchedPaidModels(profile.models || []);
    form.setFieldsValue({ paidApiProfileName:profile.name, paidApiProvider:profile.provider, paidApiKey:profile.apiKey, paidApiBaseUrl:profile.baseUrl, paidApiSelectedModel:profile.selectedModel });
  };
  const newPaidProfile = () => {
    setActivePaidProfileId(null); setFetchedPaidModels([]);
    form.setFieldsValue({ paidApiProfileName:'新付费 API 档案', paidApiProvider:undefined, paidApiKey:'', paidApiBaseUrl:'', paidApiSelectedModel:undefined });
  };
  const savePaidProfile = () => {
    const values = form.getFieldsValue();
    if (!values.paidApiProvider || !values.paidApiKey) { message.warning('请先填写供应商和 API 密钥'); return; }
    const id = activePaidProfileId || `paid-${Date.now().toString(36)}`;
    const profile: PaidApiProfile = { id, name:String(values.paidApiProfileName || '未命名付费 API'), provider:String(values.paidApiProvider), apiKey:String(values.paidApiKey), baseUrl:String(values.paidApiBaseUrl || ''), models:fetchedPaidModels.length ? fetchedPaidModels : (settings.paidApiProfiles.find(item=>item.id===id)?.models || []), selectedModel:String(values.paidApiSelectedModel || '') };
    const profiles = [...settings.paidApiProfiles.filter(item => item.id !== id), profile];
    settings.setPaidApiProfiles(profiles); setActivePaidProfileId(id); setUnsaved(false);
    message.success('付费 API 档案已保存');
  };
  const removePaidProfile = () => {
    if (!activePaidProfileId) return;
    settings.setPaidApiProfiles(settings.paidApiProfiles.filter(item => item.id !== activePaidProfileId));
    newPaidProfile(); message.success('付费 API 档案已删除');
  };

  const handleTest = async () => {
    setTesting(true); setConnection(null);
    const values = form.getFieldsValue();
    const override = String(values.baseUrl || values.comfyUrl || '').trim();
    try { const result = await testConnection(useSettingsStore.getState().activeServerId || undefined, override || undefined); setConnection(result); if (result.ok) setModels(await getModels(useSettingsStore.getState().activeServerId || undefined)); }
    catch (error) { setConnection({ ok: false, message: error instanceof Error ? error.message : '连接失败' }); }
    finally { setTesting(false); }
  };
  const testLinks = async () => {
    const values = form.getFieldsValue();
    const links = [
      { label: '控制 API', url: `${String(values.baseUrl || settings.baseUrl).replace(/\/+$/, '')}/api/health` },
      { label: 'ComfyUI', url: `${String(values.comfyUrl || settings.comfyUrl).replace(/\/+$/, '')}` },
    ];
    setLinkTest(await Promise.all(links.map(async link => {
      try {
        const url = link.label === 'ComfyUI' ? `${link.url.replace(/\/+$/, '')}/system_stats` : link.url;
        const response = await fetch(url);
        if (!response.ok) return { label: link.label, ok: false, message: `HTTP ${response.status}` };
        if (link.label === 'ComfyUI') return { label: link.label, ok: true, message: 'ComfyUI 服务正常' };
        return { label: link.label, ok: true, message: 'HTTP 200' };
      }
      catch (error) { return { label: link.label, ok: false, message: error instanceof Error ? error.message : '无法连接' }; }
    })));
  };

  const fetchDevAgentModels = async () => {
    const values = form.getFieldsValue();
    setFetchingDevAgent(true); setFetchedDevAgentModels([]);
    try {
      const models = await fetchModelsFromApi(values.devAgentProvider || 'openai', values.devAgentBaseUrl || settings.devAgentBaseUrl, values.devAgentApiKey || settings.devAgentApiKey);
      setFetchedDevAgentModels(models);
      if (models.length === 0) message.warning('未获取到模型列表，请检查接口地址和密钥');
      else message.success('成功获取 ' + models.length + ' 个模型');
    } catch (e: any) { message.error('拉取模型失败: ' + (e.message || '未知错误')); }
    finally { setFetchingDevAgent(false); }
  };

  const fetchChatModels = async () => {
    const values = form.getFieldsValue();
    setFetchingChat(true); setFetchedChatModels([]);
    try {
      const models = await fetchModelsFromApi(values.chatProvider || 'openai', values.chatBaseUrl || settings.chatBaseUrl, values.chatApiKey || settings.chatApiKey);
      setFetchedChatModels(models);
      if (models.length === 0) message.warning('未获取到模型列表，请检查接口地址和密钥');
      else message.success('成功获取 ' + models.length + ' 个模型');
    } catch (e: any) { message.error('拉取模型失败: ' + (e.message || '未知错误')); }
    finally { setFetchingChat(false); }
  };

  const fetchOptimizerModels = async () => {
    const values = form.getFieldsValue();
    setFetchingOptimizer(true); setFetchedOptimizerModels([]);
    try {
      const models = await fetchModelsFromApi(values.optimizerProvider || 'openai', values.optimizerBaseUrl || settings.optimizerBaseUrl, values.optimizerApiKey || settings.optimizerApiKey);
      setFetchedOptimizerModels(models);
      if (models.length === 0) message.warning('未获取到模型列表');
      else message.success('成功获取 ' + models.length + ' 个模型');
    } catch (e: any) { message.error('拉取模型失败: ' + (e.message || '未知错误')); }
    finally { setFetchingOptimizer(false); }
  };

  const fetchPaidModels = async () => {
    const values = form.getFieldsValue();
    const provider = values.paidApiProvider || settings.paidApiProvider;
    const baseUrl = values.paidApiBaseUrl || settings.paidApiBaseUrl;
    const apiKey = values.paidApiKey || settings.paidApiKey;
    if (!provider || !apiKey) { message.warning('请先选择供应商并填写 API 密钥'); return; }
    setFetchingPaid(true); setFetchedPaidModels([]);
    try {
      const models = await fetchPaidModelsFromApi(provider === 'custom' ? 'openai' : provider, baseUrl, apiKey);
      setFetchedPaidModels(models);
      if (models.length === 0) message.warning('未获取到模型列表。请检查接口地址、密钥权限，或确认供应商是否开放模型列表接口。');
      else { form.setFieldValue('paidApiSelectedModel', models[0]); message.success('成功获取 ' + models.length + ' 个模型，请选择后测试连接。'); }
    } catch (e: any) { message.error('拉取模型失败: ' + (e.message || '未知错误')); }
    finally { setFetchingPaid(false); }
  };
  const testChatConnection = async () => {
    const values = form.getFieldsValue();
    setTestingChat(true); setChatTestResult(null);
    try {
      const models = await fetchModelsFromApi(values.chatProvider || 'openai', values.chatBaseUrl || settings.chatBaseUrl, values.chatApiKey || settings.chatApiKey);
      if (models.length > 0) { setChatTestResult({ ok: true, message: '连接成功，可用 ' + models.length + ' 个模型' }); setFetchedChatModels(models); }
      else setChatTestResult({ ok: false, message: '连接成功但未获取到模型列表' });
    } catch (e: any) { setChatTestResult({ ok: false, message: e.message || '连接失败' }); }
    finally { setTestingChat(false); }
  };

  const testOptimizerConnection = async () => {
    const values = form.getFieldsValue();
    setTestingOptimizer(true); setOptimizerTestResult(null);
    try {
      const models = await fetchModelsFromApi(values.optimizerProvider || 'openai', values.optimizerBaseUrl || settings.optimizerBaseUrl, values.optimizerApiKey || settings.optimizerApiKey);
      if (models.length > 0) { setOptimizerTestResult({ ok: true, message: '连接成功，可用 ' + models.length + ' 个模型' }); setFetchedOptimizerModels(models); }
      else setOptimizerTestResult({ ok: false, message: '连接成功但未获取到模型列表' });
    } catch (e: any) { setOptimizerTestResult({ ok: false, message: e.message || '连接失败' }); }
    finally { setTestingOptimizer(false); }
  };

  const testPaidConnectionHandler = async () => {
    const values = form.getFieldsValue();
    const provider = values.paidApiProvider || settings.paidApiProvider;
    const baseUrl = values.paidApiBaseUrl || settings.paidApiBaseUrl;
    const apiKey = values.paidApiKey || settings.paidApiKey;
    setTestingPaid(true); setPaidTestResult(null);
    try {
      const result = await testPaidConnection({ provider, apiKey, baseUrl, model: values.paidApiSelectedModel || '' });
      setPaidTestResult(result);
      if (result.ok) {
        const models = await fetchPaidModelsFromApi(provider === 'custom' ? 'openai' : provider, baseUrl, apiKey);
        if (models.length > 0) setFetchedPaidModels(models);
      }
    } catch (e: any) { setPaidTestResult({ ok: false, message: e.message || '连接失败' }); }
    finally { setTestingPaid(false); }
  };

  const testBailianConnection = async () => {
    const values = form.getFieldsValue();
    const apiKey = String(values.bailianApiKey || settings.bailianTextToImage?.apiKey || '').trim();
    const region = values.bailianRegion || settings.bailianTextToImage?.region || 'cn-beijing';
    const workspaceId = String(values.bailianWorkspaceId || '').trim();
    const baseUrl = String(values.bailianBaseUrl || '').trim();
    setTestingBailian(true); setBailianTestResult(null);
    try {
      const result = await callBailianTextToImage({ apiKey, region, workspaceId, baseUrl }, { prompt: '一张简洁的彩色几何图形，白色背景', ratio: '1:1', resolution: 1024, seed: 1 });
      setBailianTestResult({ ok: Boolean(result.url), message: result.url ? '百炼接口调用成功，已返回图片地址' : '接口响应成功，但没有图片地址' });
    } catch (error) { setBailianTestResult({ ok: false, message: error instanceof Error ? error.message : '百炼接口调用失败' }); }
    finally { setTestingBailian(false); }
  };

  const save = async (values: any, section: SettingTab = activeTab) => {
    const store = useSettingsStore.getState();
    if (section === 'connection') {
      const command = String(values.sshCommand || '').trim();
      const parsed = command ? parseSshCommand(command) : null;
      if (command && !parsed) { message.error('SSH 命令格式不正确，请使用 ssh -p 端口 用户@主机'); return; }
      store.setBaseUrl(values.baseUrl || ''); store.setApiKey(values.apiKey || '');
      store.setTimeout(values.timeout || 600000); store.setConcurrency(values.concurrency || 1);
      store.setComfyUrl(values.comfyUrl || '');
      store.setSsh({
        sshCommand: command,
        sshHost: parsed?.host || '', sshPort: parsed?.port || 22, sshUsername: parsed?.username || '',
        sshPassword: values.sshPassword || store.sshPassword,
      });
      try { if (values.sshPassword) await (window as any).electronAPI?.saveSshPassword?.(values.sshPassword); } catch { }
      message.success('连接设置已保存');
    }
    if (section === 'chat') {
      store.setChat({ chatProvider: values.chatProvider, chatBaseUrl: values.chatBaseUrl || '', chatApiKey: values.chatApiKey || '', chatModel: values.chatModel || '', chatModels: fetchedChatModels.length ? fetchedChatModels : store.chatModels, chatSystemPrompt: values.chatSystemPrompt || '', chatThinkingMode: values.chatThinkingMode || 'auto' });
      message.success('聊天 AI 设置已保存');
    }
    if (section === 'devagent') {
      store.setDevAgent({ devAgentProvider: values.devAgentProvider || 'openai', devAgentBaseUrl: values.devAgentBaseUrl || '', devAgentApiKey: values.devAgentApiKey || '', devAgentModel: values.devAgentModel || '', devAgentModels: fetchedDevAgentModels.length ? fetchedDevAgentModels : store.devAgentModels });
      message.success('DevAgent 设置已保存');
    }
    if (section === 'optimizer') {
      store.setOptimizerProvider(values.optimizerProvider); store.setOptimizerBaseUrl(values.optimizerBaseUrl || '');
      store.setOptimizerApiKey(values.optimizerApiKey || ''); store.setOptimizerModel(values.optimizerModel || '');
      store.setOptimizerModels(fetchedOptimizerModels.length ? fetchedOptimizerModels : store.optimizerModels);
      store.setOptimizerPromptOverrides(values.optimizerPromptOverrides || {});
      store.setStoryboardSystemPrompt(values.storyboardSystemPrompt || '');
      message.success('提示词 AI 设置已保存');
    }
    if (section === 'paidapi') {
      store.setPaidApi({ paidApiProvider: values.paidApiProvider || '', paidApiKey: values.paidApiKey || '', paidApiBaseUrl: values.paidApiBaseUrl || '', paidApiModels: fetchedPaidModels.length ? fetchedPaidModels : store.paidApiModels, paidApiSelectedModel: values.paidApiSelectedModel || '' });
      for (const kind of PAID_API_NODE_KINDS) store.setPaidApiNode(kind, readPaidNodeValues(kind));
      store.setBailianTextToImage({ apiKey: values.bailianApiKey || '', region: values.bailianRegion || 'cn-beijing', workspaceId: values.bailianWorkspaceId || '', baseUrl: values.bailianBaseUrl || '' });
      message.success('付费 API 设置已保存');
    }
    if (section === 'performance') {
      await (window as any).electronAPI?.saveGpuSetting?.(Boolean(values.gpuAcceleration));
      message.success('性能设置已保存');
    }
    setUnsaved(false);
  };
  return <>
    <Button className="settings-button app-topbar__tool" type="text" icon={<SettingOutlined />} onClick={openSettings} aria-label="打开设置" title="设置" />
    <Modal className="settings-modal" title={<span className="settings-modal__title">⚙ JaceCanvas 设置</span>} open={open} onCancel={() => { if (unsaved) setConfirmClose(true); else setOpen(false); }} footer={null} width={860} styles={{ body: { padding: 0 } }}>
      <div className="settings-layout">
        <div className="settings-sidebar">
          <div className={'settings-sidebar-item ' + (activeTab === 'connection' ? 'active' : '')} onClick={() => setActiveTab('connection')}>
            <LinkOutlined /> <span>连接设置</span>
          </div>
          <div className={'settings-sidebar-item ' + (activeTab === 'chat' ? 'active' : '')} onClick={() => setActiveTab('chat')}>
            <RobotOutlined /> <span>聊天 AI</span>
          </div>
          <div className={'settings-sidebar-item ' + (activeTab === 'devagent' ? 'active' : '')} onClick={() => setActiveTab('devagent')}>
            <CodeOutlined /> <span>DevAgent</span>
          </div>
          <div className={'settings-sidebar-item ' + (activeTab === 'optimizer' ? 'active' : '')} onClick={() => setActiveTab('optimizer')}>
            <ThunderboltOutlined /> <span>提示词 AI</span>
          </div>
          <div className={'settings-sidebar-item ' + (activeTab === 'paidapi' ? 'active' : '')} onClick={() => setActiveTab('paidapi')}>
            <KeyOutlined /> <span>付费 API</span>
          </div>
          <div className={'settings-sidebar-item ' + (activeTab === 'performance' ? 'active' : '')} onClick={() => setActiveTab('performance')}>
            <ApiOutlined /> <span>性能设置</span>
          </div>
          <div className={'settings-sidebar-item ' + (activeTab === 'appearance' ? 'active' : '')} onClick={() => setActiveTab('appearance')}>
            <BgColorsOutlined /> <span>外观</span>
          </div>
          <div className={'settings-sidebar-item ' + (activeTab === 'log' ? 'active' : '')} onClick={() => setActiveTab('log')}>
            <WarningOutlined /> <span>日志</span>
          </div>
          <div className={'settings-sidebar-item ' + (activeTab === 'about' ? 'active' : '')} onClick={() => setActiveTab('about')}>
            <InfoCircleOutlined /> <span>关于</span>
          </div>
        </div>
        <div className="settings-content">
          <Form form={form} layout="vertical" onFinish={save} initialValues={settings} onValuesChange={() => setUnsaved(true)}>
            {activeTab === 'connection' && <div className="settings-tab-content">
              <div className="server-manage">
                <div className="server-manage__head">
                  <h3 className="settings-tab-title">服务器管理</h3>
                  <small>生成任务使用「当前」服务器；可添加本地 ComfyUI 或多台服务器，随时切换。</small>
                </div>
                {servers.map(server => (
                  <div key={server.id} className={'server-row' + (server.id === activeServerId ? ' server-row--active' : '')}>
                    <div className="server-row__info">
                      <span className="server-row__name">{server.name || '未命名服务器'}{server.type === 'comfyui' ? <Tag color="blue" style={{ marginLeft: 6 }}>ComfyUI</Tag> : server.type === 'control' ? <Tag color="purple" style={{ marginLeft: 6 }}>主控</Tag> : server.type === 'custom' ? <Tag style={{ marginLeft: 6 }}>自定义</Tag> : null}</span>
                      <span className="server-row__url">{server.baseUrl || '未设置地址'}</span>
                      {server.id === activeServerId && <Tag color="green">当前</Tag>}
                      {serverTest[server.id] && !serverTest[server.id]?.loading && (
                        <span className={'server-row__test ' + (serverTest[server.id]?.ok ? 'ok' : 'err')}>{serverTest[server.id]?.ok ? '✓ 连接正常' : '✗ 连接失败'}</span>
                      )}
                    </div>
                    <Space size={4} wrap>
                      {server.id !== activeServerId && <Button size="small" type="primary" onClick={() => { setActiveServer(server.id); message.success(`已切换到「${server.name || server.baseUrl}」`); }}>切换</Button>}
                      <Button size="small" onClick={() => openServerEditor(server)}>编辑</Button>
                      <Button size="small" loading={serverTest[server.id]?.loading} onClick={() => void testServer(server)}>测试</Button>
                      <Button size="small" danger onClick={() => { removeServer(server.id); message.success('已删除服务器'); }}>删除</Button>
                    </Space>
                  </div>
                ))}
                <Button icon={<PlusOutlined />} onClick={() => openServerEditor(null)}>添加服务器</Button>
              </div>
              <Divider orientation="left" plain>当前服务器连接</Divider>
              <h3 className="settings-tab-title">连接设置</h3>
              <div className="settings-form-grid">
                <Form.Item name="baseUrl" label="控制 API 地址"><Input placeholder="http://localhost:3000" /></Form.Item>
                <Form.Item name="comfyUrl" label="ComfyUI 地址"><Input placeholder="http://localhost:8188" /></Form.Item>
              </div>
              <div className="settings-form-grid">
                <Form.Item name="apiKey" label="控制 API 密钥"><Input.Password /></Form.Item>
                <Form.Item name="timeout" label="任务超时（毫秒）"><InputNumber min={5000} max={3600000} step={10000} style={{ width: '100%' }} /></Form.Item>
              </div>
              <Form.Item name="concurrency" label="并发数"><InputNumber min={1} max={10} style={{ width: '100%' }} /></Form.Item>
              <Divider orientation="left" plain>SSH 隧道</Divider>
              <Form.Item name="sshCommand" label="SSH 连接命令" extra="直接粘贴服务器提供的命令，例如：ssh -p 10958 root@connect.westd.seetacloud.com"><Input placeholder="ssh -p 10958 root@connect.westd.seetacloud.com" /></Form.Item>
              <div className="settings-form-grid">
                <Form.Item name="sshPassword" label="SSH 密码"><Input.Password placeholder="留空则使用已保存密码" /></Form.Item>
                <div className="ssh-command-preview">保存时自动解析主机、端口和用户名</div>
              </div>
              <Space wrap style={{ marginTop: 12 }}>
                <Button type="primary" onClick={() => void form.validateFields().then(values => save(values, 'connection'))}>保存连接设置</Button>
                <Button onClick={handleTest} loading={testing} icon={<ApiOutlined />}>测试 API</Button>
                <Button onClick={testLinks} icon={<ApiOutlined />}>测试链接</Button>
                <Button onClick={() => { useSettingsStore.getState().reset(); form.setFieldsValue(useSettingsStore.getState()); }}>恢复默认</Button>
              </Space>
              {connection && <div className={connection.ok ? 'settings-status settings-status--ok' : 'settings-status settings-status--error'}>{connection.ok ? <CheckCircleOutlined /> : <CloseCircleOutlined />} {connection.message}</div>}
              {models.length > 0 && <div className="settings-models">可用模型：{models.join('、')}</div>}
              {linkTest.length > 0 && <div className="settings-link-results">{linkTest.map(item => <div key={item.label} className={item.ok ? 'settings-status--ok' : 'settings-status--error'}>{item.ok ? <CheckCircleOutlined /> : <CloseCircleOutlined />} {item.label}：{item.message}</div>)}</div>}
              <Modal title={editingServer ? '编辑服务器' : '添加服务器'} open={serverEditorOpen} onOk={saveServer} onCancel={() => setServerEditorOpen(false)} okText="保存" cancelText="取消" destroyOnClose>
                <Form form={serverForm} layout="vertical">
                  <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入服务器名称' }]}><Input placeholder="例如：本地 ComfyUI / 主控服务器" /></Form.Item>
                  <Form.Item name="type" label="服务器类型"><Select options={[{ value: 'comfyui', label: 'ComfyUI 直连（本地/远程）' }, { value: 'control', label: '主控服务器（工作流 API）' }, { value: 'custom', label: '自定义' }]} /></Form.Item>
                  <Form.Item name="baseUrl" label="地址" rules={[{ required: true, message: '请输入服务器地址' }]} extra="本地 ComfyUI 填 http://127.0.0.1:8188；主控服务器填其控制地址"><Input placeholder="http://127.0.0.1:8188" /></Form.Item>
                  <Form.Item name="apiKey" label="API 密钥（可选）"><Input.Password placeholder="有鉴权才需要填写" /></Form.Item>
                  <Form.Item name="perfUrl" label="性能检测地址（可选）" extra="主控服务器可填第二个链接：节点用上面的「地址」，性能检测用这个。留空则用上面的地址"><Input placeholder="https://u....seetacloud.com:8443" /></Form.Item>
                </Form>
              </Modal>
            </div>}
            {activeTab === 'chat' && <div className="settings-tab-content">
              <h3 className="settings-tab-title">聊天 AI 设置</h3>
              <div className="settings-section-hint">聊天节点和全页面聊天窗口统一使用此 API 配置。</div>
              <div className="settings-form-grid">
                <Form.Item name="chatProvider" label="聊天 AI 提供商"><Select options={providerOptions} /></Form.Item>
              <Form.Item name="chatModel" label="聊天 AI 模型"><Select showSearch allowClear placeholder="先拉取模型" options={(fetchedChatModels.length ? fetchedChatModels : settings.chatModels).map(model => ({label:model,value:model}))} /></Form.Item>
              </div>
              <Form.Item name="chatBaseUrl" label="聊天 AI 接口地址"><Input placeholder="https://api.openai.com/v1" /></Form.Item>
              <Form.Item name="chatApiKey" label="聊天 AI API 密钥"><Input.Password /></Form.Item>
              <Form.Item name="chatSystemPrompt" label="聊天系统提示词"><Input.TextArea rows={3} /></Form.Item>
              <Form.Item name="chatThinkingMode" label="思考模式（部分模型支持）"><Select options={thinkingModeOptions} /></Form.Item>
              <Space wrap style={{ marginTop: 8 }}>
                <Button onClick={fetchChatModels} loading={fetchingChat}>拉取模型</Button>
                <Button onClick={testChatConnection} loading={testingChat} icon={<ApiOutlined />}>测试连接</Button>
                 <Button type="primary" onClick={() => void form.validateFields().then(values => save(values, 'chat'))}>保存聊天 AI</Button>
              </Space>
              {fetchedChatModels.length > 0 && <div className="settings-models">可用模型：{fetchedChatModels.join('、')}</div>}
              {chatTestResult && <div className={chatTestResult.ok ? 'settings-status settings-status--ok' : 'settings-status settings-status--error'}>{chatTestResult.ok ? <CheckCircleOutlined /> : <CloseCircleOutlined />} {chatTestResult.message}</div>}
            </div>}
            {activeTab === 'devagent' && <div className="settings-tab-content">
              <h3 className="settings-tab-title">DevAgent（画布 AI 代码助手）设置</h3>
              <div className="settings-section-hint">画布里的 Jace-DevAgent 独立使用此 API 配置（与聊天 AI 分开）。未配置时暂用聊天 AI 配置。</div>
              <div className="settings-form-grid">
                <Form.Item name="devAgentProvider" label="提供商"><Select options={providerOptions} /></Form.Item>
              <Form.Item name="devAgentModel" label="模型"><Select showSearch allowClear placeholder="先拉取模型" options={(fetchedDevAgentModels.length ? fetchedDevAgentModels : settings.devAgentModels).map(model => ({label:model,value:model}))} /></Form.Item>
              </div>
              <Form.Item name="devAgentBaseUrl" label="接口地址"><Input placeholder="https://api.openai.com/v1" /></Form.Item>
              <Form.Item name="devAgentApiKey" label="API 密钥"><Input.Password placeholder="DevAgent 专用密钥" /></Form.Item>
              <Space wrap style={{ marginTop: 8 }}>
                <Button onClick={fetchDevAgentModels} loading={fetchingDevAgent}>拉取模型</Button>
                <Button type="primary" onClick={() => void form.validateFields().then(values => save(values, 'devagent'))}>保存 DevAgent</Button>
              </Space>
              {fetchedDevAgentModels.length > 0 && <div className="settings-models">可用模型：{fetchedDevAgentModels.join('、')}</div>}
              <div className="settings-section-hint" style={{ marginTop: 10 }}>提示：源码修改遵循沙盒安全机制——只会复制一份源码副本修改，主版本原样保留，始终保留 2 个可用版本。</div>
            </div>}
            {activeTab === 'optimizer' && <div className="settings-tab-content">
              <h3 className="settings-tab-title">提示词 AI 设置</h3>
              <div className="settings-section-hint">用于提示词优化/翻译、分镜 AI 等场景。</div>
              <Form.Item name="optimizerProvider" label="提示词 AI 提供商"><Select options={providerOptions} /></Form.Item>
              <Form.Item name="optimizerBaseUrl" label="提示词 AI 接口地址"><Input placeholder="https://api.openai.com/v1" /></Form.Item>
              <div className="settings-form-grid">
                <Form.Item name="optimizerApiKey" label="提示词 AI 密钥"><Input.Password /></Form.Item>
                <Form.Item name="optimizerModel" label="提示词 AI 模型"><Input placeholder="gpt-4o-mini" /></Form.Item>
              </div>
              <Divider orientation="left" plain>各节点提示词覆盖（可选）</Divider>
              <div className="settings-section-hint">留空使用内置提示词；填写后只替换对应类型的系统指令。要求 AI 直接输出优化后的最终提示词，不要解释。</div>
              {(Object.keys(SYSTEM_PROMPTS) as Array<keyof typeof SYSTEM_PROMPTS>).map(kind => (
                <Form.Item key={kind} name={['optimizerPromptOverrides', kind]} label={`${kind} 优化提示词`}>
                  <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} placeholder={SYSTEM_PROMPTS[kind]} />
                </Form.Item>
              ))}
              <Form.Item name="storyboardSystemPrompt" label="分镜 AI 默认系统提示词"><Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} placeholder={DEFAULT_STORYBOARD_SYSTEM_PROMPT} /></Form.Item>
              <Space wrap style={{ marginTop: 8 }}>
                <Button onClick={fetchOptimizerModels} loading={fetchingOptimizer}>拉取模型</Button>
                <Button onClick={testOptimizerConnection} loading={testingOptimizer} icon={<ApiOutlined />}>测试连接</Button>
                 <Button type="primary" onClick={() => void form.validateFields().then(values => save(values, 'optimizer'))}>保存提示词 AI</Button>
              </Space>
              {fetchedOptimizerModels.length > 0 && <div className="settings-models">可用模型：{fetchedOptimizerModels.join('、')}</div>}
              {optimizerTestResult && <div className={optimizerTestResult.ok ? 'settings-status settings-status--ok' : 'settings-status settings-status--error'}>{optimizerTestResult.ok ? <CheckCircleOutlined /> : <CloseCircleOutlined />} {optimizerTestResult.message}</div>}
            </div>}

            {activeTab === 'paidapi' && <div className="settings-tab-content">
              <h3 className="settings-tab-title">付费 API 厂商配置</h3>
              <PaidApiSettings />
            </div>}
            {activeTab === 'performance' && <div className="settings-tab-content">
              <h3 className="settings-tab-title">性能设置</h3>
              <Form.Item name="gpuAcceleration" label="启用 GPU 硬件加速" valuePropName="checked"><Switch onChange={() => message.info('GPU 设置将在点击「保存性能设置」并重启应用后生效')} /></Form.Item>
              <Space wrap style={{ marginTop: 12 }}>
                 <Button type="primary" onClick={() => void form.validateFields().then(values => save(values, 'performance'))}>保存性能设置</Button>
              </Space>
            </div>}

            {activeTab === 'appearance' && <div className="settings-tab-content">
              <h3 className="settings-tab-title">外观与主题</h3>
              <AppearanceSettings />
            </div>}

            {activeTab === 'log' && <LogTab />}
            {activeTab === 'about' && <div className="settings-tab-content">
              <h3 className="settings-tab-title">关于 JaceCanvas</h3>
              <div className="settings-about-section">
                <img src="./icon1.png" alt="JaceCanvas Logo" className="settings-about__logo" />
                <strong>JaceCanvas</strong>
                <span className="settings-about__version">版本 {APP_VERSION}</span>
              </div>
              <div className="settings-about__info">
                <p>JaceCanvas 是一个 AI 驱动的创意画布工具，用于图像生成、视频生成、数字人、音频等多种 AI 创作场景。</p>
                <div className="settings-contact-row">
                  <a className="settings-contact-link" href="https://github.com/Nicke000/JaceCanvas" target="_blank" rel="noreferrer" title="GitHub 开源地址"><GithubOutlined /></a>
                  <a className="settings-contact-link" href="https://qm.qq.com/q/ZFvPlgPQmm" target="_blank" rel="noreferrer" title="QQ 交流群"><QqOutlined /></a>
                </div>
              </div>
              <Divider />
              <div className="auto-save-hint">⚠️ 安全提醒：不要把 API Key、SSH 密码、GitHub 凭据、私有地址写入公开文档、截图、日志或脚本。若凭据曾经公开，请立即撤销并重新生成。</div>
              <div className="settings-notice">完全开源免费，仅供学习与交流使用。</div>
              <Divider />
              <h3 className="settings-tab-title">数据管理</h3>
              <p style={{ fontSize: 11, color: 'var(--theme-muted)', margin: '0 0 8px' }}>清空后应用回到全新状态（AI 配置、服务器、资产库、生成历史、工作流缓存、书签等全部本地数据都会删除，不可恢复）。需要旧版数据时请在文件管理器中查看 %APPDATA%\\ai-canvas-desktop。</p>
              <Button danger onClick={() => Modal.confirm({ title: '清空所有本地数据？', content: '将删除：AI 配置、服务器设置、资产库、生成历史、工作流缓存、画布书签等全部本地数据。此操作不可恢复，确定继续吗？', okText: '清空', okButtonProps: { danger: true }, cancelText: '取消', onOk: () => { try { localStorage.clear(); } catch { /* ignore */ } try { indexedDB.databases?.().then(dbs => dbs.forEach(db => { if (db.name) indexedDB.deleteDatabase(db.name); })); } catch { /* ignore */ } message.success('已清空，应用将重新加载'); setTimeout(() => window.location.reload(), 800); } })}>清空所有本地数据</Button>
              <div className="settings-notice">请勿将本软件用于任何非法或违规用途，使用者需自行承担相应法律责任。</div>
            </div>}
          </Form>
        </div>
      </div>
    </Modal>
      <Modal title="未保存的更改" open={confirmClose} onCancel={() => setConfirmClose(false)} onOk={() => { setConfirmClose(false); setOpen(false); setUnsaved(false); }} okText="退出不保存" cancelText="继续编辑">
        <div style={{ color: 'var(--theme-text-2)' }}>设置尚未保存，退出将丢失所有更改。是否确认退出？</div>
      </Modal>
  </>;
};

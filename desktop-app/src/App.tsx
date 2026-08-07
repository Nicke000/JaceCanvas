import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ConfigProvider, App as AntApp, theme, Button, Tooltip, Space, Input, Modal, message, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import { SaveOutlined, FolderOpenOutlined, ExportOutlined, ImportOutlined, AppstoreOutlined, CopyOutlined, PlusOutlined, CloseOutlined, CloudServerOutlined, UnorderedListOutlined, BgColorsOutlined, ApartmentOutlined, CameraOutlined, MoreOutlined, VideoCameraOutlined, PlaySquareOutlined, DesktopOutlined, ClusterOutlined, MessageOutlined, FieldTimeOutlined, HistoryOutlined, CompressOutlined, ExpandOutlined, RobotOutlined, FullscreenOutlined } from '@ant-design/icons';
import zhCN from 'antd/locale/zh_CN';
import { Canvas } from '@/components/Canvas';
import { ConfigPanel } from '@/components/ConfigPanel';
import { ContextMenu } from '@/components/ContextMenu';
import { SettingsButton } from '@/components/SettingsPanel';
import { ShortcutHelp } from '@/components/ShortcutHelp';
import { FloatingAssistant } from '@/components/FloatingAssistant';
import { AgentPanel } from '@/components/AgentPanel';
import { WorkspaceSidebar } from '@/components/WorkspaceSidebar';
import { GenerationHistory } from '@/components/GenerationHistory';
import { PerformanceBar } from '@/components/PerformanceBar';
import { useCanvasStore } from '@/stores/canvasStore';
import { db, generateId, loadChatSessions } from '@/utils';
import { ServerControlPanel } from '@/components/ServerControlPanel';
import { StoryDramaStudio } from '@/components/StoryDramaStudio';
import { ThemeSelector } from '@/components/ThemeSelector';
import { TaskQueue } from '@/components/TaskQueue';
import { ChatWindow } from '@/components/ChatWindow';
import type { ChatSession } from '@/types';
import { useThemeStore, resolveAntdTokens } from '@/stores/themeStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { initAutosave, setAutosaveContext, flushAutosave, restoreAutosave, listSnapshots, restoreSnapshot } from '@/utils/autosave';
import { refreshApiNodeFields } from '@/utils/workflowNode';
import { testConnection } from '@/services/comfyui.service';
import { comfyWS } from '@/services/comfyui-ws.service';

const App: React.FC = () => {
  const OPEN_PROJECTS_KEY = 'jacecanvas-open-projects';
  const sid = useCanvasStore(s => s.selectedNodeId);
  const projectName = useCanvasStore(s => s.projectName);
  const nodeCount = useCanvasStore(s => s.nodes.length);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [loadModalOpen, setLoadModalOpen] = useState(false);
  const [projectNameInput, setProjectNameInput] = useState('');
  const [projects, setProjects] = useState<{id:string;name:string;updatedAt:number}[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projectFolder, setProjectFolder] = useState<string>(() => localStorage.getItem('jacecanvas-project-folder') || '');
  const [projectFilePath, setProjectFilePath] = useState<string>(() => localStorage.getItem('jacecanvas-project-file') || '');
  const [closeProjectId, setCloseProjectId] = useState<string | null>(null);
  const [closedProjectIds, setClosedProjectIds] = useState<string[]>([]);
  const [serverControlOpen, setServerControlOpen] = useState(false);
  const [recoverModalOpen, setRecoverModalOpen] = useState(false);
  const [recoverData, setRecoverData] = useState<{ data: { nodes: unknown[]; edges: unknown[] }; projectId: string; projectName: string } | null>(null);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<Array<{ id: string; version: number; savedAt: number }>>([]);
  const servers = useSettingsStore(s => s.servers);
  const activeServerId = useSettingsStore(s => s.activeServerId);
  const setActiveServer = useSettingsStore(s => s.setActiveServer);
  const activeServer = servers.find(item => item.id === activeServerId) || servers[0] || null;
  const [dramaStudioOpen, setDramaStudioOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyHeight, setHistoryHeight] = useState(0);
  const [taskQueueOpen, setTaskQueueOpen] = useState(false);
  const [chatWindowOpen, setChatWindowOpen] = useState(false);
  const [chatSession, setChatSession] = useState<ChatSession | null>(null);
  // 覆盖层标志：画布全局快捷键（Canvas keydown）据此禁用，避免在短剧工作室/聊天/DevAgent 里误删底层节点
  useEffect(() => { (window as any).__aiCanvasOverlayOpen = dramaStudioOpen || chatWindowOpen || agentOpen; }, [dramaStudioOpen, chatWindowOpen, agentOpen]);
  const [textEditor, setTextEditor] = useState<{nodeId:string;field:string;value:string;label:string;kind:'text'|'script'|'scene'}|null>(null);
  const [textEditorOpen, setTextEditorOpen] = useState(false);
  const [textEditorAutoClose, setTextEditorAutoClose] = useState(() => localStorage.getItem('ai-canvas-text-editor-auto-close') !== 'false');
  const [textEditorFullscreen, setTextEditorFullscreen] = useState(false);
  const [textEditorHeight, setTextEditorHeight] = useState(48);
  const [templateName, setTemplateName] = useState('');
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [uptime, setUptime] = useState(0);
  const [windowMaximized, setWindowMaximized] = useState(false);
  const [loadTemplateModalOpen, setLoadTemplateModalOpen] = useState(false);
  const [templates, setTemplates] = useState<{id:string;name:string;nodes:any;edges:any;timestamp:number}[]>([]);
  const themeId = useThemeStore(s => s.themeId);
  const uiRadius = useThemeStore(s => s.preferences.radius);
  const uiPrefs = useThemeStore(s => s.preferences);
  const uiCustom = useThemeStore(s => s.custom);
  const uiThemes = useThemeStore(s => s.themes);
  // antd 不接受 CSS 变量字符串（派生色不可靠），改为解析当前主题为 hex 再传入
  const antdTokens = React.useMemo(() => {
    const current = uiThemes.find(t => t.id === themeId) || uiThemes[0];
    return resolveAntdTokens(current, uiCustom, uiPrefs);
  }, [themeId, uiCustom, uiPrefs, uiThemes]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const appStartedAt = useRef(Date.now());
  useEffect(() => {
    const resume = (event: Event) => { setChatSession((event as CustomEvent<ChatSession>).detail || null); setChatWindowOpen(true); };
    window.addEventListener('ai-canvas-resume-chat', resume);
    return () => window.removeEventListener('ai-canvas-resume-chat', resume);
  }, []);
  const openChat = useCallback(async () => {
    try {
      const sessions = await loadChatSessions();
      setChatSession(sessions[0] || null);
    } catch { setChatSession(null); }
    setChatWindowOpen(true);
  }, []);
  useEffect(() => { const timer = window.setInterval(() => setUptime(Date.now() - appStartedAt.current), 1000); return () => window.clearInterval(timer); }, []);
  // 服务器健康检查（30s）+ WebSocket 跟随当前服务器
  const [serverHealth, setServerHealth] = useState<Record<string, boolean>>({});
  useEffect(() => {
    comfyWS.connect();
    let mounted = true;
    const check = async () => {
      try { const ok = await testConnection(); if (mounted) setServerHealth(prev => ({ ...prev, [activeServerId]: !!ok })); }
      catch { if (mounted) setServerHealth(prev => ({ ...prev, [activeServerId]: false })); }
    };
    void check();
    const t = setInterval(check, 30000);
    return () => { mounted = false; clearInterval(t); };
  }, [activeServerId, activeServer?.baseUrl]);
  const healthDot = (id: string) => <span style={{ display:'inline-block', width:8, height:8, borderRadius:'50%', marginRight:5, background: serverHealth[id] === true ? 'var(--theme-success)' : serverHealth[id] === false ? 'var(--theme-error)' : 'var(--theme-text-3)' }} />;
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.onWindowStateChange) return;
    return api.onWindowStateChange((state: { maximized?: boolean }) => setWindowMaximized(Boolean(state?.maximized)));
  }, []);
  const formatUptime = (ms: number) => { const total = Math.floor(ms / 1000); const h = Math.floor(total / 3600); const m = Math.floor((total % 3600) / 60); const s = total % 60; return `${h}时${String(m).padStart(2, '0')}分${String(s).padStart(2, '0')}秒`; };

  const refreshProjects = useCallback(async () => {
    try {
      const all = await db.projects.orderBy('updatedAt').reverse().toArray();
      const summaries = all.map(p=>({id:p.id,name:p.name,updatedAt:p.updatedAt}));
      setProjects(summaries);
      const saved = JSON.parse(localStorage.getItem(OPEN_PROJECTS_KEY) || 'null') as string[] | null;
      const openIds = saved?.length ? saved : summaries.slice(0, 1).map(p=>p.id);
      setClosedProjectIds(summaries.filter(p=>!openIds.includes(p.id)).map(p=>p.id));
      if (!saved && openIds.length) localStorage.setItem(OPEN_PROJECTS_KEY, JSON.stringify(openIds));
    } catch {}
  }, []);
  useEffect(() => { void refreshProjects(); }, [refreshProjects]);
  useEffect(() => { const open=(event:Event)=>{const detail=(event as CustomEvent).detail;if(detail){setTextEditor(detail);setTextEditorOpen(true)}};window.addEventListener('ai-canvas-open-text-editor',open);return()=>window.removeEventListener('ai-canvas-open-text-editor',open); }, []);
  useEffect(() => {
    if (textEditorAutoClose && !sid) setTextEditorOpen(false);
  }, [sid, textEditorAutoClose]);
  useEffect(() => {
    const close = () => { if (textEditorAutoClose) setTextEditorOpen(false); };
    window.addEventListener('ai-canvas-close-text-editor', close);
    return () => window.removeEventListener('ai-canvas-close-text-editor', close);
  }, [textEditorAutoClose]);
  const updateTextEditor = (value: string) => {
    if (!textEditor) return;
    const store = useCanvasStore.getState();
    const node = store.nodes.find(n => n.id === textEditor.nodeId);
    if (!node) return;
    if (textEditor.kind === 'script') {
      const scriptId = textEditor.field.slice(7);
      const scripts = ((node.data.config?.scripts as Array<{ id: string; label: string; text: string }>) || []).map(item => item.id === scriptId ? { ...item, text: value } : item);
      store.setNodeConfig(node.id, { scripts });
      store.propagateData(node.id, 'script-' + scriptId, value);
    } else {
      store.setNodeConfig(node.id, { [textEditor.field]: value });
      if (textEditor.kind === 'text') store.propagateData(node.id, 'text', value);
    }
    setTextEditor({ ...textEditor, value });
  };
  const refreshTemplates = useCallback(() => {
    try { const r=localStorage.getItem('jacecanvas-canvas-templates'); if(r) setTemplates(JSON.parse(r)); } catch {}
  }, []);
  // 自动保存 + 崩溃恢复提示（启动时挂载）
  useEffect(() => {
    initAutosave();
    setAutosaveContext(activeProjectId || '', useCanvasStore.getState().projectName);
    void (async () => {
      let crashCount = 0;
      try {
        crashCount = (await (window as any).electronAPI?.getCrashCount?.()) || 0;
        if (crashCount > 0) {
          // 优先针对最近编辑的项目恢复（用户崩溃前的工作现场）
          let projects: Array<{ id: string; name?: string }> = [];
          try { projects = await db.projects.orderBy('updatedAt').reverse().toArray(); } catch { /* 忽略 */ }
          const last = projects[0];
          const pid = last?.id || activeProjectId || 'default';
          const pname = last?.name || useCanvasStore.getState().projectName || '未命名项目';
          if (last) setAutosaveContext(pid, pname);
          const data = await restoreAutosave();
          if (data?.nodes?.length) { setRecoverData({ data: data as { nodes: unknown[]; edges: unknown[] }, projectId: pid, projectName: pname }); setRecoverModalOpen(true); }
        }
      } catch { /* 忽略 */ }
      // 无崩溃记录时也恢复上次打开的项目（画布为空才加载，避免覆盖新建内容）
      try {
        if (crashCount === 0) {
          const projects = await db.projects.orderBy('updatedAt').reverse().toArray();
          const last = projects.find(p => p.id && p.canvasData?.nodes?.length);
          if (last && !useCanvasStore.getState().nodes.length) {
            setAutosaveContext(last.id, last.name || '未命名项目');
            useCanvasStore.getState().setProjectName(last.name || '未命名项目');
            useCanvasStore.getState().loadCanvas(last.canvasData.nodes as any, (last.canvasData.edges || []) as any);
          }
        }
      } catch { /* 忽略 */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const handleSave = async () => { setProjectNameInput(useCanvasStore.getState().projectName); await refreshProjects(); setSaveModalOpen(true); };
  const doSave = async () => {
    const { nodes, edges } = useCanvasStore.getState(); const now = Date.now();
    const id = activeProjectId || generateId();
    const old = activeProjectId ? await db.projects.get(activeProjectId) : undefined;
    await db.projects.put({ id, name: projectNameInput || '未命名项目', createdAt: old?.createdAt ?? now, updatedAt: now, canvasData: { nodes, edges }, servers: useSettingsStore.getState().servers });
    const electron = (window as any).electronAPI;
    if (electron?.saveProjectFile) {
      const folder = projectFolder || await electron.chooseProjectFolder();
        if (folder) { const saved = await electron.saveProjectFile({ folder, name: projectNameInput || '未命名项目', nodes, edges }); setProjectFolder(folder); setProjectFilePath(saved?.path || ''); localStorage.setItem('jacecanvas-project-folder', folder); if (saved?.path) localStorage.setItem('jacecanvas-project-file', saved.path); }
    }
    setActiveProjectId(id); useCanvasStore.getState().setProjectName(projectNameInput || '未命名项目');
    setAutosaveContext(id, projectNameInput || '未命名项目'); await flushAutosave();
    await refreshProjects(); message.success('项目已保存'); setSaveModalOpen(false);
  };
  const handleLoad = async () => { await refreshProjects(); setLoadModalOpen(true); };
  const handleOpenFile = async () => { const result = await (window as any).electronAPI?.openProjectFile?.(); if (result?.data?.nodes) { useCanvasStore.getState().loadCanvas(result.data.nodes, result.data.edges || []); const openName = result.data.name || '未命名项目'; useCanvasStore.getState().setProjectName(openName); setProjectFilePath(result.path || ''); if (result.path) { const folder = result.path.replace(/[\\/][^\\/]+$/, ''); setProjectFolder(folder); localStorage.setItem('jacecanvas-project-file', result.path); localStorage.setItem('jacecanvas-project-folder', folder); } const openId = generateId(); setActiveProjectId(openId); setAutosaveContext(openId, openName); message.success('已打开项目文件'); } };
  const doLoad = async (id:string, notify = true) => {
    const p=await db.projects.get(id); if(p){
      setClosedProjectIds(ids => { const next=ids.filter(item => item !== id); const open=projects.filter(item=>!next.includes(item.id)).map(item=>item.id); localStorage.setItem(OPEN_PROJECTS_KEY,JSON.stringify(Array.from(new Set([...open,id])))); return next; });
      useCanvasStore.getState().loadCanvas(p.canvasData.nodes,p.canvasData.edges); useCanvasStore.getState().setProjectName(p.name); setActiveProjectId(id); setAutosaveContext(id, p.name);
      if (p.servers?.length) { const settings = useSettingsStore.getState(); const localIds = new Set(settings.servers.map(s => s.id)); const missing = p.servers.filter(s => !localIds.has(s.id)); if (missing.length) { useSettingsStore.setState({ servers: [...settings.servers, ...missing] as any }); message.info(`已从项目补入 ${missing.length} 个服务器配置`); } }
      void refreshApiNodeFields(p.canvasData.nodes);
      if (notify) message.success('已打开项目：' + p.name);
    }
    setLoadModalOpen(false);
  };
  const saveCurrentSilently = async () => {
    const { nodes, edges, projectName } = useCanvasStore.getState(); const now = Date.now();
    const id = activeProjectId || generateId(); const old = await db.projects.get(id);
    await db.projects.put({ id, name: projectName || '未命名项目', createdAt: old?.createdAt ?? now, updatedAt: now, canvasData: { nodes, edges }, servers: useSettingsStore.getState().servers });
    setActiveProjectId(id); setAutosaveContext(id, projectName || '未命名项目');
    await refreshProjects(); return id;
  };
  const openProject = async (id:string) => { await saveCurrentSilently(); await doLoad(id); };
  const createProject = async () => {
    await saveCurrentSilently();
    const id = generateId(); const now = Date.now();
    await db.projects.put({ id, name: '新项目', createdAt: now, updatedAt: now, canvasData: { nodes: [], edges: [] } });
    useCanvasStore.getState().loadCanvas([], []); useCanvasStore.getState().setProjectName('新项目');
    setActiveProjectId(id); setAutosaveContext(id, '新项目'); await refreshProjects(); message.success('已创建新项目');
    localStorage.setItem(OPEN_PROJECTS_KEY, JSON.stringify(Array.from(new Set([...(JSON.parse(localStorage.getItem(OPEN_PROJECTS_KEY)||'[]') as string[]), id]))));
  };
  const closeProject = async (id: string) => {
    setCloseProjectId(id);
  };
  const finishCloseProject = async (save: boolean) => {
    const id = closeProjectId; if (!id) return;
    if (save && id === activeProjectId) await saveCurrentSilently();
    if (!save) { await db.projects.delete(id); try { await db.projectSnapshots.where('projectId').equals(id).delete(); } catch { /* 忽略 */ } if (id === activeProjectId) setAutosaveContext('', '未命名项目'); }
    const next = projects.find(p => p.id !== id && !closedProjectIds.includes(p.id));
    const nextOpen = projects.filter(p => p.id !== id && !closedProjectIds.includes(p.id)).map(p=>p.id);
    localStorage.setItem(OPEN_PROJECTS_KEY, JSON.stringify(nextOpen));
    if (id === activeProjectId) {
      if (next) await doLoad(next.id, false); else { useCanvasStore.getState().loadCanvas([], []); setActiveProjectId(null); }
    }
    setClosedProjectIds(ids => ids.includes(id) ? ids : [...ids, id]);
    setCloseProjectId(null);
  };
  const handleSaveTemplate = () => { setTemplateName(useCanvasStore.getState().projectName); setTemplateModalOpen(true); };
  const doSaveTemplate = () => {
    const { nodes, edges } = useCanvasStore.getState();
    try {
      const cleanNodes = nodes.map(n => ({ ...n, data: { ...n.data, status: 'idle', error: undefined, progress: undefined, resultUrl: undefined, results: undefined, queuedAt: undefined, queueOrder: undefined, generationStartedAt: undefined, generationDurationMs: undefined } })) as unknown as typeof nodes;
      const ts = JSON.parse(localStorage.getItem('jacecanvas-canvas-templates') || '[]'); ts.push({ id: generateId(), name: templateName || '模板', nodes: cleanNodes, edges, timestamp: Date.now() });
    localStorage.setItem('jacecanvas-canvas-templates', JSON.stringify(ts)); message.success('模板已保存'); setTemplateModalOpen(false);
    } catch { message.error('模板保存失败（内容可能过大）'); }
  };
  const handleLoadTemplate = () => { refreshTemplates(); setLoadTemplateModalOpen(true); };
  const doLoadTemplate = (t: any) => { useCanvasStore.getState().loadCanvas(t.nodes, t.edges); useCanvasStore.getState().setProjectName(t.name || '模板'); setActiveProjectId(null); setAutosaveContext('', t.name || '模板'); void refreshApiNodeFields(t.nodes || []); message.success('已加载模板：' + t.name + '（保存时将另存为新项目）'); setLoadTemplateModalOpen(false); };
  const handleExport = () => {
    const { nodes, edges, projectName } = useCanvasStore.getState();
    const blob=new Blob([JSON.stringify({name:projectName,nodes,edges,servers:useSettingsStore.getState().servers,formatVersion:1,exportedAt:Date.now()},null,2)],{type:'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (projectName || 'workflow') + '.json'; a.click(); message.success('已导出');
  };
  const handleImport = () => fileInputRef.current?.click();
  const onFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { let data: any = null; try { data = JSON.parse(reader.result as string); } catch { message.error('JSON 文件格式错误'); return; } try { if (data && data.nodes) { useCanvasStore.getState().loadCanvas(data.nodes, data.edges || [], { preserveEdgeType: true }); if (data.name) useCanvasStore.getState().setProjectName(data.name); if (data.servers?.length) { const settings = useSettingsStore.getState(); const localIds = new Set(settings.servers.map(s => s.id)); const missing = data.servers.filter((s: any) => !localIds.has(s.id)); if (missing.length) { useSettingsStore.setState({ servers: [...settings.servers, ...missing] as any }); message.success(`已导入，并补入 ${missing.length} 个服务器配置`); } } setActiveProjectId(null); setAutosaveContext('', data.name || '导入项目'); void refreshApiNodeFields(data.nodes); message.success('已导入（保存时将另存为新项目）'); } else { message.error('JSON 文件格式错误'); } } catch { message.error('导入内容无法渲染'); } };
    reader.readAsText(file); e.target.value = '';
  };
  const projectMenu: MenuProps['items'] = [
    { key:'load', label:'加载本地项目', onClick:() => void handleLoad() },
    { key:'open-file', label:'打开项目文件', onClick:() => void handleOpenFile() },
    { key:'history', label:'历史版本', onClick:() => void (async () => { const list = await listSnapshots(); setSnapshots(list.map(s => ({ id: s.id, version: s.version, savedAt: s.savedAt }))); setHistoryModalOpen(true); })() },
    { type:'divider' },
    { key:'save-template', label:'保存为模板', onClick:handleSaveTemplate },
    { key:'load-template', label:'加载模板', onClick:handleLoadTemplate },
    { type:'divider' },
    { key:'export', label:'导出 JSON', onClick:handleExport },
    { key:'import', label:'导入 JSON', onClick:handleImport },
  ];
  const editMenu: MenuProps['items'] = [
    { key:'undo', label:'撤销', extra:'Ctrl+Z', onClick:() => useCanvasStore.getState().undo() },
    { key:'redo', label:'重做', extra:'Ctrl+Shift+Z', onClick:() => useCanvasStore.getState().redo() },
    { type:'divider' },
    { key:'duplicate', label:'复制选中节点', extra:'Ctrl+D', onClick:() => useCanvasStore.getState().duplicateSelectedNode() },
    { key:'delete', label:'删除选中节点', extra:'Delete', onClick:() => useCanvasStore.getState().deleteSelectedNode() },
  ];
  const helpMenu: MenuProps['items'] = [
    { key:'ssh', label:'SSH 性能检测教程', onClick:() => window.open('https://github.com/Nicke000/JaceCanvas', '_blank') },
    { key:'shortcuts', label:'快捷键与操作', onClick:() => window.dispatchEvent(new Event('ai-canvas-open-shortcuts')) },
    { key:'devtools', label:'打开开发者工具', onClick:() => void (window as any).electronAPI?.openDevTools?.() },
    { key:'about', label:'关于 JaceCanvas', onClick:() => window.dispatchEvent(new Event('ai-canvas-open-settings')) },
  ];
  const appMenu = (label: string, items: MenuProps['items']) => <Dropdown menu={{ items }} trigger={['click']} placement="bottomLeft"><Button type="text" size="small" className="app-topbar__menu-button">{label}</Button></Dropdown>;

  return (
    <ConfigProvider locale={zhCN} theme={{algorithm:themeId === 'light' ? theme.defaultAlgorithm : theme.darkAlgorithm,token:{colorPrimary:antdTokens.colorPrimary,borderRadius:antdTokens.borderRadius,colorBgBase:antdTokens.colorBgBase,colorText:antdTokens.colorText,colorBorder:antdTokens.colorBorder,fontFamily:antdTokens.fontFamily}}}>
      <AntApp>
        <ShortcutHelp />
        <FloatingAssistant hidden={chatWindowOpen || dramaStudioOpen} />
        <div className={`app-shell ${historyOpen ? 'history-is-open' : ''}`} style={{'--history-height': `${historyHeight}px`, position:'relative',width:'100vw',height:'100vh',overflow:'hidden',background:'var(--theme-bg)'} as React.CSSProperties}>
          {/* 椤堕儴瀵艰埅鏍?*/}
          <div className="app-topbar">
            <span className="app-topbar__brand"><img src="./icon1.png" alt="" /><span>JaceCanvas</span><em>CREATIVE AI CANVAS</em></span>
             <span className="app-topbar__divider"/>
             <nav className="app-topbar__menus" aria-label="应用菜单">{appMenu('项目', projectMenu)}{appMenu('编辑', editMenu)}{appMenu('帮助', helpMenu)}</nav>
            <Space size={2} className="app-topbar__actions">
              <Button type="text" size="small" icon={<PlaySquareOutlined />} onClick={() => { setDramaStudioOpen(true); setAgentOpen(false); }} className="app-topbar__tool">短剧工作室</Button>
              <Button type="text" size="small" icon={<RobotOutlined />} onClick={() => { setDramaStudioOpen(false); setAgentOpen(v => !v); }} className="app-topbar__tool">DevAgent</Button>
              <Tooltip title="AI 聊天"><Button type="text" size="small" icon={<MessageOutlined />} onClick={() => void openChat()} className="app-topbar__tool">聊天</Button></Tooltip>
              <Tooltip title="执行列表"><Button type="text" size="small" icon={<FieldTimeOutlined />} onClick={() => setTaskQueueOpen(v => !v)} className="app-topbar__tool">执行列表</Button></Tooltip>
              <Tooltip title="生成历史"><Button type="text" size="small" icon={<HistoryOutlined />} onClick={() => setHistoryOpen(v => !v)} className="app-topbar__tool" /></Tooltip>
              {servers.length > 0 && <Dropdown trigger={['click']} menu={{
                items: [
                  ...servers.map(s => ({
                    key: s.id,
                    label: <span className="server-switch-item">{healthDot(s.id)} {s.name || '未命名服务器'}{s.id === (activeServerId || servers[0]?.id) ? ' ✓' : ''}</span>,
                    onClick: () => { setActiveServer(s.id); message.success(`已切换到「${s.name || s.baseUrl}」`); },
                  })),
                  { type: 'divider' },
                  { key: 'srvctl2', label: <><DesktopOutlined /> 服务器控制</>, onClick: () => setServerControlOpen(true) },
                ],
              }}>
                <Tooltip title="切换服务器"><Button type="text" size="small" className="app-topbar__tool"><ClusterOutlined /> {(activeServerId || servers[0]?.id) ? (servers.find(x => x.id === (activeServerId || servers[0]?.id))?.name || '服务器') : '服务器'}</Button></Tooltip>
              </Dropdown>}
              <Tooltip title="显示/隐藏网格"><Button type="text" size="small" icon={<BgColorsOutlined/>} onClick={() => window.dispatchEvent(new Event('ai-canvas-toggle-grid'))} className="app-topbar__tool"/></Tooltip>
              <Tooltip title="显示/隐藏缩略图"><Button type="text" size="small" icon={<AppstoreOutlined/>} onClick={() => window.dispatchEvent(new Event('ai-canvas-toggle-minimap'))} className="app-topbar__tool"/></Tooltip>
              <Tooltip title="一键整理画布"><Button type="text" size="small" icon={<ApartmentOutlined/>} onClick={() => window.dispatchEvent(new Event('ai-canvas-auto-layout'))} className="app-topbar__tool"/></Tooltip>
              <Tooltip title="导出画布截图"><Button type="text" size="small" icon={<CameraOutlined/>} onClick={() => window.dispatchEvent(new Event('ai-canvas-snapshot'))} className="app-topbar__tool"/></Tooltip>
              <Tooltip title="保存项目"><Button type="text" size="small" icon={<SaveOutlined/>} onClick={handleSave} className="app-topbar__tool"/></Tooltip>
              <SettingsButton/>
            </Space>
            <div className="app-topbar__projects">
              <Button type="text" size="small" icon={<PlusOutlined/>} onClick={createProject} title="新建项目" className="app-topbar__new">新建</Button>
              {projects.filter(p => !closedProjectIds.includes(p.id)).map(p => <span key={p.id} className={`project-tab ${p.id===activeProjectId?'is-active':''}`}><Button type="text" size="small" onClick={() => void openProject(p.id)} title={'打开 ' + p.name} className="project-tab__name">{p.name}</Button><Button type="text" size="small" icon={<CloseOutlined/>} onClick={() => setCloseProjectId(p.id)} title="关闭项目" className="project-tab__close"/></span>)}
            </div>
            <span title={projectName} className="topbar-project-name">{projectName}</span>
            {projectFilePath && <span title={projectFilePath} className="topbar-project-path">⌁ {projectFilePath}</span>}
            <span className="topbar-workspace-state"><i/> 稳定工作区 · {nodeCount} 节点</span>
            
             <div style={{flex:1}}/>
             <div className="window-controls" aria-label="窗口控制">
               <button className="window-control window-control--minimize" onClick={() => (window as any).electronAPI?.minimizeWindow?.()} aria-label="最小化">−</button>
               <button className="window-control" onClick={() => (window as any).electronAPI?.toggleMaximizeWindow?.()} aria-label={windowMaximized ? '还原窗口' : '最大化窗口'}>{windowMaximized ? <CompressOutlined /> : <ExpandOutlined />}</button>
               <button className="window-control window-control--close" onClick={() => (window as any).electronAPI?.closeWindow?.()} aria-label="关闭">×</button>
                       
</div>
          </div>
          
          <input ref={fileInputRef} type="file" accept=".json" style={{display:'none'}} onChange={onFileImport}/>
          {/* 淇濆瓨/鍔犺浇寮圭獥 */}
          <Modal title="恢复自动保存" open={recoverModalOpen} onCancel={() => setRecoverModalOpen(false)} onOk={() => { if (recoverData) { useCanvasStore.getState().loadCanvas(recoverData.data.nodes as any, recoverData.data.edges as any); useCanvasStore.getState().setProjectName(recoverData.projectName); setActiveProjectId(recoverData.projectId); setAutosaveContext(recoverData.projectId, recoverData.projectName); message.success('已恢复上次的自动保存'); } setRecoverModalOpen(false); }} okText="恢复画布" cancelText="忽略">
            <p style={{ margin: 0 }}>上次应用异常退出，检测到「{recoverData?.projectName || '未命名项目'}」的自动保存进度（{recoverData?.data?.nodes?.length ?? 0} 个节点）。恢复后建议立即手动保存。</p>
          </Modal>
          <Modal title="历史版本（自动保存快照）" open={historyModalOpen} onCancel={() => setHistoryModalOpen(false)} footer={null}>
            {snapshots.length === 0 ? <p style={{ margin: 0, color: 'var(--theme-muted)' }}>暂无历史版本，画布变化后会自动保存（最多保留 10 个版本）。</p> :
              <div>{snapshots.map(s => <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
                <span style={{ fontSize: 12 }}>{new Date(s.savedAt).toLocaleString()} · v{s.version}</span>
                <Button size="small" type="primary" onClick={() => void (async () => { const data = await restoreSnapshot(s.id); if (data) { useCanvasStore.getState().loadCanvas(data.nodes as any, data.edges as any); setAutosaveContext(activeProjectId || 'default', useCanvasStore.getState().projectName); message.success('已恢复版本 v' + s.version); setHistoryModalOpen(false); } })()}>恢复</Button>
              </div>)}</div>}
          </Modal>
          <Modal title="保存项目" open={saveModalOpen} onCancel={() => setSaveModalOpen(false)} onOk={doSave} okText="保存">
            <Input placeholder="项目名称" value={projectNameInput} onChange={e => setProjectNameInput(e.target.value)} style={{ marginTop: 8 }} />
            <div className="save-location-hint">{projectFolder ? <>保存位置：<b style={{color:'var(--theme-primary)'}}>{projectFolder}</b><br/><small>保存后会生成 .jacecanvas.json 文件，可在下次通过“打开项目文件”继续使用。</small></> : <>首次保存会让你选择项目文件夹，之后会自动保存到该位置。</>}</div>
          </Modal>
          <Modal title="加载项目" open={loadModalOpen} onCancel={() => setLoadModalOpen(false)} footer={null} width={500}>
            {projects.length === 0 && <div style={{ color: 'var(--theme-muted)', textAlign: 'center', padding: 20 }}>暂无已保存项目</div>}
            {projects.map(p=>(
              <div key={p.id} onClick={()=>doLoad(p.id)} style={{padding:'10px 14px',borderRadius:8,cursor:'pointer',border:'1px solid var(--theme-border)',marginBottom:8,display:'flex',justifyContent:'space-between',color:'var(--theme-text)'}}>{p.name}<span style={{fontSize:11,color:'var(--theme-muted)'}}>{new Date(p.updatedAt).toLocaleString()}</span></div>
            ))}
          </Modal>
          <Modal title="关闭项目" open={!!closeProjectId} onCancel={() => setCloseProjectId(null)} footer={<Space><Button onClick={() => setCloseProjectId(null)}>取消</Button><Button danger onClick={() => void finishCloseProject(false)}>不保存关闭</Button><Button type="primary" onClick={() => void finishCloseProject(true)}>保存并关闭</Button></Space>}>
            <div style={{ color: 'var(--theme-muted)' }}>是否保存项目后关闭？项目会同时写入本机项目库和已选择的项目文件夹。</div>
          </Modal>
          <Modal title="保存为模板" open={templateModalOpen} onCancel={() => setTemplateModalOpen(false)} onOk={doSaveTemplate} okText="保存">
            <Input placeholder="模板名称" value={templateName} onChange={e => setTemplateName(e.target.value)} style={{ marginTop: 8 }} />
          </Modal>
          <Modal title="加载模板" open={loadTemplateModalOpen} onCancel={() => setLoadTemplateModalOpen(false)} footer={null} width={500}>
            {templates.length === 0 && <div style={{ color: 'var(--theme-muted)', textAlign: 'center', padding: 20 }}>暂无模板</div>}
            {templates.map(t=>(
              <div key={t.id} onClick={()=>doLoadTemplate(t)} style={{padding:'10px 14px',borderRadius:8,cursor:'pointer',border:'1px solid var(--theme-border)',marginBottom:8,display:'flex',justifyContent:'space-between',color:'var(--theme-text)'}}>{t.name}<span style={{fontSize:11,color:'var(--theme-muted)'}}>{new Date(t.timestamp).toLocaleString()}</span></div>
            ))}
          </Modal>
          {/* 宸︿晶璧勪骇搴?*/}
          <WorkspaceSidebar/>
          {/* 鐢诲竷 */}
          <div className="canvas-stage">
            <Canvas/>
          </div>
          {/* 閰嶇疆闈㈡澘 - 甯搁┗鏄剧ず锛屼笉閬尅鐢诲竷 */}
          <ConfigPanel/>
          {/* 鍙抽敭鑿滃崟 */}
          <ContextMenu/>
          {/* 鐢熸垚鍘嗗彶 */}
          {!chatWindowOpen && !dramaStudioOpen && <GenerationHistory onOpenChange={setHistoryOpen} onHeightChange={setHistoryHeight}/>} 
          {!chatWindowOpen && !dramaStudioOpen && <PerformanceBar compact={historyOpen} />} 
          {!chatWindowOpen && !dramaStudioOpen && <div className="app-uptime" role="status" aria-label="本次启动时长"><FieldTimeOutlined /> 本次已开启 {formatUptime(uptime)}</div>}
          {!chatWindowOpen && !dramaStudioOpen && <div className={'canvas-text-editor ' + (textEditorOpen ? 'is-open' : 'is-collapsed') + (textEditorFullscreen ? ' is-fullscreen' : '')} style={{ bottom: historyOpen ? historyHeight + 16 : 64 }}>
            <Button type="text" className="canvas-text-editor__toggle" onClick={() => setTextEditorOpen(value => !value)} aria-label={textEditorOpen ? '收起文本编辑器' : '展开文本编辑器'}>{textEditorOpen ? '‹' : 'T'}</Button>
            {textEditorOpen && textEditor && <div className="canvas-text-editor__body"><div className="canvas-text-editor__title"><span className="canvas-text-editor__label">{textEditor.label}</span><span className="canvas-text-editor__actions"><Button type="text" size="small" icon={<FullscreenOutlined />} onClick={() => setTextEditorFullscreen(v => !v)} title={textEditorFullscreen ? '退出全屏' : '全屏编辑'} /><Button type="text" size="small" onClick={() => { const value = !textEditorAutoClose; setTextEditorAutoClose(value); localStorage.setItem('ai-canvas-text-editor-auto-close', String(value)); }}>{textEditorAutoClose ? '自动收起' : '手动收起'}</Button></span></div><textarea className="canvas-text-editor__input" autoFocus value={textEditor.value} style={{ height: textEditorHeight }} onChange={e => { updateTextEditor(e.target.value); setTextEditorHeight(Math.max(48, e.target.scrollHeight)); }} /><div className="canvas-text-editor__meta"><span>{textEditor.value.length} 字</span><span className="canvas-text-editor__hint">点击输入区外自动收起</span></div></div>}
          </div>}
          {taskQueueOpen && <TaskQueue onClose={() => setTaskQueueOpen(false)} />}
          <ServerControlPanel open={serverControlOpen} onClose={()=>setServerControlOpen(false)}/>
                    {dramaStudioOpen && <StoryDramaStudio onClose={()=>setDramaStudioOpen(false)}/>}
          <AgentPanel open={agentOpen} onClose={()=>setAgentOpen(false)} />
          {chatWindowOpen && <ChatWindow initialSession={chatSession} onClose={() => { setChatWindowOpen(false); setChatSession(null); }} />}
        </div>
      </AntApp>
    </ConfigProvider>
  );
};

export default App;
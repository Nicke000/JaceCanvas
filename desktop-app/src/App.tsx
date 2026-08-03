import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ConfigProvider, App as AntApp, theme, Button, Tooltip, Space, Input, Modal, message, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import { SaveOutlined, FolderOpenOutlined, ExportOutlined, ImportOutlined, AppstoreOutlined, CopyOutlined, PlusOutlined, CloseOutlined, CloudServerOutlined, UnorderedListOutlined, BgColorsOutlined, ApartmentOutlined, CameraOutlined } from '@ant-design/icons';
import zhCN from 'antd/locale/zh_CN';
import { Canvas } from '@/components/Canvas';
import { ConfigPanel } from '@/components/ConfigPanel';
import { ContextMenu } from '@/components/ContextMenu';
import { SettingsButton } from '@/components/SettingsPanel';
import { WorkspaceSidebar } from '@/components/WorkspaceSidebar';
import { GenerationHistory } from '@/components/GenerationHistory';
import { PerformanceBar } from '@/components/PerformanceBar';
import { useCanvasStore } from '@/stores/canvasStore';
import { db, generateId, loadChatSessions } from '@/utils';
import { ServerControlPanel } from '@/components/ServerControlPanel';
import { StoryAIDirectorDesk } from '@/components/StoryAIDirectorDesk';
import { ThemeSelector } from '@/components/ThemeSelector';
import { TaskQueue } from '@/components/TaskQueue';
import { ChatWindow } from '@/components/ChatWindow';
import type { ChatSession } from '@/types';
import { useThemeStore } from '@/stores/themeStore';

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
  const [directorOpen, setDirectorOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyHeight, setHistoryHeight] = useState(0);
  const [taskQueueOpen, setTaskQueueOpen] = useState(false);
  const [chatWindowOpen, setChatWindowOpen] = useState(false);
  const [chatSession, setChatSession] = useState<ChatSession | null>(null);
  const [textEditor, setTextEditor] = useState<{nodeId:string;field:string;value:string;label:string;kind:'text'|'script'|'scene'}|null>(null);
  const [textEditorOpen, setTextEditorOpen] = useState(false);
  const [textEditorAutoClose, setTextEditorAutoClose] = useState(() => localStorage.getItem('ai-canvas-text-editor-auto-close') !== 'false');
  const [textEditorHeight, setTextEditorHeight] = useState(48);
  const [templateName, setTemplateName] = useState('');
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [uptime, setUptime] = useState(0);
  const [windowMaximized, setWindowMaximized] = useState(false);
  const [loadTemplateModalOpen, setLoadTemplateModalOpen] = useState(false);
  const [templates, setTemplates] = useState<{id:string;name:string;nodes:any;edges:any;timestamp:number}[]>([]);
  const themeId = useThemeStore(s => s.themeId);
  const uiRadius = useThemeStore(s => s.preferences.radius);
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
    try { const r=localStorage.getItem('ai-canvas-templates'); if(r) setTemplates(JSON.parse(r)); } catch {}
  }, []);
  const handleSave = async () => { setProjectNameInput(useCanvasStore.getState().projectName); await refreshProjects(); setSaveModalOpen(true); };
  const doSave = async () => {
    const { nodes, edges } = useCanvasStore.getState(); const now = Date.now();
    const id = activeProjectId || generateId();
    const old = activeProjectId ? await db.projects.get(activeProjectId) : undefined;
    await db.projects.put({ id, name: projectNameInput || '未命名项目', createdAt: old?.createdAt ?? now, updatedAt: now, canvasData: { nodes, edges } });
    const electron = (window as any).electronAPI;
    if (electron?.saveProjectFile) {
      const folder = projectFolder || await electron.chooseProjectFolder();
        if (folder) { const saved = await electron.saveProjectFile({ folder, name: projectNameInput || '未命名项目', nodes, edges }); setProjectFolder(folder); setProjectFilePath(saved?.path || ''); localStorage.setItem('jacecanvas-project-folder', folder); if (saved?.path) localStorage.setItem('jacecanvas-project-file', saved.path); }
    }
    setActiveProjectId(id); useCanvasStore.getState().setProjectName(projectNameInput || '未命名项目');
    await refreshProjects(); message.success('项目已保存'); setSaveModalOpen(false);
  };
  const handleLoad = async () => { await refreshProjects(); setLoadModalOpen(true); };
  const handleOpenFile = async () => { const result = await (window as any).electronAPI?.openProjectFile?.(); if (result?.data?.nodes) { useCanvasStore.getState().loadCanvas(result.data.nodes, result.data.edges || []); useCanvasStore.getState().setProjectName(result.data.name || '未命名项目'); setProjectFilePath(result.path || ''); if (result.path) { const folder = result.path.replace(/[\\/][^\\/]+$/, ''); setProjectFolder(folder); localStorage.setItem('jacecanvas-project-file', result.path); localStorage.setItem('jacecanvas-project-folder', folder); } message.success('已打开项目文件'); } };
  const doLoad = async (id:string, notify = true) => {
    const p=await db.projects.get(id); if(p){
      setClosedProjectIds(ids => { const next=ids.filter(item => item !== id); const open=projects.filter(item=>!next.includes(item.id)).map(item=>item.id); localStorage.setItem(OPEN_PROJECTS_KEY,JSON.stringify(Array.from(new Set([...open,id])))); return next; });
      useCanvasStore.getState().loadCanvas(p.canvasData.nodes,p.canvasData.edges); useCanvasStore.getState().setProjectName(p.name); setActiveProjectId(id); if (notify) message.success('已打开项目：' + p.name);
    }
    setLoadModalOpen(false);
  };
  const saveCurrentSilently = async () => {
    const { nodes, edges, projectName } = useCanvasStore.getState(); const now = Date.now();
    const id = activeProjectId || generateId(); const old = await db.projects.get(id);
    await db.projects.put({ id, name: projectName || '未命名项目', createdAt: old?.createdAt ?? now, updatedAt: now, canvasData: { nodes, edges } });
    setActiveProjectId(id); await refreshProjects(); return id;
  };
  const openProject = async (id:string) => { await saveCurrentSilently(); await doLoad(id); };
  const createProject = async () => {
    await saveCurrentSilently();
    const id = generateId(); const now = Date.now();
    await db.projects.put({ id, name: '新项目', createdAt: now, updatedAt: now, canvasData: { nodes: [], edges: [] } });
    useCanvasStore.getState().loadCanvas([], []); useCanvasStore.getState().setProjectName('新项目');
    setActiveProjectId(id); await refreshProjects(); message.success('已创建新项目');
    localStorage.setItem(OPEN_PROJECTS_KEY, JSON.stringify(Array.from(new Set([...(JSON.parse(localStorage.getItem(OPEN_PROJECTS_KEY)||'[]') as string[]), id]))));
  };
  const closeProject = async (id: string) => {
    setCloseProjectId(id);
  };
  const finishCloseProject = async (save: boolean) => {
    const id = closeProjectId; if (!id) return;
    if (save && id === activeProjectId) await saveCurrentSilently();
    if (!save) await db.projects.delete(id);
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
    const ts = JSON.parse(localStorage.getItem('ai-canvas-templates') || '[]'); ts.push({ id: generateId(), name: templateName || '模板', nodes, edges, timestamp: Date.now() });
    localStorage.setItem('ai-canvas-templates', JSON.stringify(ts)); message.success('模板已保存'); setTemplateModalOpen(false);
  };
  const handleLoadTemplate = () => { refreshTemplates(); setLoadTemplateModalOpen(true); };
  const doLoadTemplate = (t: any) => { useCanvasStore.getState().loadCanvas(t.nodes, t.edges); message.success('已加载模板：' + t.name); setLoadTemplateModalOpen(false); };
  const handleExport = () => {
    const { nodes, edges, projectName } = useCanvasStore.getState();
    const blob=new Blob([JSON.stringify({name:projectName,nodes,edges,exportedAt:Date.now()},null,2)],{type:'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (projectName || 'workflow') + '.json'; a.click(); message.success('已导出');
  };
  const handleImport = () => fileInputRef.current?.click();
  const onFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { try { const data = JSON.parse(reader.result as string); if (data.nodes) { useCanvasStore.getState().loadCanvas(data.nodes, data.edges || []); if (data.name) useCanvasStore.getState().setProjectName(data.name); message.success('已导入'); } } catch { message.error('JSON 文件格式错误'); } };
    reader.readAsText(file); e.target.value = '';
  };
  const projectMenu: MenuProps['items'] = [
    { key:'new', label:'新建项目', onClick:() => void createProject() },
    { key:'save', label:'保存项目', onClick:() => void handleSave() },
    { key:'load', label:'加载本地项目', onClick:() => void handleLoad() },
    { key:'open-file', label:'打开项目文件', onClick:() => void handleOpenFile() },
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
  const viewMenu: MenuProps['items'] = [
    { key:'grid', label:'显示 / 隐藏网格', onClick:() => window.dispatchEvent(new Event('ai-canvas-toggle-grid')) },
    { key:'minimap', label:'显示 / 隐藏缩略图', onClick:() => window.dispatchEvent(new Event('ai-canvas-toggle-minimap')) },
    { key:'history', label:historyOpen ? '收起生成历史' : '打开生成历史', onClick:() => setHistoryOpen(value => !value) },
    { key:'workspace', label:'打开资产 / 节点库', onClick:() => window.dispatchEvent(new Event('ai-canvas-open-node-library')) },
  ];
  const toolsMenu: MenuProps['items'] = [
    { key:'layout', label:'一键整理画布', onClick:() => window.dispatchEvent(new Event('ai-canvas-auto-layout')) },
    { key:'snapshot', label:'导出画布截图', onClick:() => window.dispatchEvent(new Event('ai-canvas-snapshot')) },
    { key:'queue', label:'执行列表', onClick:() => setTaskQueueOpen(value => !value) },
    { key:'server', label:'服务器控制', onClick:() => setServerControlOpen(true) },
    { key:'director', label:'导演台', onClick:() => setDirectorOpen(true) },
    { key:'chat', label:'AI 聊天', onClick:() => void openChat() },
    { type:'divider' },
    { key:'settings', label:'设置', onClick:() => window.dispatchEvent(new Event('ai-canvas-open-settings')) },
    { key:'theme', label:'主题与颜色', onClick:() => window.dispatchEvent(new Event('ai-canvas-open-theme')) },
  ];
  const helpMenu: MenuProps['items'] = [
    { key:'ssh', label:'SSH 性能检测教程', onClick:() => window.open('https://github.com/Nicke000/JaceCanvas', '_blank') },
    { key:'devtools', label:'打开开发者工具', onClick:() => void (window as any).electronAPI?.openDevTools?.() },
    { key:'about', label:'关于 JaceCanvas', onClick:() => window.dispatchEvent(new Event('ai-canvas-open-settings')) },
  ];
  const appMenu = (label: string, items: MenuProps['items']) => <Dropdown menu={{ items }} trigger={['click']} placement="bottomLeft"><Button type="text" size="small" className="app-topbar__menu-button">{label}</Button></Dropdown>;

  return (
    <ConfigProvider locale={zhCN} theme={{algorithm:themeId === 'light' ? theme.defaultAlgorithm : theme.darkAlgorithm,token:{colorPrimary:'var(--theme-primary)',borderRadius:uiRadius === 'small' ? 8 : uiRadius === 'large' ? 16 : 12,colorBgBase:'var(--theme-bg)',colorText:'var(--theme-text)',colorBorder:'var(--theme-border)'}}}>
      <AntApp>
        <div className={`app-shell ${historyOpen ? 'history-is-open' : ''}`} style={{'--history-height': `${historyHeight}px`, position:'relative',width:'100vw',height:'100vh',overflow:'hidden',background:'var(--theme-bg)'} as React.CSSProperties}>
          {/* 椤堕儴瀵艰埅鏍?*/}
          <div className="app-topbar">
            <span className="app-topbar__brand"><img src="./icon1.png" alt="" /><span>JaceCanvas</span><em>CREATIVE AI CANVAS</em></span>
             <span className="app-topbar__divider"/>
             <nav className="app-topbar__menus" aria-label="应用菜单">{appMenu('项目', projectMenu)}{appMenu('编辑', editMenu)}{appMenu('视图', viewMenu)}{appMenu('工具', toolsMenu)}{appMenu('帮助', helpMenu)}</nav>
            <div className="app-topbar__projects">
              <Button type="text" size="small" icon={<PlusOutlined/>} onClick={createProject} title="新建项目" className="app-topbar__new">新建</Button>
              {projects.filter(p => !closedProjectIds.includes(p.id)).map(p => <span key={p.id} className={`project-tab ${p.id===activeProjectId?'is-active':''}`}><Button type="text" size="small" onClick={() => void openProject(p.id)} title={'打开 ' + p.name} className="project-tab__name">{p.name}</Button><Button type="text" size="small" icon={<CloseOutlined/>} onClick={() => setCloseProjectId(p.id)} title="关闭项目" className="project-tab__close"/></span>)}
            </div>
            <span title={projectName} className="topbar-project-name">{projectName}</span>
            {projectFilePath && <span title={projectFilePath} className="topbar-project-path">⌁ {projectFilePath}</span>}
            <span className="topbar-workspace-state"><i/> 稳定工作区 · {nodeCount} 节点</span>
            <div style={{flex:1}}/>
             <Space size={2} className="app-topbar__actions">
              <Tooltip title="显示/隐藏网格"><Button type="text" size="small" icon={<BgColorsOutlined/>} onClick={() => window.dispatchEvent(new Event('ai-canvas-toggle-grid'))} className="app-topbar__tool"/></Tooltip>
              <Tooltip title="显示/隐藏缩略图"><Button type="text" size="small" icon={<AppstoreOutlined/>} onClick={() => window.dispatchEvent(new Event('ai-canvas-toggle-minimap'))} className="app-topbar__tool"/></Tooltip>
              <Tooltip title="一键整理画布"><Button type="text" size="small" icon={<ApartmentOutlined/>} onClick={() => window.dispatchEvent(new Event('ai-canvas-auto-layout'))} className="app-topbar__tool"/></Tooltip>
              <Tooltip title="导出画布截图"><Button type="text" size="small" icon={<CameraOutlined/>} onClick={() => window.dispatchEvent(new Event('ai-canvas-snapshot'))} className="app-topbar__tool"/></Tooltip>
              <Tooltip title="服务器控制"><Button type="text" size="small" icon={<CloudServerOutlined/>} onClick={() => setServerControlOpen(true)} className="app-topbar__tool"/></Tooltip>
              <Button type="text" size="small" icon={<span style={{fontSize:14}}>🎬</span>} onClick={() => setDirectorOpen(true)} className="app-topbar__tool">导演台</Button>
              <Button type="primary" size="small" icon={<span>💬</span>} onClick={() => void openChat()} className="app-topbar__chat">AI聊天</Button>
              <Tooltip title="保存项目"><Button type="text" size="small" icon={<SaveOutlined/>} onClick={handleSave} className="app-topbar__tool"/></Tooltip>
              <Tooltip title="加载项目"><Button type="text" size="small" icon={<FolderOpenOutlined/>} onClick={handleLoad} className="app-topbar__tool"/></Tooltip><Tooltip title="打开项目文件"><Button type="text" size="small" icon={<FolderOpenOutlined/>} onClick={() => void handleOpenFile()} className="app-topbar__tool"/></Tooltip>
              <Tooltip title="保存模板"><Button type="text" size="small" icon={<AppstoreOutlined/>} onClick={handleSaveTemplate} className="app-topbar__tool"/></Tooltip>
              <Tooltip title="加载模板"><Button type="text" size="small" icon={<CopyOutlined/>} onClick={handleLoadTemplate} className="app-topbar__tool"/></Tooltip>
              <Tooltip title="导出 JSON"><Button type="text" size="small" icon={<ExportOutlined/>} onClick={handleExport} className="app-topbar__tool"/></Tooltip>
              <Tooltip title="导入 JSON"><Button type="text" size="small" icon={<ImportOutlined/>} onClick={handleImport} className="app-topbar__tool"/></Tooltip>
              <Tooltip title="执行列表"><Button type="text" size="small" icon={<UnorderedListOutlined/>} onClick={() => setTaskQueueOpen(value => !value)} style={{color: taskQueueOpen ? 'var(--theme-primary)' : 'var(--theme-muted)',fontSize:14}}/></Tooltip>
              <SettingsButton/>
              <ThemeSelector />
            </Space>
             <div className="window-controls" aria-label="窗口控制">
               <button className="window-control window-control--minimize" onClick={() => (window as any).electronAPI?.minimizeWindow?.()} aria-label="最小化">−</button>
               <button className="window-control" onClick={() => (window as any).electronAPI?.toggleMaximizeWindow?.()} aria-label={windowMaximized ? '还原窗口' : '最大化窗口'}>{windowMaximized ? '❐' : '□'}</button>
               <button className="window-control window-control--close" onClick={() => (window as any).electronAPI?.closeWindow?.()} aria-label="关闭">×</button>
             </div>
          </div>
          <input ref={fileInputRef} type="file" accept=".json" style={{display:'none'}} onChange={onFileImport}/>
          {/* 淇濆瓨/鍔犺浇寮圭獥 */}
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
          {!chatWindowOpen && <GenerationHistory onOpenChange={setHistoryOpen} onHeightChange={setHistoryHeight}/>} 
          {!directorOpen && !chatWindowOpen && <PerformanceBar compact={historyOpen} />} 
          {!directorOpen && !chatWindowOpen && <div className="app-uptime" role="status" aria-label="本次启动时长">⏱ 本次已开启 {formatUptime(uptime)}</div>}
          {!chatWindowOpen && <div className={'canvas-text-editor ' + (textEditorOpen ? 'is-open' : 'is-collapsed')} style={{ bottom: historyOpen ? historyHeight + 16 : 64 }}>
            <Button type="text" className="canvas-text-editor__toggle" onClick={() => setTextEditorOpen(value => !value)} aria-label={textEditorOpen ? '收起文本编辑器' : '展开文本编辑器'}>{textEditorOpen ? '‹' : 'T'}</Button>
            {textEditorOpen && textEditor && <div><div className="canvas-text-editor__title">{textEditor.label}<Button type="text" size="small" onClick={() => { const value = !textEditorAutoClose; setTextEditorAutoClose(value); localStorage.setItem('ai-canvas-text-editor-auto-close', String(value)); }}>{textEditorAutoClose ? '自动收起' : '手动收起'}</Button></div><textarea autoFocus value={textEditor.value} style={{ height: textEditorHeight }} onChange={e => { updateTextEditor(e.target.value); setTextEditorHeight(Math.max(48, e.target.scrollHeight)); }} /></div>}
          </div>}
          {taskQueueOpen && <TaskQueue onClose={() => setTaskQueueOpen(false)} />}
          <ServerControlPanel open={serverControlOpen} onClose={()=>setServerControlOpen(false)}/>
          {directorOpen && <StoryAIDirectorDesk onClose={()=>setDirectorOpen(false)}/>}
          {chatWindowOpen && <ChatWindow initialSession={chatSession} onClose={() => { setChatWindowOpen(false); setChatSession(null); }} />}
        </div>
      </AntApp>
    </ConfigProvider>
  );
};

export default App;
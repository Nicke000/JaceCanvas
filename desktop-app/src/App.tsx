import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ConfigProvider, App as AntApp, theme, Button, Tooltip, Space, Input, Modal, message } from 'antd';
import { SaveOutlined, FolderOpenOutlined, ExportOutlined, ImportOutlined, AppstoreOutlined, CopyOutlined, PlusOutlined, CloseOutlined, CloudServerOutlined } from '@ant-design/icons';
import zhCN from 'antd/locale/zh_CN';
import { Canvas } from '@/components/Canvas';
import { Toolbar } from '@/components/Toolbar';
import { ConfigPanel } from '@/components/ConfigPanel';
import { ContextMenu } from '@/components/ContextMenu';
import { SettingsButton } from '@/components/SettingsPanel';
import { AssetLibrary } from '@/components/AssetLibrary';
import { GenerationHistory } from '@/components/GenerationHistory';
import { PerformanceBar } from '@/components/PerformanceBar';
import { useCanvasStore } from '@/stores/canvasStore';
import { db, generateId } from '@/utils';
import { ServerControlPanel } from '@/components/ServerControlPanel';
import { StoryAIDirectorDesk } from '@/components/StoryAIDirectorDesk';

const App: React.FC = () => {
  const OPEN_PROJECTS_KEY = 'jacecanvas-open-projects';
  const sid = useCanvasStore(s => s.selectedNodeId);
  const projectName = useCanvasStore(s => s.projectName);
  const nodeCount = useCanvasStore(s => s.nodes.length);
  const [assetOpen, setAssetOpen] = useState(true);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [loadModalOpen, setLoadModalOpen] = useState(false);
  const [projectNameInput, setProjectNameInput] = useState('');
  const [projects, setProjects] = useState<{id:string;name:string;updatedAt:number}[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [closeProjectId, setCloseProjectId] = useState<string | null>(null);
  const [closedProjectIds, setClosedProjectIds] = useState<string[]>([]);
  const [serverControlOpen, setServerControlOpen] = useState(false);
  const [directorOpen, setDirectorOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [textEditor, setTextEditor] = useState<{nodeId:string;field:string;value:string;label:string;kind:'text'|'script'|'scene'}|null>(null);
  const [textEditorOpen, setTextEditorOpen] = useState(false);
  const [textEditorAutoClose, setTextEditorAutoClose] = useState(() => localStorage.getItem('ai-canvas-text-editor-auto-close') !== 'false');
  const [textEditorHeight, setTextEditorHeight] = useState(48);
  const [templateName, setTemplateName] = useState('');
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [uptime, setUptime] = useState(0);
  const [loadTemplateModalOpen, setLoadTemplateModalOpen] = useState(false);
  const [templates, setTemplates] = useState<{id:string;name:string;nodes:any;edges:any;timestamp:number}[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const appStartedAt = useRef(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setUptime(Date.now() - appStartedAt.current), 1000); return () => window.clearInterval(timer); }, []);
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
    setActiveProjectId(id); useCanvasStore.getState().setProjectName(projectNameInput || '未命名项目');
    await refreshProjects(); message.success('项目已保存'); setSaveModalOpen(false);
  };
  const handleLoad = async () => { await refreshProjects(); setLoadModalOpen(true); };
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

  return (
    <ConfigProvider locale={zhCN} theme={{algorithm:theme.darkAlgorithm,token:{colorPrimary:'#6366f1',borderRadius:8,colorBgBase:'#0f0f1a'}}}>
      <AntApp>
        <div style={{position:'relative',width:'100vw',height:'100vh',overflow:'hidden',background:'#0f0f1a'}}>
          {/* 椤堕儴瀵艰埅鏍?*/}
          <div style={{position:'absolute',top:0,left:0,right:0,height:40,zIndex:20,background:'rgba(17,21,34,.96)',backdropFilter:'blur(18px)',borderBottom:'1px solid #262d40',display:'flex',alignItems:'center',padding:'0 52px 0 12px',gap:10}}>
            <span style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:15,fontWeight:800,background:'linear-gradient(135deg,#6366f1,#a855f7)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',whiteSpace:'nowrap'}}><img src="./icon1.png" alt="" style={{width:20,height:20,objectFit:'contain'}}/>JaceCanvas</span>
            <span style={{width:1,height:16,background:'#30374a'}}/>
            <div style={{display:'flex',alignItems:'center',gap:4,minWidth:0,maxWidth:'42vw',overflowX:'auto'}}>
              <Button type="text" size="small" icon={<PlusOutlined/>} onClick={createProject} title="新建项目" style={{color:'#aaa',flex:'0 0 auto'}}>新建</Button>
              {projects.filter(p => !closedProjectIds.includes(p.id)).map(p => <span key={p.id} className="project-tab" style={{background:p.id===activeProjectId?'#343052':'transparent'}}><Button type="text" size="small" onClick={() => void openProject(p.id)} title={'打开 ' + p.name} style={{color:p.id===activeProjectId?'#fff':'#8f96aa',maxWidth:130,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:'0 0 auto'}}>{p.name}</Button><Button type="text" size="small" icon={<CloseOutlined/>} onClick={() => setCloseProjectId(p.id)} title="关闭项目" style={{color:'#777',padding:'0 3px'}}/></span>)}
            </div>
            <span title={projectName} style={{color:'#a4a4ba',fontSize:11,maxWidth:150,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{projectName}</span>
            <span style={{color:'#565c72',fontSize:10,whiteSpace:'nowrap'}}>{nodeCount} 个节点</span>
            <div style={{flex:1}}/>
            <Space size={2}>
              <Tooltip title="服务器控制"><Button type="text" size="small" icon={<CloudServerOutlined/>} onClick={() => setServerControlOpen(true)} style={{color:'#aaa',fontSize:14}}/></Tooltip>
              <Button type="text" size="small" icon={<span style={{fontSize:14}}>🎬</span>} onClick={() => setDirectorOpen(true)} style={{color:'#aaa'}}>导演台</Button>
              <Tooltip title="保存项目"><Button type="text" size="small" icon={<SaveOutlined/>} onClick={handleSave} style={{color:'#aaa',fontSize:14}}/></Tooltip>
              <Tooltip title="加载项目"><Button type="text" size="small" icon={<FolderOpenOutlined/>} onClick={handleLoad} style={{color:'#aaa',fontSize:14}}/></Tooltip>
              <Tooltip title="保存模板"><Button type="text" size="small" icon={<AppstoreOutlined/>} onClick={handleSaveTemplate} style={{color:'#aaa',fontSize:14}}/></Tooltip>
              <Tooltip title="加载模板"><Button type="text" size="small" icon={<CopyOutlined/>} onClick={handleLoadTemplate} style={{color:'#aaa',fontSize:14}}/></Tooltip>
              <Tooltip title="导出 JSON"><Button type="text" size="small" icon={<ExportOutlined/>} onClick={handleExport} style={{color:'#aaa',fontSize:14}}/></Tooltip>
              <Tooltip title="导入 JSON"><Button type="text" size="small" icon={<ImportOutlined/>} onClick={handleImport} style={{color:'#aaa',fontSize:14}}/></Tooltip>
            </Space>
          </div>
          <input ref={fileInputRef} type="file" accept=".json" style={{display:'none'}} onChange={onFileImport}/>
          {/* 淇濆瓨/鍔犺浇寮圭獥 */}
          <Modal title="保存项目" open={saveModalOpen} onCancel={() => setSaveModalOpen(false)} onOk={doSave} okText="保存">
            <Input placeholder="项目名称" value={projectNameInput} onChange={e => setProjectNameInput(e.target.value)} style={{ marginTop: 8 }} />
          </Modal>
          <Modal title="加载项目" open={loadModalOpen} onCancel={() => setLoadModalOpen(false)} footer={null} width={500}>
            {projects.length === 0 && <div style={{ color: '#888', textAlign: 'center', padding: 20 }}>暂无已保存项目</div>}
            {projects.map(p=>(
              <div key={p.id} onClick={()=>doLoad(p.id)} style={{padding:'10px 14px',borderRadius:8,cursor:'pointer',border:'1px solid #2a2a3e',marginBottom:8,display:'flex',justifyContent:'space-between',color:'#c0c0d0'}}>{p.name}<span style={{fontSize:11,color:'#555'}}>{new Date(p.updatedAt).toLocaleString()}</span></div>
            ))}
          </Modal>
          <Modal title="关闭项目" open={!!closeProjectId} onCancel={() => setCloseProjectId(null)} footer={<Space><Button onClick={() => setCloseProjectId(null)}>取消</Button><Button danger onClick={() => void finishCloseProject(false)}>不保存关闭</Button><Button type="primary" onClick={() => void finishCloseProject(true)}>保存并关闭</Button></Space>}>
            <div style={{ color: '#b7bdd0' }}>是否保存项目后关闭？保存内容写入本机 JaceCanvas 项目库，不会自动生成外部文件。</div>
          </Modal>
          <Modal title="保存为模板" open={templateModalOpen} onCancel={() => setTemplateModalOpen(false)} onOk={doSaveTemplate} okText="保存">
            <Input placeholder="模板名称" value={templateName} onChange={e => setTemplateName(e.target.value)} style={{ marginTop: 8 }} />
          </Modal>
          <Modal title="加载模板" open={loadTemplateModalOpen} onCancel={() => setLoadTemplateModalOpen(false)} footer={null} width={500}>
            {templates.length === 0 && <div style={{ color: '#888', textAlign: 'center', padding: 20 }}>暂无模板</div>}
            {templates.map(t=>(
              <div key={t.id} onClick={()=>doLoadTemplate(t)} style={{padding:'10px 14px',borderRadius:8,cursor:'pointer',border:'1px solid #2a2a3e',marginBottom:8,display:'flex',justifyContent:'space-between',color:'#c0c0d0'}}>{t.name}<span style={{fontSize:11,color:'#555'}}>{new Date(t.timestamp).toLocaleString()}</span></div>
            ))}
          </Modal>
          {/* 宸︿晶璧勪骇搴?*/}
          <AssetLibrary collapsed={!assetOpen} onToggle={()=>setAssetOpen(!assetOpen)}/>
          {/* 宸ュ叿鏍?*/}
          <Toolbar/>
          {/* 璁剧疆 */}
          <SettingsButton/>
          {/* 鐢诲竷 */}
          <div className="canvas-stage" style={{marginTop:40,marginLeft:assetOpen?260:0,marginRight:sid?370:0,height:'calc(100vh - 40px)',transition:'margin 0.2s ease'}}>
            <Canvas/>
          </div>
          {/* 閰嶇疆闈㈡澘 - 甯搁┗鏄剧ず锛屼笉閬尅鐢诲竷 */}
          <ConfigPanel/>
          {/* 鍙抽敭鑿滃崟 */}
          <ContextMenu/>
          {/* 鐢熸垚鍘嗗彶 */}
          <GenerationHistory onOpenChange={setHistoryOpen}/>
          <PerformanceBar compact={historyOpen}/>
          <div className="app-uptime" role="status" aria-label="本次启动时长">⏱ 本次已开启 {formatUptime(uptime)}</div>
          <div className={'canvas-text-editor ' + (textEditorOpen ? 'is-open' : 'is-collapsed')} style={{ bottom: 54 }}>
            <Button type="text" className="canvas-text-editor__toggle" onClick={() => setTextEditorOpen(value => !value)} aria-label={textEditorOpen ? '收起文本编辑器' : '展开文本编辑器'}>{textEditorOpen ? '‹' : 'T'}</Button>
            {textEditorOpen && textEditor && <div><div className="canvas-text-editor__title">{textEditor.label}<Button type="text" size="small" onClick={() => { const value = !textEditorAutoClose; setTextEditorAutoClose(value); localStorage.setItem('ai-canvas-text-editor-auto-close', String(value)); }}>{textEditorAutoClose ? '自动收起' : '手动收起'}</Button></div><textarea autoFocus value={textEditor.value} style={{ height: textEditorHeight }} onChange={e => { updateTextEditor(e.target.value); setTextEditorHeight(Math.max(48, e.target.scrollHeight)); }} /></div>}
          </div>
          <ServerControlPanel open={serverControlOpen} onClose={()=>setServerControlOpen(false)}/>
          {directorOpen && <StoryAIDirectorDesk onClose={()=>setDirectorOpen(false)}/>} 
        </div>
      </AntApp>
    </ConfigProvider>
  );
};

export default App;
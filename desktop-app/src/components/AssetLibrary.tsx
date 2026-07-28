import React, { useState, useEffect, useCallback } from 'react';
import { Input, Button, Segmented, Tooltip, Tag, Upload } from 'antd';
import { PictureOutlined, VideoCameraOutlined, FileTextOutlined, AudioOutlined, SearchOutlined,
  UserOutlined, EnvironmentOutlined, ToolOutlined, BgColorsOutlined, TagsOutlined,
  InboxOutlined, DeleteOutlined, UploadOutlined, EditOutlined, DownloadOutlined } from '@ant-design/icons';
import { useCanvasStore } from '@/stores/canvasStore';
import { downloadMedia } from '@/utils/downloadMedia';

interface AssetItem { id:string; name:string; type:'image'|'video'|'audio'|'text'; url:string; localPath?:string; folder?:string; createdAt:number; category:string; tags:string[]; }

const CATS = [
  { key: 'character', label: '\u4eba\u7269', icon: <UserOutlined/> },
  { key: 'scene', label: '\u573a\u666f', icon: <EnvironmentOutlined/> },
  { key: 'prop', label: '\u9053\u5177', icon: <ToolOutlined/> },
  { key: 'style', label: '\u98ce\u683c', icon: <BgColorsOutlined/> },
  { key: 'custom', label: '\u81ea\u5b9a\u4e49', icon: <TagsOutlined/> },
];
const MTYPES = [
  { key: 'image', icon: <PictureOutlined/> }, { key: 'video', icon: <VideoCameraOutlined/> },
  { key: 'text', icon: <FileTextOutlined/> }, { key: 'audio', icon: <AudioOutlined/> },
];

export const AssetLibrary: React.FC<{ collapsed: boolean; onToggle: () => void }> = ({ collapsed, onToggle }) => {
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [cat, setCat] = useState('character');
  const [mtype, setMtype] = useState('image');
  const [search, setSearch] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [editTagId, setEditTagId] = useState<string|null>(null);
  const [editNameId, setEditNameId] = useState<string|null>(null);
  const [nameInput, setNameInput] = useState('');
  const addNode = useCanvasStore(s => s.addNode);

  useEffect(() => { try { const r=localStorage.getItem('ai-canvas-assets-v2'); if(r) setAssets(JSON.parse(r)); } catch {} }, []);
  const save = (a:AssetItem[]) => { setAssets(a); localStorage.setItem('ai-canvas-assets-v2', JSON.stringify(a)); };

  const filtered = assets.filter(a => a.category===cat && a.type===mtype &&
    (!search || a.name.includes(search) || a.tags.some(t=>t.includes(search))));

  const handleFileDrop = useCallback((e:React.DragEvent) => {
    e.preventDefault();e.stopPropagation();
    const raw=e.dataTransfer.getData('application/ai-asset');
    if(raw){try{const item=JSON.parse(raw) as Partial<AssetItem>;if(item.url&&item.type){
      const asset:AssetItem={id:Date.now().toString(36)+Math.random().toString(36).slice(2),name:item.name||'历史素材',type:item.type,url:item.url,createdAt:Date.now(),category:cat,tags:[]};
      save([asset,...assets]);setMtype(item.type);return;
    }}catch{}}
    const files=e.dataTransfer.files; if(!files.length) return;
    Array.from(files).forEach((file,i) => {
      const r=new FileReader(); r.onload=async()=>{
        const mt=file.type.startsWith('image')?'image':file.type.startsWith('video')?'video':file.type.startsWith('audio')?'audio':'text';
        const preview=r.result as string;
        let localPath=''; let localUrl=preview;
        try { const saved=await (window as any).electronAPI?.saveLocalAsset?.({name:file.name,folder:cat,data:await file.arrayBuffer()}); localPath=saved?.path||''; localUrl=saved?.url||preview; } catch { /* 浏览器开发模式回退为预览 URL */ }
        save([{id:Date.now().toString(36)+Math.random().toString(36).slice(2)+i,name:file.name,
          type:mt as AssetItem['type'],url:localUrl,localPath,folder:cat,createdAt:Date.now(),category:cat,tags:[]} ,...assets]);
      };
      (file.type.startsWith('image')||file.type.startsWith('video')||file.type.startsWith('audio'))?r.readAsDataURL(file):r.readAsText(file);
    });
  },[assets,cat]);

  const addTag = (id:string) => {
    if(!tagInput.trim()){setEditTagId(null);return;}
    save(assets.map(a=>a.id===id?{...a,tags:[...new Set([...a.tags,tagInput.trim()])]}:a));
    setTagInput('');setEditTagId(null);
  };

  const removeTag = (id:string, tag:string) => {
    save(assets.map(a=>a.id===id?{...a,tags:a.tags.filter(t=>t!==tag)}:a));
  };
  const saveAsset = async (asset: AssetItem) => {
    try { await downloadMedia(asset.url, asset.name || `asset-${asset.id}`, asset.type); }
    catch (error) { window.alert(error instanceof Error ? error.message : '保存资产失败，请检查文件地址'); }
  };
  if (collapsed) return (
    <div style={{position:'absolute',left:0,top:130,zIndex:10}}>
      <Tooltip title="资产库"><Button type="text" icon={<PictureOutlined/>}
        onClick={onToggle} style={{background:'#16162add',borderRadius:8,color:'#aaa'}}/></Tooltip>
    </div>
  );
  return (
    <div className="asset-panel" style={{position:'absolute',left:0,top:40,width:260,height:'calc(100vh - 40px)',background:'#16162a',
      borderRight:'1px solid #2a2a3e',zIndex:10,display:'flex',flexDirection:'column'}}>
      <div style={{padding:'10px 12px',borderBottom:'1px solid #2a2a3e',display:'flex',alignItems:'center',gap:8}}>
        <span style={{fontWeight:700,fontSize:13,color:'#e0e0f0',flex:1}}>资产库</span>
        <Upload showUploadList={false} multiple beforeUpload={file => {
          const reader = new FileReader();
          reader.onload = () => {
            const mt = file.type.startsWith('image') ? 'image' : file.type.startsWith('video') ? 'video' : file.type.startsWith('audio') ? 'audio' : 'text';
            save([...assets,{id:Date.now().toString(36)+Math.random().toString(36).slice(2),name:file.name,
              type:mt as AssetItem['type'],url:reader.result as string,createdAt:Date.now(),category:cat,tags:[]}]);
          };
          (file.type.startsWith('image')||file.type.startsWith('video')||file.type.startsWith('audio'))?reader.readAsDataURL(file):reader.readAsText(file);
          return false;
        }}><Button type="text" size="small" icon={<UploadOutlined/>} style={{color:'#888'}}/></Upload>
        <Button type="text" size="small" onClick={onToggle} style={{color:'#888'}}>×</Button>
      </div>
      <div style={{padding:'6px 10px'}}>
        <Input prefix={<SearchOutlined/>} placeholder="搜索..." size="small" value={search}
          onChange={e=>setSearch(e.target.value)} style={{marginBottom:6}}/>
        <Segmented size="small" block options={MTYPES.map(m=>({label:m.icon,value:m.key}))}
          value={mtype} onChange={v=>setMtype(v as string)}/>
      </div>
      <div style={{padding:'4px 10px',display:'flex',gap:3,flexWrap:'wrap'}}>
        {CATS.map(c=>(<Tag key={c.key} color={cat===c.key?'#6366f1':undefined}
          style={{cursor:'pointer',fontSize:11,margin:0,padding:'2px 8px'}}
          onClick={()=>setCat(c.key)}>{c.icon} {c.label}</Tag>))}
      </div>
      <div style={{flex:1,overflow:'auto',padding:'6px'}} onDrop={handleFileDrop} onDragOver={e=>e.preventDefault()}>
        {filtered.length===0&&(<div style={{color:'#555',textAlign:'center',padding:20,fontSize:11,
          border:'1px dashed #2a2a3e',borderRadius:10,margin:4}}>
          <InboxOutlined style={{fontSize:24,marginBottom:8,display:'block'}}/>
          拖拽文件到此处<br/>归入「{CATS.find(c=>c.key===cat)?.label}」
        </div>)}
        {filtered.map(a=>(<div key={a.id} draggable
          onDragStart={e=>{e.dataTransfer.setData('asset-id',a.id);e.dataTransfer.setData('asset-url',a.url||'');e.dataTransfer.setData('application/ai-asset',JSON.stringify({id:a.id,name:a.name,type:a.type,url:a.url}));e.dataTransfer.effectAllowed='copy';}}
          style={{padding:6,borderRadius:8,cursor:'grab',marginBottom:4,border:'1px solid #2a2a3e',
            fontSize:11,color:'#c0c0d0',background:'#1a1a30'}}>
          {a.type==='image'&&a.url ? <img src={a.url} style={{width:'100%',height:90,borderRadius:6,objectFit:'cover',marginBottom:4}} alt=""/> :
           a.type==='video' && a.url ? <video src={a.url} muted playsInline style={{width:'100%',height:90,borderRadius:6,objectFit:'contain',background:'#0f0f1a',marginBottom:4}}/> : a.type==='video' ? <div style={{width:'100%',height:70,borderRadius:6,background:'#0f0f1a',
             display:'flex',alignItems:'center',justifyContent:'center',marginBottom:4}}><VideoCameraOutlined style={{fontSize:24,color:'#555'}}/></div> :
           <div style={{width:'100%',height:50,borderRadius:6,background:'#0f0f1a',
             display:'flex',alignItems:'center',justifyContent:'center',marginBottom:4}}><FileTextOutlined style={{fontSize:20,color:'#555'}}/></div>}
          {editNameId===a.id?<Input size="small" value={nameInput} autoFocus onChange={e=>setNameInput(e.target.value)} onPressEnter={()=>{if(nameInput.trim())save(assets.map(x=>x.id===a.id?{...x,name:nameInput.trim()}:x));setEditNameId(null)}} onBlur={()=>{if(nameInput.trim())save(assets.map(x=>x.id===a.id?{...x,name:nameInput.trim()}:x));setEditNameId(null)}}/>:<div title="双击重命名" onDoubleClick={()=>{setEditNameId(a.id);setNameInput(a.name)}} style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginBottom:3}}>{a.name.length>20?a.name.slice(0,20)+'...':a.name}</div>}
          <div style={{display:'flex',flexWrap:'wrap',gap:2,marginBottom:3}}>
            {a.tags.map(t=>(<Tag key={t} closable style={{fontSize:9,margin:0,padding:'0 4px',lineHeight:'16px'}}
              onClose={e=>{e.preventDefault();removeTag(a.id,t);}}>{t}</Tag>))}
            {editTagId===a.id ? (
              <Input size="small" style={{width:60,height:18,fontSize:9}} value={tagInput}
                onChange={e=>setTagInput(e.target.value)} onPressEnter={()=>addTag(a.id)} onBlur={()=>addTag(a.id)} autoFocus/>
            ) : (<Tag style={{fontSize:9,margin:0,padding:'0 4px',lineHeight:'16px',cursor:'pointer',borderStyle:'dashed'}}
              onClick={()=>setEditTagId(a.id)}>+标签</Tag>)}
          </div>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontSize:9,color:'#555'}}>{new Date(a.createdAt).toLocaleDateString()}</span>
            <span style={{display:'flex',gap:8}}><DownloadOutlined title="保存到本机" style={{fontSize:11,color:'#60a5fa',cursor:'pointer'}} onClick={e=>{e.stopPropagation();void saveAsset(a)}}/><EditOutlined title="重命名" style={{fontSize:11,color:'#747b91',cursor:'pointer'}} onClick={e=>{e.stopPropagation();setEditNameId(a.id);setNameInput(a.name)}}/><DeleteOutlined title="删除" style={{fontSize:11,color:'#747b91',cursor:'pointer'}} onClick={e=>{e.stopPropagation();save(assets.filter(x=>x.id!==a.id));}}/></span>
          </div>
        </div>))}
      </div>
    </div>
  );
};
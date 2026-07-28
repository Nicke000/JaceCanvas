import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, InputNumber, Select, Slider, Space, Tabs, message } from 'antd';
import { CameraOutlined, CloseOutlined, CopyOutlined, DownloadOutlined, PlayCircleOutlined, PlusOutlined, SaveOutlined, UploadOutlined } from '@ant-design/icons';
import { useCanvasStore } from '@/stores/canvasStore';
import { getWorkflowConfig } from '@/config/workflowConfig';
import { DirectorStage3D, type DirectorStage3DHandle, type ActorPose, type PoseSettings, type PropModel, type StageTrajectory, type TrajectoryType } from '@/components/DirectorStage3D';

type Vec3 = [number, number, number];
type Actor = { id: string; name: string; description: string; color: string; pose: ActorPose; poseSettings: PoseSettings; position: Vec3; rotation: number; scale: number };
type Prop = { id: string; name: string; color: string; model: PropModel; position: Vec3; rotation: number; scale: number };
type Keyframe = { id: string; time: number; label: string; actorId: string; position: Vec3; camera: { x:number; y:number; z:number } };
type Shot = { id: string; name: string; duration: number; shotSize: string; movement: string; prompt: string };

const initialActors: Actor[] = [
  { id: 'actor-a', name: '角色A', description: '年轻女性，黑色长发，白色衬衫，蓝色裙子', color: '#4f8cff', pose: 'stand', poseSettings: { torsoPitch: 0, torsoYaw: 0, headPitch: 0, headYaw: 0, leftArm: 0, rightArm: 0, leftLeg: 0, rightLeg: 0 }, position: [-1.2, 0, 0], rotation: 0, scale: 1 },
  { id: 'actor-b', name: '角色B', description: '年轻男性，短黑发，深色夹克', color: '#ef625f', pose: 'stand', poseSettings: { torsoPitch: 0, torsoYaw: 0, headPitch: 0, headYaw: 0, leftArm: 0, rightArm: 0, leftLeg: 0, rightLeg: 0 }, position: [1.2, 0, 0], rotation: 0, scale: 1 },
];
const initialShot: Shot = { id: 'shot-01', name: '镜头 01', duration: 5, shotSize: '中景', movement: '固定镜头', prompt: '' };

function updateVec(value: number | null, index: number, source: Vec3): Vec3 { const next = [...source] as Vec3; next[index] = Number(value || 0); return next; }
function normalizeActor(value: Partial<Actor>, index = 0): Actor { const poses: ActorPose[] = ['stand', 'walk', 'run', 'sit', 'wave']; const source: Partial<PoseSettings> = value.poseSettings || {}; return { id:String(value.id || `actor-${index}`), name:String(value.name || `角色${index+1}`), description:String(value.description || ''), color:String(value.color || '#4f8cff'), pose:poses.includes(value.pose as ActorPose) ? value.pose as ActorPose : 'stand', poseSettings: { torsoPitch:Number(source.torsoPitch)||0, torsoYaw:Number(source.torsoYaw)||0, headPitch:Number(source.headPitch)||0, headYaw:Number(source.headYaw)||0, leftArm:Number(source.leftArm)||0, rightArm:Number(source.rightArm)||0, leftLeg:Number(source.leftLeg)||0, rightLeg:Number(source.rightLeg)||0 }, position:Array.isArray(value.position) ? [Number(value.position[0])||0,Number(value.position[1])||0,Number(value.position[2])||0] : [0,0,0], rotation:Number(value.rotation)||0, scale:Number(value.scale)||1 }; }
function normalizeProp(value: Partial<Prop>, index = 0): Prop { const models: PropModel[] = ['cube', 'sphere', 'cylinder', 'cone', 'capsule']; const model = models.includes(value.model as PropModel) ? value.model as PropModel : 'cube'; return { id:String(value.id || `prop-${index+1}`), name:String(value.name || `道具${index+1}`), color:String(value.color || '#b78b52'), model, position:Array.isArray(value.position) ? [Number(value.position[0])||0,Number(value.position[1])||0,Number(value.position[2])||0] : [0,0,0], rotation:Number(value.rotation)||0, scale:Number(value.scale)||1 }; }
function readList<T>(key:string, fallback:T[], map:(value:any,index:number)=>T): T[] { try { const raw=JSON.parse(localStorage.getItem(key)||'null'); return Array.isArray(raw) ? raw.map(map) : fallback; } catch { return fallback; } }

export const DirectorStudio: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const addNode = useCanvasStore(s => s.addNode);
  const onConnect = useCanvasStore(s => s.onConnect);
  const setSelectedNodeId = useCanvasStore(s => s.setSelectedNodeId);
  const executeNode = useCanvasStore(s => s.executeNode);
  const [actors, setActors] = useState<Actor[]>(() => readList('jace-director-actors', initialActors, normalizeActor));
  const [shot, setShot] = useState<Shot>(() => { try { return JSON.parse(localStorage.getItem('jace-director-shot') || '') || initialShot; } catch { return initialShot; } });
  const [shots, setShots] = useState<Shot[]>(() => readList('jace-director-shots', [initialShot], (value:any,index)=>({ id:String(value?.id||`shot-${index+1}`), name:String(value?.name||`镜头 ${index+1}`), duration:Number(value?.duration)||5, shotSize:String(value?.shotSize||'中景'), movement:String(value?.movement||'固定镜头'), prompt:String(value?.prompt||'') })));
  const [cameraMode, setCameraMode] = useState<'director' | 'camera'>('director');
  const [activeActor, setActiveActor] = useState(() => { try { return JSON.parse(localStorage.getItem('jace-director-active-actor') || '"actor-a"'); } catch { return 'actor-a'; } });
  const [workflow, setWorkflow] = useState('LTX-2.3-4宫格V3短剧');
  const [scene, setScene] = useState('室内场景，柔和的电影光线，地面有轻微反光');
  const [camera, setCamera] = useState({ x: 0, y: 2.2, z: 6, focal: 50, angle: '平视' });
  const [props, setProps] = useState<Prop[]>(() => readList('jace-director-props', [], normalizeProp));
  const [keyframes, setKeyframes] = useState<Keyframe[]>(() => { try { return JSON.parse(localStorage.getItem('jace-director-keyframes') || '[]'); } catch { return []; } });
  const [tool, setTool] = useState<'move'|'rotate'|'scale'>('move');
  const [timelineTime, setTimelineTime] = useState(0);
  const [timelinePlaying, setTimelinePlaying] = useState(false);
  const [panoramaUrl, setPanoramaUrl] = useState<string | undefined>(() => { try { return JSON.parse(localStorage.getItem('jace-director-panorama') || 'null') || undefined; } catch { return undefined; } });
  const [skyColor, setSkyColor] = useState('#060608');
  const [groundOpacity, setGroundOpacity] = useState(0.4);
  const [groundHeight, setGroundHeight] = useState(0);
  const [showTrajectories, setShowTrajectories] = useState(true);
  const [trajectoryType, setTrajectoryType] = useState<TrajectoryType>('circle');
  const [trajectoryTarget, setTrajectoryTarget] = useState('');
  const [trajectories, setTrajectories] = useState<StageTrajectory[]>(() => { try { return JSON.parse(localStorage.getItem('jace-director-trajectories') || '[]'); } catch { return []; } });
  const [selectedTrajectory, setSelectedTrajectory] = useState(0);
  const [drawingFreehand, setDrawingFreehand] = useState(false);
  const [snapshotAspect, setSnapshotAspect] = useState('16:9');
  const stageRef = useRef<DirectorStage3DHandle>(null);
  const actor = actors.find(item => item.id === activeActor) || actors[0] || { id:'actor-empty', name:'未命名角色', description:'', color:'#64748b', position:[0,0,0] as Vec3 };

  useEffect(()=>{ if(!shots.some(item=>item.id===shot.id)) setShot(shots[0] || initialShot); }, [shots, shot.id]);
  useEffect(()=>{ setShots(list=>list.some(item=>item.id===shot.id && JSON.stringify(item)===JSON.stringify(shot)) ? list : list.map(item=>item.id===shot.id?shot:item)); }, [shot]);
  const prompt = useMemo(() => `${actor.description}，${scene}。${shot.shotSize}，${camera.angle}，${shot.movement}，镜头时长 ${shot.duration} 秒。保持人物身份、服装、场景和光线连续。`, [actor, scene, shot, camera]);
  const save = () => { localStorage.setItem('jace-director-actors', JSON.stringify(actors)); localStorage.setItem('jace-director-props', JSON.stringify(props)); localStorage.setItem('jace-director-keyframes', JSON.stringify(keyframes)); localStorage.setItem('jace-director-shot', JSON.stringify(shot)); localStorage.setItem('jace-director-shots', JSON.stringify(shots)); message.success('导演台参数已保存'); };
  const addTrajectory = () => { const targetId = trajectoryTarget || actor.id; setTrajectories(list => [...list, { type: trajectoryType, targetId, position: [0, 0, 0], rotation: 0, scale: 1 }]); message.success('已添加运动轨迹'); };
  const updateTrajectory = (patch: Partial<StageTrajectory>) => setTrajectories(list => list.map((item, index) => index === selectedTrajectory ? { ...item, ...patch } : item));
  const beginFreehand = () => { if (!trajectories[selectedTrajectory] || trajectories[selectedTrajectory].type !== 'freehand') { message.warning('请先选择或添加铅笔路径'); return; } setDrawingFreehand(true); };
  const removeTrajectory = () => { setTrajectories(list => list.filter((_, index) => index !== selectedTrajectory)); setSelectedTrajectory(value => Math.max(0, Math.min(value, trajectories.length - 2))); };
  useEffect(() => { localStorage.setItem('jace-director-trajectories', JSON.stringify(trajectories)); }, [trajectories]);
  const selectActor = (id:string) => { setActiveActor(id); localStorage.setItem('jace-director-active-actor', JSON.stringify(id)); };
  const exportJson = () => { const data = { version: 2, actors, props, keyframes, scene, camera, shot, workflow, prompt }; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); a.download = 'ja-director-shot.json'; a.click(); URL.revokeObjectURL(a.href); };
  const copyPrompt = async () => { await navigator.clipboard?.writeText(prompt); message.success('镜头提示词已复制'); };
  const exportSnapshot = () => { const dataUrl = stageRef.current?.captureSnapshot(snapshotAspect); if (!dataUrl) { message.error('3D 舞台尚未准备好'); return; } const a = document.createElement('a'); a.href = dataUrl; a.download = `ja-director-${snapshotAspect.replace(':', '-')}.png`; a.click(); message.success(`已导出 ${snapshotAspect} 截图`); };
  const setActor = (patch: Partial<Actor>) => setActors(list => list.map(item => item.id === actor.id ? { ...item, ...patch } : item));
  const addKeyframe = () => { const item: Keyframe = { id:`kf-${Date.now()}`, time:timelineTime, label:`关键帧 ${keyframes.length+1}`, actorId:actor.id, position:[...actor.position] as Vec3, camera:{...camera} }; setKeyframes(list=>[...list.filter(k=>k.time!==timelineTime),item].sort((a,b)=>a.time-b.time)); message.success(`已记录 ${timelineTime.toFixed(1)} 秒关键帧`); };
  const restoreKeyframe = (key: Keyframe) => { setTimelineTime(key.time); setCamera(current => ({ ...current, ...key.camera })); setActors(list=>list.map(item=>item.id===key.actorId?{...item,position:[...key.position] as Vec3}:item)); setActiveActor(key.actorId); };
  useEffect(() => { if (!timelinePlaying) return; const timer = window.setInterval(() => setTimelineTime(value => { const next = Number((value + 0.1).toFixed(1)); if (next >= shot.duration) { setTimelinePlaying(false); return shot.duration; } return next; }), 100); return () => window.clearInterval(timer); }, [timelinePlaying, shot.duration]);
  const addShot = () => { const next: Shot = {...shot,id:`shot-${Date.now()}`,name:`镜头 ${shots.length+1}`,prompt:''}; setShots(list=>[...list,next]); setShot(next); setTimelineTime(0); };
  const addProp = (model: PropModel = 'cube') => { const id=`prop-${Date.now()}`; setProps(list=>[...list,{id,name:`道具${list.length+1}`,color:'#b78b52',model,position:[0,0,0],rotation:0,scale:1}]); };
  const removeProp = (id:string) => setProps(list=>list.filter(item=>item.id!==id));
  const updateActor = (id: string, patch: Partial<Actor>) => setActors(list => list.map(item => item.id === id ? { ...item, ...patch } : item));
  const updateProp = (id: string, patch: Partial<Prop>) => setProps(list => list.map(item => item.id === id ? { ...item, ...patch } : item));
  const updateCamera = (patch: Partial<typeof camera>) => setCamera(current => ({ ...current, ...patch }));
  const choosePanorama = () => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { const url = String(reader.result || ''); setPanoramaUrl(url); localStorage.setItem('jace-director-panorama', JSON.stringify(url)); message.success('已接入全景图背景'); };
      reader.readAsDataURL(file);
    };
    input.click();
  };
  const makeSnapshot = () => stageRef.current?.captureSnapshot() || '';
  const createComfyNode = async (execute = false) => {
    const config = getWorkflowConfig(workflow);
    if (!config) { message.error(`工作流“${workflow}”没有可用参数配置，请先刷新工作流目录`); return; }
    const fields = [...config.coreParams, ...config.advancedParams];
    const inputValues: Record<string, unknown> = {};
    const promptFields = fields.filter(field => field.group === 'prompt' && field.type === 'string');
    promptFields.forEach(field => { inputValues[`${field.nodeId}:${field.fieldName}`] = prompt; });
    fields.filter(field => field.fieldName === 'duration' || field.fieldName === 'shot_num_secs').forEach(field => { inputValues[`${field.nodeId}:${field.fieldName}`] = shot.duration; });
    fields.filter(field => field.fieldName === 'fps' || field.fieldName === 'frame_rate').forEach(field => { inputValues[`${field.nodeId}:${field.fieldName}`] = 24; });
    fields.filter(field => field.fieldName === 'filename_prefix').forEach(field => { inputValues[`${field.nodeId}:${field.fieldName}`] = `jace-director-${shot.id}`; });
    const snapshot = makeSnapshot();
    const directorId = addNode('directorStudio', { x: 300, y: 140 }, { label: `JA导演台 · ${shot.name}`, config: { actors, scene, camera, shot, workflow, prompt, snapshot } });
    const nodeId = addNode('apiNode', { x: 720, y: 180 }, { label: `ComfyUI · ${shot.name}`, config: { workflow_id: workflow, _apiName: workflow, _apiFields: fields.map(field => ({ key: `${field.nodeId}:${field.fieldName}`, fileType: undefined })), ...inputValues } });
    onConnect({ source: directorId, target: nodeId, sourceHandle: 'text', targetHandle: 'input' });

    setSelectedNodeId(directorId);
    message.success(`已创建 JA导演台和“${workflow}”节点，可在画布中查看镜头快照并补充参考图`);
    if (execute) { await executeNode(nodeId); }
  };
  return <div className="director-studio">
    <header className="director-header"><div><b>JA导演台</b><span>3D场景 · 角色 · 道具 · 机位 · 分镜 · ComfyUI</span></div><Space><Select size="small" value={snapshotAspect} onChange={setSnapshotAspect} options={['16:9','4:3','1:1','9:16'].map(value => ({ label: `截图 ${value}`, value }))} /><Button icon={<CameraOutlined />} onClick={() => setShowTrajectories(value => !value)}>轨迹</Button><Button icon={<CameraOutlined />} onClick={exportSnapshot}>导出截图</Button><Button icon={<SaveOutlined />} onClick={save}>保存</Button><Button icon={<DownloadOutlined />} onClick={exportJson}>导出镜头</Button><Button type="text" icon={<CloseOutlined />} onClick={onClose} /></Space></header>
    <div className="director-body">
      <aside className="director-sidebar"><div className="director-section-title">场景</div><Input.TextArea value={scene} onChange={e => setScene(e.target.value)} rows={4} placeholder="场景描述" /><div className="director-section-title">镜头列表</div>{shots.map(item=><button key={item.id} className={`director-actor ${shot.id===item.id?'active':''}`} onClick={()=>{setShot(item);setTimelineTime(0)}}>🎞️ {item.name}<small>{item.duration}s</small></button>)}<Button block icon={<PlusOutlined/>} onClick={addShot}>新增镜头</Button>
        <div className="director-section-title">角色</div>{actors.map(item => <button className={`director-actor ${item.id === actor.id ? 'active' : ''}`} key={item.id} onClick={() => selectActor(item.id)}><i style={{ background: item.color }} />{item.name}<small>{item.position[0].toFixed(1)}, {item.position[2].toFixed(1)}</small></button>)}
        <Button block icon={<PlusOutlined />} onClick={() => { const id = `actor-${Date.now()}`; setActors(list => [...list, normalizeActor({ id, name: `角色${list.length + 1}`, description: '新角色', color: '#f59e0b' }, list.length)]); selectActor(id); }}>添加角色</Button>
      </aside>
      <main className="director-stage-wrap"><div className="director-stage-toolbar"><Space><Button type={cameraMode === 'director' ? 'primary' : 'default'} onClick={() => setCameraMode('director')}>导演视角</Button><Button type={cameraMode === 'camera' ? 'primary' : 'default'} icon={<CameraOutlined />} onClick={() => setCameraMode('camera')}>机位视角</Button></Space><span>{cameraMode === 'camera' ? 'CAMERA 01 · 最终构图预览（拖动旋转视角）' : 'DIRECTOR VIEW · 场景布局（拖动物体：鼠标落点即世界位置）'}</span></div>
        <DirectorStage3D ref={stageRef} mode={cameraMode} tool={tool} actors={actors} propsList={props} camera={camera} activeActorId={actor.id} panoramaUrl={panoramaUrl} skyColor={skyColor} groundOpacity={groundOpacity} groundHeight={groundHeight} keyframes={keyframes} showTrajectories={showTrajectories} trajectories={trajectories} drawingTrajectoryIndex={selectedTrajectory} drawingFreehand={drawingFreehand} onFreehandChange={points => updateTrajectory({ points })} onSelectActor={selectActor} onUpdateActor={updateActor} onUpdateProp={updateProp} onUpdateCamera={updateCamera} />
        <div className="director-stage-status"><b>{cameraMode === 'director' ? '布局编辑模式' : '最终构图预览'}</b><span>{cameraMode === 'director' ? '选择角色后可调整姿态；拖拽对象会贴合地面方向。' : '当前仅用于检查构图，返回导演视角编辑角色和道具。'}</span><span>当前角色：{actor.name} · {actors.length} 个角色 · {props.length} 个道具</span></div>
        <div className="director-prompt"><Input.TextArea value={prompt} onChange={e => setShot({ ...shot, prompt: e.target.value })} rows={3} /><Space wrap><Button icon={<CopyOutlined />} onClick={copyPrompt}>复制提示词</Button><Button icon={<PlusOutlined />} onClick={() => void createComfyNode(false)}>创建到画布</Button><Button type="primary" icon={<PlayCircleOutlined />} onClick={() => void createComfyNode(true)}>创建并执行</Button></Space></div>
        <section className="director-timeline-panel"><div className="director-timeline-head"><Space><Button size="small" onClick={() => setTimelinePlaying(value => !value)}>{timelinePlaying ? '暂停' : '播放'}</Button><Button size="small" onClick={() => setTimelineTime(0)}>回到 0 秒</Button><Button size="small" type="primary" onClick={addKeyframe}>记录关键帧</Button><Select size="small" value={trajectoryType} onChange={setTrajectoryType} options={[{label:"圆环路径",value:"circle"},{label:"直线路径",value:"line"},{label:"矩形路径",value:"rectangle"},{label:"铅笔路径",value:"freehand"}]} /><Select size="small" allowClear placeholder="绑定对象" value={trajectoryTarget || undefined} onChange={value => setTrajectoryTarget(value || "")} options={[...actors.map(item => ({label:item.name,value:item.id})), ...props.map(item => ({label:item.name,value:item.id}))]} /><Button size="small" onClick={addTrajectory}>添加轨迹</Button></Space><span>{timelineTime.toFixed(1)} / {shot.duration.toFixed(1)} 秒</span></div><div className="director-timeline-ruler">{Array.from({ length: Math.ceil(shot.duration) + 1 }, (_, index) => <span key={index} style={{ left: `${(index / shot.duration) * 100}%` }}>{index}s</span>)}</div><div className="director-timeline-track"><strong>角色位置</strong><div className="director-timeline-lane" onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setTimelineTime(Number((((event.clientX - rect.left) / rect.width) * shot.duration).toFixed(1))); }}>{keyframes.filter(item => item.actorId === actor.id).map(item => <button key={item.id} className="director-keyframe-dot" style={{ left: `${(item.time / shot.duration) * 100}%` }} title={`${item.time}s`} onClick={event => { event.stopPropagation(); restoreKeyframe(item); }}>◆</button>)}</div></div><input className="director-timeline-scrubber" type="range" min={0} max={shot.duration} step={.1} value={timelineTime} onChange={event => setTimelineTime(Number(event.target.value))} /></section>

      </main>
      <aside className="director-inspector"><Tabs items={[{ key: 'actor', label: '角色', children: <><Space.Compact block><Button type={tool==='move'?'primary':'default'} onClick={()=>setTool('move')}>移动</Button><Button type={tool==='rotate'?'primary':'default'} onClick={()=>setTool('rotate')}>旋转</Button><Button type={tool==='scale'?'primary':'default'} onClick={()=>setTool('scale')}>缩放</Button></Space.Compact><Input value={actor.name} onChange={e => setActor({ name: e.target.value })} addonBefore="名称" style={{marginTop:10}} /><input aria-label="角色颜色" type="color" value={actor.color} onChange={e => setActor({ color: e.target.value })} style={{width:"100%",height:32,marginTop:8}} /><Select style={{width:"100%",marginTop:8}} value={actor.pose} onChange={(value: ActorPose) => setActor({ pose: value })} options={[{label:"站立",value:"stand"},{label:"行走",value:"walk"},{label:"跑步",value:"run"},{label:"坐姿",value:"sit"},{label:"挥手",value:"wave"}]} /><div className="director-section-title">姿势微调</div>{([ ["躯干前倾","torsoPitch"],["躯干转身","torsoYaw"],["头部俯仰","headPitch"],["头部转向","headYaw"],["左臂","leftArm"],["右臂","rightArm"],["左腿","leftLeg"],["右腿","rightLeg"] ] as const).map(([label,key]) => <label key={key} className="director-pose-control">{label}<Slider min={-90} max={90} value={actor.poseSettings[key]} onChange={value => setActor({ poseSettings: { ...actor.poseSettings, [key]: value } })} /></label>)}<Input.TextArea value={actor.description} onChange={e => setActor({ description: e.target.value })} rows={3} style={{ marginTop: 10 }} /><div className="director-section-title">位置 / 旋转 / 缩放</div><Space.Compact block><InputNumber value={actor.position[0]} onChange={v => setActor({ position: updateVec(v, 0, actor.position) })} addonBefore="X" /><InputNumber value={actor.position[1]} onChange={v => setActor({ position: updateVec(v, 1, actor.position) })} addonBefore="Y" /><InputNumber value={actor.position[2]} onChange={v => setActor({ position: updateVec(v, 2, actor.position) })} addonBefore="Z" /></Space.Compact><Space.Compact block style={{marginTop:8}}><InputNumber value={actor.rotation} onChange={v=>setActor({rotation:Number(v||0)})} addonBefore="旋转" /><InputNumber min={.35} max={3} step={.05} value={actor.scale} onChange={v=>setActor({scale:Number(v||1)})} addonBefore="缩放" /></Space.Compact><Button block icon={<PlusOutlined/>} style={{marginTop:10}} onClick={() => addProp("cube")}>添加道具</Button><Select style={{width:"100%",marginTop:8}} value="cube" onChange={(value: PropModel) => addProp(value)} options={[{label:"添加立方体",value:"cube"},{label:"添加球体",value:"sphere"},{label:"添加圆柱体",value:"cylinder"},{label:"添加圆锥体",value:"cone"},{label:"添加胶囊体",value:"capsule"}]} /></> }, { key: 'camera', label: '机位', children: <><Select style={{width:"100%"}} value={shot.shotSize} onChange={v => setShot({ ...shot, shotSize: v })} options={['大远景', '远景', '全景', '中景', '近景', '特写'].map(v => ({ label: v, value: v }))} /><Select style={{width:"100%",marginTop:10}} value={shot.movement} onChange={v => setShot({ ...shot, movement: v })} options={['固定镜头', '缓慢推近', '缓慢拉远', '左移', '右移', '环绕', '跟拍'].map(v => ({ label: v, value: v }))} /><Select style={{width:"100%",marginTop:10}} value={camera.angle} onChange={v => setCamera({ ...camera, angle: v })} options={['平视', '俯拍', '仰拍', '侧拍', '背面'].map(v => ({ label: v, value: v }))} /><div className="director-section-title">焦距 / 时长</div><Space.Compact block><InputNumber value={camera.focal} onChange={v => setCamera({ ...camera, focal: Number(v || 50) })} addonBefore="mm" /><InputNumber min={1} max={60} value={shot.duration} onChange={v => setShot({ ...shot, duration: Number(v || 5) })} addonBefore="秒" /></Space.Compact><div className="director-section-title">时间轴 / 关键帧</div><input className="director-timeline" type="range" min={0} max={shot.duration} step={.1} value={timelineTime} onChange={e=>setTimelineTime(Number(e.target.value))}/><div className="director-timeline-label">{timelineTime.toFixed(1)} / {shot.duration}s · {keyframes.length} 个关键帧</div><Button block onClick={addKeyframe}>记录当前关键帧</Button>{keyframes.map(k=><button className="director-keyframe" key={k.id} onClick={()=>setTimelineTime(k.time)}>◆ {k.time.toFixed(1)}s · {k.label}</button>)}</> }, { key: 'stage', label: '场景', children: <><div className="director-section-title">全景背景</div><Button block icon={<UploadOutlined/>} onClick={choosePanorama}>{panoramaUrl ? '更换全景图' : '上传全景图（等距柱状投影）'}</Button>{panoramaUrl && <Button block danger style={{marginTop:6}} onClick={()=>{setPanoramaUrl(undefined);localStorage.removeItem('jace-director-panorama');}}>移除全景图</Button>}<div className="director-section-title">天空颜色</div><Input type="color" value={skyColor} onChange={e=>setSkyColor(e.target.value)} style={{height:32,padding:2}} /><div className="director-section-title">地面透明度</div><Slider min={0} max={1} step={.05} value={groundOpacity} onChange={setGroundOpacity} /><div className="director-section-title">地面高度</div><Slider min={-2} max={2} step={.1} value={groundHeight} onChange={setGroundHeight} /></> }, { key: 'comfy', label: 'ComfyUI', children: <><Select style={{width:"100%"}} value={workflow} onChange={setWorkflow} options={['LTX-2.3-4宫格V3短剧', 'Ltx2.3动作模仿-图片跳舞-动作迁移', 'Wan2.2 Animate动作迁移真人动作对齐Q版人物（全身动作对齐半身图像）', 'JoyAI-Echo 多镜头连贯视频与音频生成'].map(v => ({ label: v, value: v }))} /><div className="director-help">导演台会生成统一的镜头提示词和参数。当前 ComfyUI 上传、下载、服务器连接和 API 生成仍沿用 JaceCanvas 原有节点链路。</div></> }]} />
    </aside>
    </div>
  </div>;
};
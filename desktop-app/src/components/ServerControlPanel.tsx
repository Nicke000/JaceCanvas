import React, { useCallback, useEffect, useState } from 'react';
import { Button, Input, Modal, Space, Tag, message } from 'antd';
import { CloudServerOutlined, PoweroffOutlined, ReloadOutlined } from '@ant-design/icons';
import { autodlInstanceAction, autodlInstanceList, getComfyControlStatus, getComfyExternalUrl, getComfyVersion, startComfy, stopComfy, type ComfyControlStatus } from '@/services/comfyui.service';

export const ServerControlPanel: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const [status, setStatus] = useState<ComfyControlStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState('');
  const [instances, setInstances] = useState<any[]>([]);
  const [version, setVersion] = useState('');
  const [externalUrl, setExternalUrl] = useState('');
  const refresh = useCallback(async () => { try { setStatus(await getComfyControlStatus()); } catch { setStatus(null); } }, []);
  useEffect(() => { if (!open) return; void refresh(); void getComfyVersion().then(v=>setVersion(String(v.version||v.comfyui_version||''))).catch(()=>{}); void getComfyExternalUrl().then(v=>setExternalUrl(String(v.url||v.externalUrl||''))).catch(()=>{}); const timer = setInterval(refresh, 3000); return () => clearInterval(timer); }, [open, refresh]);
  const run = async (action: () => Promise<any>, text: string) => { setLoading(true); try { await action(); message.success(text); await refresh(); } catch (e) { message.error(e instanceof Error ? e.message : '操作失败'); } finally { setLoading(false); } };
  const loadInstances = async () => { if (!token.trim()) { message.warning('请输入 AutoDL Token'); return; } try { const data = await autodlInstanceList(token.trim()); setInstances(data.list || []); } catch (e) { message.error(e instanceof Error ? e.message : '实例查询失败'); } };
  return <Modal title={<Space><CloudServerOutlined/>服务器与 ComfyUI 控制</Space>} open={open} onCancel={onClose} footer={null} width={620}>
    <div className="server-control-card"><div><b>ComfyUI</b><div className="server-control-muted">{status?.reason || '状态检测中'} {version&&` · ${version}`}</div></div><Tag color={status?.running?'green':status?.starting?'orange':'red'}>{status?.running?'运行中':status?.starting?'启动中':'未运行'}</Tag></div>
    <Space wrap><Button type="primary" icon={<PoweroffOutlined/>} loading={loading} onClick={()=>void run(startComfy,'ComfyUI 启动命令已发送')}>启动 ComfyUI</Button><Button danger loading={loading} onClick={()=>void run(stopComfy,'ComfyUI 停止命令已发送')}>停止 ComfyUI</Button><Button icon={<ReloadOutlined/>} onClick={()=>void refresh()}>刷新状态</Button>{externalUrl&&<Button onClick={()=>window.open(externalUrl,'_blank')}>打开 ComfyUI</Button>}</Space>
    <div className="server-control-divider"/><div style={{fontWeight:700,marginBottom:6}}>AutoDL 实例管理（可选）</div><div className="server-control-muted">Token 仅保存在当前页面内存，不会写入项目或服务器。</div>
    <Space.Compact style={{width:'100%',marginTop:8}}><Input.Password value={token} onChange={e=>setToken(e.target.value)} placeholder="AutoDL Token"/><Button onClick={()=>void loadInstances()}>读取实例</Button></Space.Compact>
    {instances.map(item=><div key={item.instance_uuid} className="server-instance"><span>{item.machine_alias || item.instance_uuid}<small>{item.gpu_name || ''}</small></span><Tag>{item.status}</Tag><Space><Button size="small" disabled={item.status==='running'} onClick={()=>void run(()=>autodlInstanceAction(token,item.instance_uuid,'power_on'),'实例开机命令已发送')}>开机</Button><Button size="small" danger disabled={item.status!=='running'} onClick={()=>void run(()=>autodlInstanceAction(token,item.instance_uuid,'power_off'),'实例关机命令已发送')}>关机</Button></Space></div>)}
  </Modal>;
};
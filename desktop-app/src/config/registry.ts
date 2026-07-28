import type { NodeComponentType, NodeConfig, IOType } from '@/types';
import { M as M1 } from './nodeMeta1';
import { M2 } from './nodeMeta2';
type CE={l:string;i:string;c:string;g:string;w:string;x:string;d:Record<string,unknown>;n:{n:string;l:string;t:string;r?:1;d?:unknown;o?:{l:string;v:string}[]}[];o:{n:string;l:string;t:string}[]};
const RAW:Record<string,CE>={...M1,...M2};
export interface NodeRegistryEntry{type:NodeComponentType;label:string;icon:string;color:string;category:string;comfyClass:string;workflowId:string;description:string;defaultParams:Record<string,unknown>;config:NodeConfig}
function toCfg(e:CE):NodeConfig{return{inputs:e.n.map(p=>({name:p.n,label:p.l,type:(p.t==='image'?'image':p.t==='video'?'video':p.t==='number'?'number':p.t==='select'?'select':'text')as IOType,required:!!p.r,default:p.d,options:p.o?.map(option=>({label:option.l,value:option.v}))})),outputs:e.o.map(p=>({name:p.n,label:p.l,type:p.t as IOType})),params:{}}}
export const NODE_REGISTRY:NodeRegistryEntry[]=Object.entries(RAW).map(([t,e])=>({type:t as NodeComponentType,label:e.l,icon:e.i,color:e.c,category:e.g,comfyClass:e.x,workflowId:e.w,description:e.l,defaultParams:{...e.d},config:toCfg(e)}));
export const NODE_MAP=new Map<NodeComponentType,NodeRegistryEntry>(NODE_REGISTRY.map(e=>[e.type,e]));
export const NODE_CATEGORIES={image:NODE_REGISTRY.filter(e=>e.category==='image'),video:NODE_REGISTRY.filter(e=>e.category==='video'),audio:NODE_REGISTRY.filter(e=>e.category==='audio'),'3d':NODE_REGISTRY.filter(e=>e.category==='3d'),tool:NODE_REGISTRY.filter(e=>e.category==='tool'),ref:NODE_REGISTRY.filter(e=>e.category==='ref')};
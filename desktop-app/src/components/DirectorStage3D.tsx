import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Button, Segmented, Switch, Modal, message } from 'antd';
import { CloseOutlined, CameraOutlined, VideoCameraOutlined, ReloadOutlined, PlusOutlined, DeleteOutlined, CopyOutlined } from '@ant-design/icons';
import { autoSaveToAssets } from '@/utils/generationHistory';
import { useSettingsStore } from '@/stores/settingsStore';
import { getShortcuts, matchShortcut } from '@/utils/shortcuts';
import { Lightbox } from '@/components/Lightbox';
import type { LightboxItem } from '@/components/Lightbox';
import { MediaThumb } from '@/components/MediaThumb';

/**
 * 3D 白模导演台：轻量场景编辑器。搭场景（地面/灯光/物体/人形），摆姿态与机位，
 * 渲染成白模图/视频，作为 AI 图生图/图生视频的构图、姿态、运镜参考，减少抽卡。
 */
type MaterialMode = 'original' | 'white' | 'gray' | 'wireframe';

type Motion = {
  kind: 'orbit' | 'lerp';
  fromPos: THREE.Vector3; toPos: THREE.Vector3;
  fromTarget: THREE.Vector3; toTarget: THREE.Vector3;
  center?: THREE.Vector3; radius?: number; startAngle?: number; endAngle?: number; height?: number;
  startTime: number; duration: number;
  onDone?: () => void;
};

// 骨骼语义推断：从骨骼名启发式映射中文标签（按关节层级从粗到细匹配）
const boneSemantic = (name: string): string => {
  if (!name) return '';
  const n = name.toLowerCase();
  const compact = n.replace(/[_.\s-]/g, '');
  const side = compact.includes('left') || compact.startsWith('l') ? '左' : compact.includes('right') || compact.startsWith('r') ? '右' : '';
  let part = '';
  if (/pelvis|hips|\bhip\b/i.test(n)) part = '髋部';
  else if (/chest/i.test(n)) part = '胸';
  else if (/spine|torso|waist|abdomen|rib/i.test(n)) part = '躯干';
  else if (/neck/i.test(n)) part = '颈';
  else if (/head|skull/i.test(n)) part = '头';
  else if (/shoulder|clavicle/i.test(n)) part = '肩';
  else if (/upperarm/i.test(n)) part = '大臂';
  else if (/forearm|lowerarm/i.test(n)) part = '小臂';
  else if (/elbow/i.test(n)) part = '肘';
  else if (/hand|wrist|finger|thumb|index|middle|ring|pinky/i.test(n)) part = '手';
  else if (/upperleg|thigh/i.test(n)) part = '大腿';
  else if (/lowerleg|shin|calf/i.test(n)) part = '小腿';
  else if (/knee/i.test(n)) part = '膝';
  else if (/foot|toe|ankle|heel/i.test(n)) part = '脚';
  else if (/tail/i.test(n)) part = '尾';
  else if (/wing/i.test(n)) part = '翅';
  else if (/root|master|control|ik|target|pole/i.test(n)) part = '控制';
  return side + part;
};

const boneSemanticKey = (name: string): string => {
  const label = boneSemantic(name);
  return label || name.toLowerCase().replace(/[^a-z0-9]/g, '');
};

// 物体库预设
type PresetKind = 'geometry' | 'humanoid' | 'prop' | 'environment';

// 机位（镜头）：独立的相机视角快照，非场景物体
type CameraShot = { id: string; name: string; pos: [number, number, number]; target: [number, number, number]; targetId?: string };
type PresetDef = { key: string; label: string; kind: PresetKind };
const PRESET_LIBRARY: PresetDef[] = [
  // 人物
  { key: 'humanoid', label: '人物', kind: 'humanoid' },
  { key: 'humanoid-small', label: '小人', kind: 'humanoid' },
  { key: 'humanoid-large', label: '大人', kind: 'humanoid' },
  // 几何体
  { key: 'box', label: '立方体', kind: 'geometry' },
  { key: 'sphere', label: '球体', kind: 'geometry' },
  { key: 'cylinder', label: '圆柱', kind: 'geometry' },
  { key: 'cone', label: '圆锥', kind: 'geometry' },
  { key: 'capsule', label: '胶囊', kind: 'geometry' },
  { key: 'torus', label: '圆环', kind: 'geometry' },
  { key: 'plane', label: '平板', kind: 'geometry' },
  // 道具
  { key: 'table', label: '桌子', kind: 'prop' },
  { key: 'chair', label: '椅子', kind: 'prop' },
  { key: 'sofa', label: '沙发', kind: 'prop' },
  { key: 'bed', label: '床', kind: 'prop' },
  { key: 'bookshelf', label: '书架', kind: 'prop' },
  { key: 'cabinet', label: '柜子', kind: 'prop' },
  { key: 'tv', label: '电视', kind: 'prop' },
  { key: 'lamp', label: '落地灯', kind: 'prop' },
  { key: 'plant', label: '盆栽', kind: 'prop' },
  { key: 'door', label: '门', kind: 'prop' },
  { key: 'window', label: '窗户', kind: 'prop' },
  { key: 'fence', label: '栅栏', kind: 'prop' },
  { key: 'tree', label: '树', kind: 'prop' },
  { key: 'rock', label: '岩石', kind: 'prop' },
  { key: 'pillar', label: '柱子', kind: 'prop' },
  { key: 'stairs', label: '台阶', kind: 'prop' },
  // 环境
  { key: 'room', label: '房间', kind: 'environment' },
  { key: 'stage', label: '舞台', kind: 'environment' },
  { key: 'corridor', label: '走廊', kind: 'environment' },
  { key: 'forest', label: '森林', kind: 'environment' },
];

// 场景对象（运行时）
type SceneObj = {
  id: string; name: string; kind: PresetKind; presetKey: string;
  root: THREE.Object3D;
  material?: THREE.MeshStandardMaterial;
  bones?: THREE.Bone[]; boneNames?: string[];
  castShadow: boolean;
  note?: string;
};

// 关键帧：记录所有对象 transform + 人形骨骼旋转
type Keyframe = {
  time: number;
  objects: Record<string, { pos: [number, number, number]; rot: [number, number, number]; scale: [number, number, number] }>;
  bones: Record<string, [number, number, number]>;
  camera?: { pos: [number, number, number]; target: [number, number, number] };
};

type MotionPath = {
  targetId: string;
  points: Array<[number, number, number]>;
  duration: number;
  startTime: number;
  endTime: number;
  speed: number;
  loop: boolean;
  closed: boolean;
  smooth: boolean;
  autoOrient: boolean;
  turnSmoothing: number;
  gait: 'none' | 'walk' | 'run';
  gaitAmount: number;
};

type FootPlant = { position: THREE.Vector3; last: THREE.Vector3 };

function blendKeyframes(a: Keyframe, b: Keyframe, t: number, time: number): Keyframe {
  const objects: Keyframe['objects'] = {};
  const bones: Keyframe['bones'] = {};
  const objectIds = new Set([...Object.keys(a.objects), ...Object.keys(b.objects)]);
  objectIds.forEach(id => {
    const x = a.objects[id] || b.objects[id], y = b.objects[id] || a.objects[id];
    objects[id] = { pos: x.pos.map((v, i) => v + (y.pos[i] - v) * t) as [number, number, number], rot: x.rot.map((v, i) => v + (y.rot[i] - v) * t) as [number, number, number], scale: x.scale.map((v, i) => v + (y.scale[i] - v) * t) as [number, number, number] };
  });
  const boneKeys = new Set([...Object.keys(a.bones), ...Object.keys(b.bones)]);
  boneKeys.forEach(id => { const x = a.bones[id] || b.bones[id], y = b.bones[id] || a.bones[id]; bones[id] = x.map((v, i) => v + (y[i] - v) * t) as [number, number, number]; });
  return { time, objects, bones, camera: a.camera && b.camera ? { pos: a.camera.pos.map((v, i) => v + (b.camera!.pos[i] - v) * t) as [number, number, number], target: a.camera.target.map((v, i) => v + (b.camera!.target[i] - v) * t) as [number, number, number] } : (t < 0.5 ? a.camera : b.camera) };
}

function sampleMotionPath(path: MotionPath, progress: number) {
  if (path.points.length < 2) return { position: path.points[0] ?? [0, 0, 0] as [number, number, number], tangent: [0, 0, 1] as [number, number, number] };
  const count = path.closed ? path.points.length : path.points.length - 1;
  const t = path.closed ? ((progress % 1) + 1) % 1 : Math.max(0, Math.min(1, progress));
  const scaled = t * count;
  const index = Math.min(count - 1, Math.floor(scaled));
  const amount = scaled - index;
  const next = (index + 1) % path.points.length;
  if (!path.smooth || path.points.length < 3) {
    const position = path.points[index].map((v, axis) => v + (path.points[next][axis] - v) * amount) as [number, number, number];
    const tangent = path.points[next].map((v, axis) => v - path.points[index][axis]) as [number, number, number];
    return { position, tangent };
  }
  const p0 = path.points[path.closed ? (index - 1 + path.points.length) % path.points.length : Math.max(0, index - 1)];
  const p1 = path.points[index], p2 = path.points[next];
  const p3 = path.points[path.closed ? (index + 2) % path.points.length : Math.min(path.points.length - 1, index + 2)];
  const curve = (axis: number) => 0.5 * ((2 * p1[axis]) + (-p0[axis] + p2[axis]) * amount + (2 * p0[axis] - 5 * p1[axis] + 4 * p2[axis] - p3[axis]) * amount ** 2 + (-p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis]) * amount ** 3);
  const derivative = (axis: number) => 0.5 * ((-p0[axis] + p2[axis]) + 2 * (2 * p0[axis] - 5 * p1[axis] + 4 * p2[axis] - p3[axis]) * amount + 3 * (-p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis]) * amount ** 2);
  return { position: [curve(0), curve(1), curve(2)] as [number, number, number], tangent: [derivative(0), derivative(1), derivative(2)] as [number, number, number] };
}

function characterHeight(object: SceneObj): number {
  const box = new THREE.Box3().setFromObject(object.root);
  return Math.max(0.1, box.max.y - box.min.y);
}

function applyFootPlant(object: SceneObj, amount = 0.75) {
  if (!object.bones || amount <= 0) return;
  const footNames = (object.boneNames || []).filter(name => /foot|ankle|toe/i.test(name));
  let lowest = Infinity;
  for (const name of footNames) {
    const bone = object.bones[object.boneNames?.indexOf(name) ?? -1];
    if (!bone) continue;
    const world = new THREE.Vector3(); bone.getWorldPosition(world);
    lowest = Math.min(lowest, world.y);
  }
  if (Number.isFinite(lowest) && lowest < 0.02) object.root.position.y = Math.max(object.root.position.y, object.root.position.y + Math.min(0.02, (0.02 - lowest) * amount));
}

function applyProceduralGait(object: SceneObj, path: MotionPath, elapsed: number) {
  if (!object.bones || path.gait === 'none') return;
  const byName = new Map<string, THREE.Bone>();
  object.bones.forEach((bone, index) => byName.set(object.boneNames?.[index] || bone.name, bone));
  const findBone = (semantic: string) => {
    const exact = byName.get(semantic);
    if (exact) return exact;
    for (const [name, bone] of byName) if (boneSemantic(name) === semantic || boneSemanticKey(name) === semantic) return bone;
    return undefined;
  };
  const amount = Math.max(0, Math.min(1, path.gaitAmount));
  const running = path.gait === 'run';
  const frequency = (running ? 3.1 : 1.8) * Math.max(0.35, Math.min(3, path.speed));
  const cycle = 1 / frequency;
  const phase = ((elapsed % cycle + cycle) % cycle) / cycle * Math.PI * 2;
  const swing = Math.sin(phase) * (running ? 0.72 : 0.48) * amount;
  const swingOpposite = Math.sin(phase + Math.PI) * (running ? 0.72 : 0.48) * amount;
  const arm = Math.sin(phase + Math.PI) * (running ? 0.62 : 0.42) * amount;
  const armOpposite = Math.sin(phase) * (running ? 0.62 : 0.42) * amount;
  const previous = (bone: THREE.Bone, axis: 'x' | 'z') => Number((bone.userData as any)[`directorGait${axis.toUpperCase()}`] || 0);
  const setX = (name: string, value: number) => { const bone = findBone(name); if (bone) { bone.rotation.x -= previous(bone, 'x'); bone.rotation.x += value; (bone.userData as any).directorGaitX = value; } };
  const setZ = (name: string, value: number) => { const bone = findBone(name); if (bone) { bone.rotation.z -= previous(bone, 'z'); bone.rotation.z += value; (bone.userData as any).directorGaitZ = value; } };
  setX('LeftUpperLeg', swing); setX('RightUpperLeg', swingOpposite);
  setX('LeftLowerLeg', Math.max(0, -swing) * (running ? 0.65 : 0.45) * amount);
  setX('RightLowerLeg', Math.max(0, -swingOpposite) * (running ? 0.65 : 0.45) * amount);
  setX('LeftUpperArm', arm); setX('RightUpperArm', armOpposite);
  setX('LeftLowerArm', -arm * 0.35); setX('RightLowerArm', -armOpposite * 0.35);
  setZ('Hips', Math.sin(phase * 2) * (running ? 0.045 : 0.025) * amount);
  setX('Spine', running ? -0.08 * amount : -0.025 * amount);
  setX('Chest', running ? -0.06 * amount : -0.015 * amount);
}

function clearProceduralGait(object: SceneObj) {
  object.bones?.forEach(bone => {
    const data = bone.userData as any;
    const gaitX = Number(data.directorGaitX || 0);
    const gaitZ = Number(data.directorGaitZ || 0);
    if (gaitX) bone.rotation.x -= gaitX;
    if (gaitZ) bone.rotation.z -= gaitZ;
    data.directorGaitX = 0;
    data.directorGaitZ = 0;
  });
}

function applyMotionPath(object: SceneObj, path: MotionPath, elapsed: number) {
  const activeDuration = Math.max(0.1, path.endTime - path.startTime);
  if (elapsed < path.startTime) return;
  const local = elapsed - path.startTime;
  const rawProgress = local / activeDuration;
  const progress = path.loop ? rawProgress % 1 : Math.min(1, rawProgress);
  const current = sampleMotionPath(path, progress);
  const ahead = sampleMotionPath(path, progress + 0.025);
  object.root.position.set(current.position[0], current.position[1], current.position[2]);
  if (path.autoOrient && path.points.length > 1) {
    const tx = ahead.tangent[0] * 0.7 + current.tangent[0] * 0.3;
    const tz = ahead.tangent[2] * 0.7 + current.tangent[2] * 0.3;
    if (Math.hypot(tx, tz) > 0.0001) {
      const yaw = Math.atan2(tx, tz);
      const delta = Math.atan2(Math.sin(yaw - object.root.rotation.y), Math.cos(yaw - object.root.rotation.y));
      object.root.rotation.y += delta * Math.max(0.15, Math.min(1, path.turnSmoothing));
    }
  }
  applyProceduralGait(object, path, elapsed);
  // Foot planting is intentionally omitted during timeline sampling: applying a world-space correction on every frame accumulates drift and corrupts both preview and recording.
}

const MAT = { white: 0xffffff, gray: 0x9aa0a6, wire: 0x88ccff };

// 新物体默认随机彩色（避免默认浅灰蓝看起来像白色）
const PALETTE = ['#e57373', '#64b5f6', '#81c784', '#ffb74d', '#ba68c8', '#4dd0e1', '#f06292', '#aed581', '#ff8a65', '#7986cb'];
const randomColor = () => PALETTE[Math.floor(Math.random() * PALETTE.length)];

// blob → base64 → saveLocalFile 持久化（file:// URL，退出不丢）
async function persistBlob(blob: Blob, filename: string): Promise<string> {
  try {
    const b64 = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error('读取失败'));
      r.readAsDataURL(blob);
    });
    const saved = await (window as any).electronAPI?.saveLocalFile?.({ b64, filename });
    if (saved?.url) return saved.url;
  } catch (e) { console.warn('持久化失败，回退 blob URL', e); }
  return URL.createObjectURL(blob);
}

// 按比例裁剪图片（中心裁剪），ratio 形如 '16:9'，'free' 表示不裁剪
async function cropToRatio(dataUrl: string, ratio: string): Promise<string> {
  if (ratio === 'free') return dataUrl;
  const parts = ratio.split(':').map(Number);
  const target = parts.length === 2 && parts[0] > 0 && parts[1] > 0 ? parts[0] / parts[1] : 0;
  if (!target) return dataUrl;
  return new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.width, h = img.height;
        const cur = w / h;
        let cw = w, ch = h, cx = 0, cy = 0;
        if (cur > target) { cw = Math.round(h * target); cx = Math.round((w - cw) / 2); }
        else { ch = Math.round(w / target); cy = Math.round((h - ch) / 2); }
        const canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(dataUrl); return; }
        ctx.drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);
        resolve(canvas.toDataURL('image/png'));
      } catch { resolve(dataUrl); }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function ratioDimensions(width: number, height: number, ratio: string): { width: number; height: number } {
  if (ratio === 'free') return { width: Math.max(2, Math.round(width)), height: Math.max(2, Math.round(height)) };
  const parts = ratio.split(':').map(Number);
  const target = parts.length === 2 && parts[0] > 0 && parts[1] > 0 ? parts[0] / parts[1] : width / Math.max(1, height);
  const longEdge = target === 1 ? 1080 : 1280;
  const rawWidth = target >= 1 ? longEdge : longEdge * target;
  const rawHeight = target >= 1 ? longEdge / target : longEdge;
  return { width: Math.max(2, Math.round(rawWidth / 2) * 2), height: Math.max(2, Math.round(rawHeight / 2) * 2) };
}

// —— 程序化几何体 ——
function makeGeometry(key: string, mat: THREE.Material): THREE.Object3D {
  const geo = key === 'box' ? new THREE.BoxGeometry(0.5, 0.5, 0.5)
    : key === 'sphere' ? new THREE.SphereGeometry(0.3, 24, 16)
    : key === 'cylinder' ? new THREE.CylinderGeometry(0.25, 0.25, 0.6, 20)
    : key === 'cone' ? new THREE.ConeGeometry(0.3, 0.7, 20)
    : key === 'capsule' ? new THREE.CapsuleGeometry(0.18, 0.4, 4, 12)
    : key === 'torus' ? new THREE.TorusGeometry(0.28, 0.08, 12, 24)
    : new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  if (key === 'plane') mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

// —— 程序化道具 ——
function makeProp(key: string, mat: THREE.Material): THREE.Object3D {
  const g = new THREE.Group();
  const mesh = (geo: THREE.BufferGeometry, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m; };
  const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => mesh(new THREE.BoxGeometry(w, h, d), x, y, z);
  const cyl = (rt: number, rb: number, h: number, x = 0, y = 0, z = 0) => mesh(new THREE.CylinderGeometry(rt, rb, h, 18), x, y, z);
  const ball = (r: number, x = 0, y = 0, z = 0) => mesh(new THREE.SphereGeometry(r, 18, 12), x, y, z);
  const cone = (r: number, h: number, x = 0, y = 0, z = 0) => mesh(new THREE.ConeGeometry(r, h, 18), x, y, z);

  if (key === 'table') { g.add(box(0.9, 0.06, 0.6, 0, 0.5, 0)); g.add(box(0.08, 0.5, 0.08, -0.38, 0.25, -0.24)); g.add(box(0.08, 0.5, 0.08, 0.38, 0.25, -0.24)); g.add(box(0.08, 0.5, 0.08, -0.38, 0.25, 0.24)); g.add(box(0.08, 0.5, 0.08, 0.38, 0.25, 0.24)); }
  else if (key === 'chair') { g.add(box(0.45, 0.06, 0.45, 0, 0.4, 0)); g.add(box(0.45, 0.5, 0.06, 0, 0.65, -0.2)); g.add(box(0.06, 0.4, 0.06, -0.18, 0.2, -0.18)); g.add(box(0.06, 0.4, 0.06, 0.18, 0.2, -0.18)); g.add(box(0.06, 0.4, 0.06, -0.18, 0.2, 0.18)); g.add(box(0.06, 0.4, 0.06, 0.18, 0.2, 0.18)); }
  else if (key === 'sofa') { g.add(box(1.2, 0.24, 0.55, 0, 0.3, 0)); g.add(box(1.2, 0.45, 0.2, 0, 0.6, -0.19)); g.add(box(0.18, 0.34, 0.55, -0.55, 0.42, 0)); g.add(box(0.18, 0.34, 0.55, 0.55, 0.42, 0)); g.add(box(0.14, 0.14, 0.5, -0.42, 0.07, 0)); g.add(box(0.14, 0.14, 0.5, 0.42, 0.07, 0)); }
  else if (key === 'bed') { g.add(box(1.2, 0.22, 1.8, 0, 0.13, 0)); g.add(box(1.24, 0.55, 0.16, 0, 0.48, -0.86)); g.add(box(0.5, 0.12, 0.42, -0.22, 0.27, 0.5)); g.add(box(0.14, 0.2, 1.7, -0.55, 0.1, 0)); g.add(box(0.14, 0.2, 1.7, 0.55, 0.1, 0)); }
  else if (key === 'bookshelf') { g.add(box(0.9, 1.5, 0.25, 0, 0.75, 0)); g.add(box(0.82, 0.04, 0.2, 0, 0.3, 0)); g.add(box(0.82, 0.04, 0.2, 0, 0.75, 0)); g.add(box(0.82, 0.04, 0.2, 0, 1.2, 0)); g.add(box(0.16, 0.24, 0.18, -0.3, 0.42, 0)); g.add(box(0.16, 0.19, 0.18, -0.08, 0.4, 0)); g.add(box(0.16, 0.21, 0.18, 0.12, 0.41, 0)); g.add(box(0.16, 0.18, 0.18, 0.3, 0.4, 0)); g.add(box(0.16, 0.21, 0.18, -0.2, 0.87, 0)); g.add(box(0.16, 0.18, 0.18, 0.06, 0.86, 0)); }
  else if (key === 'cabinet') { g.add(box(0.8, 0.95, 0.42, 0, 0.5, 0)); g.add(box(0.8, 0.03, 0.42, 0, 0.72, 0)); g.add(box(0.1, 0.12, 0.38, -0.3, 0.02, 0)); g.add(box(0.1, 0.12, 0.38, 0.3, 0.02, 0)); }
  else if (key === 'tv') { g.add(box(0.9, 0.55, 0.05, 0, 0.85, 0)); g.add(box(0.4, 0.05, 0.28, 0, 0.55, 0)); g.add(box(0.08, 0.22, 0.08, 0, 0.68, 0)); }
  else if (key === 'lamp') { g.add(box(0.22, 0.05, 0.22, 0, 0.025, 0)); g.add(cyl(0.02, 0.02, 1.3, 0, 0.7, 0)); g.add(cone(0.16, 0.24, 0, 1.4, 0)); }
  else if (key === 'plant') { g.add(cyl(0.12, 0.08, 0.22, 0, 0.11, 0)); g.add(cyl(0.02, 0.02, 0.26, 0, 0.3, 0)); g.add(ball(0.16, 0, 0.44, 0)); g.add(ball(0.1, -0.11, 0.36, 0.07)); g.add(ball(0.1, 0.11, 0.36, -0.07)); }
  else if (key === 'door') {
    g.add(box(0.8, 0.08, 0.1, 0, 1.84, 0)); // 上门框
    g.add(box(0.08, 1.8, 0.1, -0.36, 0.9, 0)); // 左门框（门轴）
    g.add(box(0.08, 1.8, 0.1, 0.36, 0.9, 0)); // 右门框
    // 门板：绕左门轴旋转，默认开 90°（门洞开，可看到门板厚度与门轴）
    const leaf = new THREE.Group();
    leaf.add(box(0.7, 1.78, 0.06, 0.35, 0.9, 0)); // 门板
    leaf.add(box(0.02, 1.1, 0.04, 0.66, 0.9, 0)); // 竖直拉手
    leaf.add(ball(0.03, 0.63, 0.9, 0.04)); // 把手球
    leaf.position.set(-0.36, 0, 0); // 门轴定位到左门框
    leaf.rotation.y = Math.PI / 2; // 门开 90°
    g.add(leaf);
  }
  else if (key === 'window') { g.add(box(0.9, 1.0, 0.05, 0, 1.2, 0)); g.add(box(0.9, 0.05, 0.06, 0, 1.2, 0)); g.add(box(0.05, 1.0, 0.06, 0, 1.2, 0)); }
  else if (key === 'fence') { for (let i = 0; i < 5; i++) g.add(box(0.05, 0.85, 0.05, -0.4 + i * 0.2, 0.425, 0)); g.add(box(0.95, 0.06, 0.04, 0, 0.3, 0)); g.add(box(0.95, 0.06, 0.04, 0, 0.6, 0)); }
  else if (key === 'tree') {
    // 树干：下粗上细，带一点根部
    g.add(cyl(0.1, 0.16, 0.9, 0, 0.42, 0));
    g.add(cyl(0.06, 0.1, 0.7, 0, 1.1, 0));
    // 树冠：多层球体堆叠，蓬松自然（像一棵树而不是圆锥+球）
    g.add(ball(0.5, 0, 1.45, 0));
    g.add(ball(0.4, 0.28, 1.75, 0.05));
    g.add(ball(0.32, -0.24, 1.9, -0.03));
    g.add(ball(0.36, 0.12, 2.05, -0.06));
    g.add(ball(0.24, 0.0, 2.3, 0.02));
  }
  else if (key === 'rock') { const r1 = mesh(new THREE.DodecahedronGeometry(0.32, 0), 0, 0.2, 0); r1.scale.set(1.2, 0.7, 0.9); g.add(r1); const r2 = mesh(new THREE.DodecahedronGeometry(0.18, 0), 0.28, 0.1, 0.12); g.add(r2); }
  else if (key === 'pillar') { g.add(box(0.22, 1.6, 0.22, 0, 0.8, 0)); g.add(box(0.32, 0.08, 0.32, 0, 1.66, 0)); g.add(box(0.32, 0.08, 0.32, 0, 0.04, 0)); }
  else if (key === 'stairs') { for (let i = 0; i < 4; i++) g.add(box(0.9, 0.14, 0.3, 0, 0.07 + i * 0.14, -i * 0.28)); }
  return g;
}

// —— 程序化环境预设（大型组合场景，整体可移动/缩放）——
function makeEnvironment(key: string, mat: THREE.Material): THREE.Object3D {
  const g = new THREE.Group();
  const mesh = (geo: THREE.BufferGeometry, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m; };
  const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => mesh(new THREE.BoxGeometry(w, h, d), x, y, z);
  const cyl = (rt: number, rb: number, h: number, x = 0, y = 0, z = 0) => mesh(new THREE.CylinderGeometry(rt, rb, h, 18), x, y, z);
  const ball = (r: number, x = 0, y = 0, z = 0) => mesh(new THREE.SphereGeometry(r, 18, 12), x, y, z);
  const cone = (r: number, h: number, x = 0, y = 0, z = 0) => mesh(new THREE.ConeGeometry(r, h, 18), x, y, z);

  if (key === 'room') {
    g.add(box(4, 2.7, 0.1, 0, 1.35, -1.95)); // 后墙
    g.add(box(0.1, 2.7, 4, -1.95, 1.35, 0)); // 左墙
    g.add(box(0.1, 2.7, 4, 1.95, 1.35, 0)); // 右墙
    g.add(box(4, 0.1, 4, 0, 2.75, 0)); // 天花板
  } else if (key === 'stage') {
    g.add(box(3.4, 0.35, 2.4, 0, 0.175, 0)); // 平台
    g.add(box(3.6, 2.6, 0.1, 0, 1.5, -1.2)); // 背景板
    g.add(box(0.1, 2.6, 2.4, -1.75, 1.5, 0)); // 左幕
    g.add(box(0.1, 2.6, 2.4, 1.75, 1.5, 0)); // 右幕
  } else if (key === 'corridor') {
    g.add(box(0.1, 2.7, 5, -0.85, 1.35, 0)); // 左墙
    g.add(box(0.1, 2.7, 5, 0.85, 1.35, 0)); // 右墙
    g.add(box(1.7, 0.1, 5, 0, 2.75, 0)); // 天花板
  } else if (key === 'forest') {
    g.add(box(4.2, 0.06, 4.2, 0, 0.03, 0)); // 地面
    const addTree = (x: number, z: number, s: number) => {
      const t = new THREE.Group();
      t.add(cyl(0.07, 0.09, 0.9, 0, 0.45, 0));
      t.add(cone(0.45, 1.1, 0, 1.2, 0));
      t.add(ball(0.3, 0, 1.5, 0));
      t.position.set(x, 0.03, z); t.scale.setScalar(s); g.add(t);
    };
    const addRock = (x: number, z: number, s: number) => {
      const r = mesh(new THREE.DodecahedronGeometry(0.32, 0), x, 0.2, z);
      r.scale.set(1.2 * s, 0.7 * s, 0.9 * s); g.add(r);
    };
    addTree(-1.2, -1, 1); addTree(1.1, 0.6, 1.2); addTree(0.2, -1.4, 0.8);
    addRock(-0.8, 0.9, 1); addRock(1.3, -0.9, 0.8);
  }
  return g;
}

// —— 精细人形（关节球盖接缝 + 分节躯干 + 自然手脚，避免截肢/部位分离）——
function makeHumanoid(mat: THREE.Material): { root: THREE.Object3D; bones: THREE.Bone[] } {
  const limb = (radius: number, length: number) => {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(0.001, length - radius * 2), 4, 12), mat);
    m.position.y = -length / 2; m.castShadow = true; m.receiveShadow = true; return m;
  };
  const ball = (radius: number) => { const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 20, 14), mat); m.castShadow = true; m.receiveShadow = true; return m; };
  const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m; };
  const bone = (name: string) => { const b = new THREE.Bone(); b.name = name; return b; };

  const hips = bone('Hips'); hips.position.set(0, 0.94, 0);
  hips.add(box(0.34, 0.22, 0.26, 0, -0.07, 0)); // 骨盆
  const hipL = ball(0.09); hipL.position.set(-0.095, -0.06, 0); hips.add(hipL); // 左髋关节球
  const hipR = ball(0.09); hipR.position.set(0.095, -0.06, 0); hips.add(hipR); // 右髋关节球

  const spine = bone('Spine'); spine.position.set(0, 0.13, 0); hips.add(spine);
  spine.add(box(0.3, 0.22, 0.22, 0, -0.07, 0)); // 腹部

  const chest = bone('Chest'); chest.position.set(0, 0.24, 0); spine.add(chest);
  chest.add(box(0.4, 0.36, 0.25, 0, -0.03, 0)); // 胸腔
  chest.add(box(0.14, 0.1, 0.2, -0.13, 0.18, 0)); // 左斜方肌
  chest.add(box(0.14, 0.1, 0.2, 0.13, 0.18, 0)); // 右斜方肌
  const shL = ball(0.075); shL.position.set(-0.27, 0.12, 0); chest.add(shL); // 左肩
  const shR = ball(0.075); shR.position.set(0.27, 0.12, 0); chest.add(shR); // 右肩

  const neck = bone('Neck'); neck.position.set(0, 0.2, 0); chest.add(neck);
  neck.add(limb(0.05, 0.12)); // 颈
  const head = bone('Head'); head.position.set(0, 0.11, 0); neck.add(head);
  head.add(ball(0.14)); // 头
  head.add(box(0.14, 0.08, 0.12, 0, -0.12, 0.03)); // 下巴

  // 手臂（肩球盖肩缝、肘球盖肘缝、腕球盖腕缝、手掌自然向下）
  const lUA = bone('LeftUpperArm'); lUA.position.set(-0.27, 0.12, 0); lUA.add(limb(0.06, 0.28)); chest.add(lUA);
  const lLA = bone('LeftLowerArm'); lLA.position.set(0, -0.28, 0); lLA.add(limb(0.05, 0.26)); lUA.add(lLA);
  lLA.add(ball(0.055)); // 左肘球
  const lH = bone('LeftHand'); lH.position.set(0, -0.26, 0); lLA.add(lH);
  lH.add(ball(0.05)); // 左腕球
  lH.add(box(0.07, 0.05, 0.11, 0, -0.03, 0.02)); // 左手掌
  const rUA = bone('RightUpperArm'); rUA.position.set(0.27, 0.12, 0); rUA.add(limb(0.06, 0.28)); chest.add(rUA);
  const rLA = bone('RightLowerArm'); rLA.position.set(0, -0.28, 0); rLA.add(limb(0.05, 0.26)); rUA.add(rLA);
  rLA.add(ball(0.055)); // 右肘球
  const rH = bone('RightHand'); rH.position.set(0, -0.26, 0); rLA.add(rH);
  rH.add(ball(0.05)); // 右腕球
  rH.add(box(0.07, 0.05, 0.11, 0, -0.03, 0.02)); // 右手掌

  // 腿（髋球/膝球/踝球盖接缝，脚掌向前贴地）
  const lUL = bone('LeftUpperLeg'); lUL.position.set(-0.095, -0.06, 0); lUL.add(limb(0.08, 0.42)); hips.add(lUL);
  const lLL = bone('LeftLowerLeg'); lLL.position.set(0, -0.42, 0); lLL.add(limb(0.065, 0.4)); lUL.add(lLL);
  lLL.add(ball(0.07)); // 左膝球
  const lF = bone('LeftFoot'); lF.position.set(0, -0.4, 0); lLL.add(lF);
  lF.add(ball(0.055)); // 左踝球
  lF.add(box(0.09, 0.06, 0.2, 0, -0.03, 0.06)); // 左脚掌（向前）
  const rUL = bone('RightUpperLeg'); rUL.position.set(0.095, -0.06, 0); rUL.add(limb(0.08, 0.42)); hips.add(rUL);
  const rLL = bone('RightLowerLeg'); rLL.position.set(0, -0.42, 0); rLL.add(limb(0.065, 0.4)); rUL.add(rLL);
  rLL.add(ball(0.07)); // 右膝球
  const rF = bone('RightFoot'); rF.position.set(0, -0.4, 0); rLL.add(rF);
  rF.add(ball(0.055)); // 右踝球
  rF.add(box(0.09, 0.06, 0.2, 0, -0.03, 0.06)); // 右脚掌

  const root = new THREE.Group(); root.add(hips);
  const bones = [hips, spine, chest, neck, head, lUA, lLA, lH, rUA, rLA, rH, lUL, lLL, lF, rUL, rLL, rF];
  return { root, bones };
}

/** 删除关键帧后重新归一化 time（第一个帧归 0），避免删除前导帧后进度条/播放从空段开始 */
function normalizeKeyframeTimes(kfs: Keyframe[]): Keyframe[] {
  if (kfs.length <= 1) return kfs;
  const base = kfs[0].time;
  return kfs.map(k => ({ ...k, time: k.time - base }));
}
/** M6 修复：删除前导关键帧导致时间线整体左移时，同步平移 motionPaths 的 startTime/endTime/duration（夹到 ≥0），
 *  否则人物路径仍从旧绝对时间开始，与关键帧脱节（角色先原地站再走路） */
function shiftMotionPathsForKeyframes(paths: MotionPath[], oldFirstTime: number, newFirstTime: number): MotionPath[] {
  if (paths.length === 0 || oldFirstTime <= 0) return paths;
  const shift = Math.max(0, oldFirstTime - newFirstTime);
  if (shift <= 0) return paths;
  return paths.map(p => {
    const startTime = Math.max(0, p.startTime - shift);
    const endTime = Math.max(0, p.endTime - shift);
    return { ...p, startTime, endTime, duration: Math.max(0.01, endTime - startTime) };
  });
}

export const DirectorStage3D: React.FC<{ url?: string; onClose: () => void }> = ({ url, onClose }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const transformControlsRef = useRef<TransformControls | null>(null);
  const groundRef = useRef<THREE.Mesh | null>(null);
  const keyLightRef = useRef<THREE.DirectionalLight | null>(null);
  const ambLightRef = useRef<THREE.AmbientLight | null>(null);
  const objectsRef = useRef<SceneObj[]>([]);
  const selectedIdRef = useRef<string>('');
  const motionRef = useRef<Motion | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  // M3 修复：运镜录制开始时保存现有时间线快照；录制太短/取消时恢复，不再无条件清空用户已有动画
  const preCamKeyframesRef = useRef<Keyframe[] | null>(null);
  // H4 修复：录制动画的停止定时器句柄，卸载/新录制时 clearTimeout，避免旧 timeout 到期后杀掉下一次录制
  const recordTimeoutRef = useRef<number | null>(null);
  const recordingOutputSizeRef = useRef<{ width: number; height: number } | null>(null);
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const pointerRef = useRef<THREE.Vector2>(new THREE.Vector2());

  const [materialMode, setMaterialMode] = useState<MaterialMode>('original');
  // 顶栏展开区：光影/运镜速度面板 + 素材小窗
  const [showTopPanel, setShowTopPanel] = useState(false);
  const [showAssetsPanel, setShowAssetsPanel] = useState(false);
  const [showModelLibrary, setShowModelLibrary] = useState(false);
  const [gizmoMode, setGizmoMode] = useState<'translate' | 'rotate' | 'scale'>('translate');
  const [gizmoEnabled, setGizmoEnabled] = useState(true);
  const [viewMode, setViewMode] = useState<'free' | 'character'>('free');
  const [characterTarget, setCharacterTarget] = useState('');
  const [lightKey, setLightKey] = useState(1.6);
  const [lightAmb, setLightAmb] = useState(0.35);
  const [bgColor, setBgColor] = useState('#1a1f2a');
  const [lightPos, setLightPos] = useState({ x: 4, y: 6, z: 3 });
  const [selColor, setSelColor] = useState('#dfe6ec');
  const [objects, setObjects] = useState<Array<{ id: string; name: string; kind: PresetKind; note: string }>>([]);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [sceneName, setSceneName] = useState('');
  const [savedScenes, setSavedScenes] = useState<Array<{ name: string; time: number }>>([]);
  const [selectedId, setSelectedId] = useState('');
  const [selTransform, setSelTransform] = useState({ px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 });
  const [loaded, setLoaded] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [recording, setRecording] = useState(false);
  const recordingRef = useRef(false);
  useEffect(() => { recordingRef.current = recording; }, [recording]);
  const [recordedUrl, setRecordedUrl] = useState('');
  // 最近一次截图/录制的成品（用于「发送到画布」）
  const [lastMedia, setLastMedia] = useState<{ type: 'image' | 'video'; url: string; name: string } | null>(null);
  // 导演台素材库：截图/录制的历史成品，支持查看/删除/备注
  const [directorAssets, setDirectorAssets] = useState<Array<{ id: string; type: 'image' | 'video'; url: string; name: string; note: string; time: number }>>([]);
  const [previewItem, setPreviewItem] = useState<LightboxItem | null>(null);
  // 素材库持久化：启动时加载，变化时保存（file:// 磁盘文件永久有效）
  useEffect(() => {
    try { setDirectorAssets(JSON.parse(localStorage.getItem('director3d-assets') || '[]')); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem('director3d-assets', JSON.stringify(directorAssets)); } catch { /* ignore */ }
  }, [directorAssets]);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [posePrompt, setPosePrompt] = useState('');
  const [poseLoading, setPoseLoading] = useState(false);
  const [boneNames, setBoneNames] = useState<string[]>([]);
  const [boneLabels, setBoneLabels] = useState<string[]>([]);
  // 展开骨骼：每个骨骼的实时旋转值 + 折叠状态
  const [boneRots, setBoneRots] = useState<Record<string, [number, number, number]>>({});
  const [collapsedBones, setCollapsedBones] = useState<Record<string, boolean>>({});
  // 关键帧时间轴
  const [keyframes, setKeyframes] = useState<Keyframe[]>([]);
  const [motionPaths, setMotionPaths] = useState<MotionPath[]>([]);
  const historyRef = useRef<Array<{ keyframes: Keyframe[]; motionPaths: MotionPath[] }>>([]);
  const historyIndexRef = useRef(-1);
  const historyReadyRef = useRef(false);
  const historySkipRef = useRef(false);
  type ActionClip = { id: string; name: string; keyframes: Keyframe[]; duration: number; createdAt: number; sourceTargetId?: string; sourceBoneSemantics?: Record<string, string>; customBoneMap?: Record<string, string>; sourceHeight?: number; };
  const [actionClips, setActionClips] = useState<ActionClip[]>([]);
  const [clipIncludeCamera, setClipIncludeCamera] = useState(false);
  const [clipLoopCount, setClipLoopCount] = useState(1);
  const [clipBlendSeconds, setClipBlendSeconds] = useState(0.15);
  const [previewClipId, setPreviewClipId] = useState('');
  const [retargetScale, setRetargetScale] = useState(true);
  const [editingClipMapId, setEditingClipMapId] = useState('');
  const [clipMapDraft, setClipMapDraft] = useState('');
  useEffect(() => { try { setActionClips(JSON.parse(localStorage.getItem('director3d-action-clips') || '[]')); } catch { /* ignore */ } }, []);
  useEffect(() => { try { localStorage.setItem('director3d-action-clips', JSON.stringify(actionClips)); } catch { /* ignore */ } }, [actionClips]);
  const timelineClipboardRef = useRef<{ kind: 'keyframes' | 'path'; keyframes?: Keyframe[]; path?: MotionPath } | null>(null);
  useEffect(() => {
    const snapshot = { keyframes: JSON.parse(JSON.stringify(keyframes)) as Keyframe[], motionPaths: JSON.parse(JSON.stringify(motionPaths)) as MotionPath[] };
    if (!historyReadyRef.current) {
      historyRef.current = [snapshot]; historyIndexRef.current = 0; historyReadyRef.current = true; return;
    }
    if (historySkipRef.current) { historySkipRef.current = false; return; }
    const current = historyRef.current[historyIndexRef.current];
    if (current && JSON.stringify(current) === JSON.stringify(snapshot)) return;
    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1).concat(snapshot).slice(-50);
    historyIndexRef.current = historyRef.current.length - 1;
  }, [keyframes, motionPaths]);
  const motionPathsRef = useRef<MotionPath[]>([]);
  useEffect(() => { motionPathsRef.current = motionPaths; }, [motionPaths]);
  const [pathEditMode, setPathEditMode] = useState(false);
  const [activePathTargetId, setActivePathTargetId] = useState('');
  const pathEditModeRef = useRef(false);
  const activePathTargetRef = useRef('');
  const pathVisualGroupRef = useRef<THREE.Group | null>(null);
  const pathDragRef = useRef<{ index: number } | null>(null);
  useEffect(() => { pathEditModeRef.current = pathEditMode; }, [pathEditMode]);
  useEffect(() => { activePathTargetRef.current = activePathTargetId; }, [activePathTargetId]);
  useEffect(() => {
    const group = pathVisualGroupRef.current;
    if (!group) return;
    while (group.children.length) {
      const child = group.children.pop();
      if (child) { child.traverse(node => { const mesh = node as THREE.Mesh; mesh.geometry?.dispose(); if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose()); else (mesh.material as THREE.Material)?.dispose(); }); }
    }
    group.visible = !recording && pathEditMode;
    if (!group.visible) return;
    motionPaths.forEach(path => {
      if (!path.points.length) return;
      const active = path.targetId === activePathTargetId;
      const color = active ? 0xf59e0b : 0x60a5fa;
      const points = path.points.map(point => new THREE.Vector3(point[0], 0.025, point[2]));
      if (path.closed && points.length > 1) points.push(points[0].clone());
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color, transparent: true, opacity: active ? 0.95 : 0.4 })));
      path.points.forEach((point, index) => {
        const marker = new THREE.Mesh(new THREE.SphereGeometry(active ? 0.085 : 0.055, 12, 8), new THREE.MeshBasicMaterial({ color }));
        marker.position.set(point[0], 0.06, point[2]);
        marker.userData = { pathTargetId: path.targetId, pathIndex: index };
        marker.visible = active || pathEditMode;
        group.add(marker);
      });
    });
    return () => { /* next render disposes the temporary path helpers */ };
  }, [motionPaths, pathEditMode, activePathTargetId, recording]);
  const [playing, setPlaying] = useState(false);
  const [playTime, setPlayTime] = useState(0);
  const [viewportRatio, setViewportRatio] = useState<number | null>(null);
  const layoutDragRef = useRef<{ originY: number; originRatio: number } | null>(null);
  const layoutDragFrameRef = useRef<number | null>(null);
  const pendingViewportRatioRef = useRef<number | null>(null);
  const humanoidTrackCount = objects.filter(item => item.kind === 'humanoid').length;
  const autoViewportRatio = Math.max(0.34, Math.min(0.58, 0.56 - Math.max(0, humanoidTrackCount - 1) * 0.035));
  const effectiveViewportRatio = viewportRatio ?? autoViewportRatio;
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [snapToFrames, setSnapToFrames] = useState(true);
  const timelineScrubRef = useRef(false);
  const keyframeDragRef = useRef<{ index: number; originX: number; originTime: number; kf?: Keyframe } | null>(null);
  const keyframeDragMovedRef = useRef(false);
  const [fps, setFps] = useState(30);
  const timelineDragRef = useRef<{ targetId: string; mode: 'move' | 'start' | 'end'; originX: number; start: number; end: number } | null>(null);
  const timelineDuration = Math.max(0.1, keyframes[keyframes.length - 1]?.time || 0, ...motionPaths.map(path => path.endTime || path.duration || 0));
  const [currentKf, setCurrentKf] = useState(-1);
  // 时间线范围选择（框选裁切）
  const [rangeSel, setRangeSel] = useState<{ start: number; end: number } | null>(null);
  const rangeDragRef = useRef<{ dragging: boolean; start: number } | null>(null);
  const rangeMoveRef = useRef<{ originX: number; times: number[]; kfs?: Keyframe[] } | null>(null);
  // 机位（镜头）
  const [cameraShots, setCameraShots] = useState<CameraShot[]>([]);
  const cameraShotsRef = useRef<CameraShot[]>([]);
  useEffect(() => { cameraShotsRef.current = cameraShots; }, [cameraShots]);
  // 相机运镜录制：开始记录→移动相机采样为时间线→停止
  const [camRecording, setCamRecording] = useState(false);
  const camRecordingRef = useRef(false);
  const camSamplesRef = useRef<Array<{ time: number; pos: [number, number, number]; target: [number, number, number]; objects: Keyframe['objects']; bones: Keyframe['bones'] }>>([]);
  const camRecordStartRef = useRef(0);
  const camLastSampleRef = useRef(0);
  // FPV 运镜模式（无人机式）：录制时鼠标隐藏并捕获，鼠标移动=朝向，键盘 WASD/QE=移动
  const fpvYawRef = useRef(0);
  const fpvPitchRef = useRef(0);
  const fpvActiveRef = useRef(false);
  // 整条时间线播放/导出速度（0.25x~4x）
  const [speedFactor, setSpeedFactor] = useState(1);
  const speedFactorRef = useRef(1);
  useEffect(() => { speedFactorRef.current = speedFactor; }, [speedFactor]);
  // 相机轨迹平滑（Catmull-Rom 样条），可开关
  const [smoothCam, setSmoothCam] = useState(true);
  const smoothCamRef = useRef(true);
  useEffect(() => { smoothCamRef.current = smoothCam; }, [smoothCam]);
  // 镜头速度：录制运镜时的移动/旋转/缩放速度（默认偏慢，可调出 FPV 快速）
  const [camSpeed, setCamSpeed] = useState(0.05);
  const [rotateSpeed, setRotateSpeed] = useState(0.5);
  const [zoomSpeed, setZoomSpeed] = useState(1);
  const camSpeedRef = useRef(0.05);
  useEffect(() => { camSpeedRef.current = camSpeed; }, [camSpeed]);
  useEffect(() => { if (controlsRef.current) { controlsRef.current.rotateSpeed = rotateSpeed; controlsRef.current.zoomSpeed = zoomSpeed; } }, [rotateSpeed, zoomSpeed]);
  // 持久化导演台偏好（运镜速度/灯光/关键帧/机位），退出再进不丢失
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('director3d-prefs') || 'null');
      if (saved) {
        if (typeof saved.camSpeed === 'number') setCamSpeed(saved.camSpeed);
        if (typeof saved.rotateSpeed === 'number') setRotateSpeed(saved.rotateSpeed);
        if (typeof saved.zoomSpeed === 'number') setZoomSpeed(saved.zoomSpeed);
        if (typeof saved.lightKey === 'number') setLightKey(saved.lightKey);
        if (typeof saved.lightAmb === 'number') setLightAmb(saved.lightAmb);
        if (typeof saved.bgColor === 'string') setBgColor(saved.bgColor);
        if (saved.lightPos && typeof saved.lightPos.x === 'number') setLightPos(saved.lightPos);
        if (typeof saved.fps === 'number') setFps(saved.fps);
        if (Array.isArray(saved.keyframes)) setKeyframes(saved.keyframes);
        if (Array.isArray(saved.motionPaths)) setMotionPaths(saved.motionPaths.map((path: Partial<MotionPath>) => { const startTime = Number.isFinite(path.startTime) ? Number(path.startTime) : 0; const duration = Math.max(0.1, Number(path.duration) || 4); return { gait: 'walk', gaitAmount: 1, startTime, endTime: Number.isFinite(path.endTime) ? Number(path.endTime) : startTime + duration, ...path }; }) as MotionPath[]);
        if (Array.isArray(saved.cameraShots)) setCameraShots(saved.cameraShots);
      }
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem('director3d-prefs', JSON.stringify({ camSpeed, rotateSpeed, zoomSpeed, lightKey, lightAmb, bgColor, lightPos, fps, keyframes, motionPaths, cameraShots })); } catch { /* ignore */ }
  }, [camSpeed, rotateSpeed, zoomSpeed, lightKey, lightAmb, bgColor, lightPos, fps, keyframes, motionPaths, cameraShots]);
  const playStateRef = useRef<{ kfs: Keyframe[]; start: number; idx: number; total?: number } | null>(null);

  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;

  // 序列化场景（对象 preset/transform/color/骨骼旋转 + 材质模式）
  // H3 修复：保存对象稳定 id，加载场景/恢复时沿用同一 id，避免关键帧/骨骼/路径引用断链（时间线静默失效）
  // L9 修复：同时保存自定义 name/note，加载后不再还原为预设名/空备注
  const serializeScene = useCallback((): string => {
    const objects = objectsRef.current.map(o => ({
      id: o.id,
      key: o.presetKey,
      name: o.name,
      note: o.note,
      pos: [o.root.position.x, o.root.position.y, o.root.position.z],
      rot: [o.root.rotation.x, o.root.rotation.y, o.root.rotation.z],
      scale: [o.root.scale.x, o.root.scale.y, o.root.scale.z],
      color: o.material ? '#' + o.material.color.getHexString() : undefined,
      bones: o.bones?.map(b => [b.rotation.x, b.rotation.y, b.rotation.z]),
    }));
    return JSON.stringify({ materialMode: materialModeRef.current, objects, cameraShots: cameraShotsRef.current });
  }, []);

  // 关闭：自动保存场景到 localStorage
  const handleClose = useCallback(() => {
    try { localStorage.setItem('director3d-scene', serializeScene()); } catch { /* ignore */ }
    onClose();
  }, [onClose, serializeScene]);

  // 清空所有对象
  const clearAllObjects = useCallback(() => {
    for (const o of objectsRef.current) sceneRef.current?.remove(o.root);
    objectsRef.current = [];
    setObjects([]);
    selectedIdRef.current = ''; setSelectedId('');
    setBoneNames([]); setBoneLabels([]); setBoneRots({});
    transformControlsRef.current?.detach();
  }, []);

  // 一键新场地：清空对象/机位/关键帧/成品，换场景不用逐个删
  const newScene = useCallback(() => {
    clearAllObjects();
    setCameraShots([]);
    setMotionPaths([]);
    setKeyframes([]);
    setRangeSel(null);
    setCurrentKf(-1);
    setLastMedia(null);
    setRecordedUrl('');
    playStateRef.current = null; setPlaying(false);
    message.success('已清空，开始新场地');
  }, [clearAllObjects]);

  // 按序列化 items 重建对象（调用前先 clearAllObjects）
  const applySceneItems = useCallback((items: any[]) => {
    const scene = sceneRef.current;
    if (!scene) return;
    for (const item of items) {
      const preset = PRESET_LIBRARY.find(p => p.key === item.key);
      if (!preset || preset.key === 'import') continue;
      const mat = new THREE.MeshStandardMaterial({ color: 0xdfe6ec, roughness: 0.6 });
      if (item.color) mat.color.set(item.color);
      let root: THREE.Object3D, bones: THREE.Bone[] | undefined;
      if (preset.kind === 'humanoid') { const h = makeHumanoid(mat); root = h.root; bones = h.bones; if (preset.key === 'humanoid-small') root.scale.setScalar(0.7); else if (preset.key === 'humanoid-large') root.scale.setScalar(1.35); }
      else { root = preset.kind === 'geometry' ? makeGeometry(preset.key, mat) : preset.kind === 'environment' ? makeEnvironment(preset.key, mat) : makeProp(preset.key, mat); if (preset.kind === 'prop') root.position.y = 0.01; }
      root.position.set(item.pos?.[0] ?? 0, item.pos?.[1] ?? 0, item.pos?.[2] ?? 0);
      root.rotation.set(item.rot?.[0] ?? 0, item.rot?.[1] ?? 0, item.rot?.[2] ?? 0);
      if (item.scale) root.scale.set(item.scale[0], item.scale[1], item.scale[2]);
      if (item.bones && bones) bones.forEach((b, i) => { if (item.bones[i]) b.rotation.set(item.bones[i][0], item.bones[i][1], item.bones[i][2]); });
      scene.add(root);
      // H3 修复：沿用保存的稳定 id（旧场景无 id 时生成新 id）；L9：恢复自定义 name/note
      const obj: SceneObj = { id: typeof item.id === 'string' && item.id ? item.id : `obj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: typeof item.name === 'string' && item.name ? item.name : preset.label, kind: preset.kind, presetKey: preset.key, root, material: mat, bones, boneNames: bones?.map(b => b.name), castShadow: true };
      objectsRef.current.push(obj);
      setObjects(prev => [...prev, { id: obj.id, name: obj.name, kind: obj.kind, note: typeof item.note === 'string' ? item.note : '' }]);
    }
  }, []);

  const loadSceneList = useCallback(() => {
    try { setSavedScenes(JSON.parse(localStorage.getItem('director3d-scenes') || '[]').map((x: any) => ({ name: x.name, time: x.time }))); } catch { /* ignore */ }
  }, []);

  const saveScene = useCallback(() => {
    const name = sceneName.trim() || `场景 ${savedScenes.length + 1}`;
    const data = serializeScene();
    let list: any[] = [];
    try { list = JSON.parse(localStorage.getItem('director3d-scenes') || '[]'); } catch { /* ignore */ }
    const idx = list.findIndex(x => x.name === name);
    if (idx >= 0) list[idx] = { name, data, time: Date.now() };
    else list.push({ name, data, time: Date.now() });
    localStorage.setItem('director3d-scenes', JSON.stringify(list));
    setSavedScenes(list.map(x => ({ name: x.name, time: x.time })));
    setSceneName('');
    message.success(`已保存场景「${name}」`);
  }, [sceneName, savedScenes, serializeScene]);

  const loadScene = useCallback((name: string) => {
    let list: any[] = [];
    try { list = JSON.parse(localStorage.getItem('director3d-scenes') || '[]'); } catch { /* ignore */ }
    const s = list.find(x => x.name === name);
    if (!s) { message.warning('场景不存在'); return; }
    clearAllObjects();
    try {
      const parsed = JSON.parse(s.data);
      const items = Array.isArray(parsed) ? parsed : (parsed.objects || []);
      if (!Array.isArray(parsed) && parsed.materialMode) setMaterialMode(parsed.materialMode);
      if (!Array.isArray(parsed) && Array.isArray(parsed.cameraShots)) setCameraShots(parsed.cameraShots);
      applySceneItems(items);
    } catch { message.error('场景恢复失败'); }
    message.success(`已加载场景「${name}」`);
  }, [clearAllObjects, applySceneItems]);

  const deleteScene = useCallback((name: string) => {
    let list: any[] = [];
    try { list = JSON.parse(localStorage.getItem('director3d-scenes') || '[]'); } catch { /* ignore */ }
    list = list.filter(x => x.name !== name);
    localStorage.setItem('director3d-scenes', JSON.stringify(list));
    setSavedScenes(list.map(x => ({ name: x.name, time: x.time })));
  }, []);
  const materialModeRef = useRef(materialMode); materialModeRef.current = materialMode;
  const viewModeRef = useRef(viewMode); viewModeRef.current = viewMode;
  const characterTargetRef = useRef(characterTarget); characterTargetRef.current = characterTarget;
  const charRotRef = useRef({ yaw: 0, pitch: 0 });
  const charDragRef = useRef<{ x: number; y: number } | null>(null);
  const camKeysRef = useRef<Record<string, boolean>>({});
  const lastPlayTimeSync = useRef(0);
  const chatProvider = useSettingsStore(s => s.chatProvider);
  const chatModel = useSettingsStore(s => s.chatModel);
  const hasChatKey = useSettingsStore(s => !!s.chatApiKey);

  // Esc 关闭（分层）：FPV 运镜录制中按 Esc 只停止录制并保存采样，
  // 不关闭整个导演台（原先直接 handleClose 会丢掉已录的运镜数据）
  // stopCamRecording 定义在其后（useCallback 提升限制），经 ref 间接调用
  const stopCamRecordingRef = useRef<(() => void) | null>(null);
  // L5 修复：Esc 同时触发 keydown 处理器与浏览器自动解锁 pointerlockchange，两者都会调 stopCamRecording；
  // 用防重标记让先到者停止录制并置标记，后到者（keydown 的 handleClose）看到标记直接忽略，避免"只想退出鼠标锁定却关掉导演台"
  const escStopPendingRef = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.key === 'Escape') {
        if (camRecordingRef.current) { stopCamRecordingRef.current?.(); return; }
        if (escStopPendingRef.current) { escStopPendingRef.current = false; return; }
        handleClose();
      }
      else if (matchShortcut(e, getShortcuts()['director-move'])) setGizmoMode('translate');
      else if (matchShortcut(e, getShortcuts()['director-rotate'])) setGizmoMode('rotate');
      else if (matchShortcut(e, getShortcuts()['director-scale'])) setGizmoMode('scale');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleClose]);
  // pointer lock 被浏览器自动解锁（用户按 Esc 退出鼠标锁定）时，若仍在录制则自动停止保存采样
  useEffect(() => {
    const onLockChange = () => {
      if (document.pointerLockElement === null && camRecordingRef.current) {
        // L5：解锁触发的停止也置防重标记，避免同一次 Esc 的 keydown 处理器误关导演台
        escStopPendingRef.current = true;
        window.setTimeout(() => { escStopPendingRef.current = false; }, 500);
        stopCamRecordingRef.current?.();
      }
    };
    document.addEventListener('pointerlockchange', onLockChange);
    return () => document.removeEventListener('pointerlockchange', onLockChange);
  }, []);
  useEffect(() => { loadSceneList(); }, [loadSceneList]);

  // 材质切换：所有对象统一 overrideMaterial
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (materialMode === 'original') scene.overrideMaterial = null;
    else if (materialMode === 'white') scene.overrideMaterial = new THREE.MeshStandardMaterial({ color: MAT.white, roughness: 0.7, metalness: 0 });
    else if (materialMode === 'gray') scene.overrideMaterial = new THREE.MeshStandardMaterial({ color: MAT.gray, roughness: 0.7, metalness: 0 });
    else if (materialMode === 'wireframe') scene.overrideMaterial = new THREE.MeshBasicMaterial({ color: MAT.wire, wireframe: true });
    if (groundRef.current) groundRef.current.material = materialMode === 'wireframe' ? new THREE.MeshBasicMaterial({ color: 0x2a3140, wireframe: true }) : new THREE.MeshStandardMaterial({ color: 0xe8edf2, roughness: 0.9 });
  }, [materialMode]);

  // 相机预设：默认围绕选中对象，避免每次搭镜头都回到世界原点。
  const setView = useCallback((preset: string) => {
    const camera = cameraRef.current, controls = controlsRef.current;
    if (!camera || !controls) return;
    const selected = objectsRef.current.find(o => o.id === selectedIdRef.current);
    const target = new THREE.Vector3();
    if (selected) new THREE.Box3().setFromObject(selected.root).getCenter(target);
    else target.set(0, 0.8, 0);
    const dist = preset === 'closeup' ? 1.6 : preset === 'top' ? 5 : 4.2;
    let pos: THREE.Vector3;
    if (preset === 'front') pos = target.clone().add(new THREE.Vector3(0, 0.1, -dist));
    else if (preset === 'back') pos = target.clone().add(new THREE.Vector3(0, 0.1, dist));
    else if (preset === 'left') pos = target.clone().add(new THREE.Vector3(-dist, 0.1, 0));
    else if (preset === 'right') pos = target.clone().add(new THREE.Vector3(dist, 0.1, 0));
    else if (preset === 'top') pos = target.clone().add(new THREE.Vector3(0, dist, 0.001));
    else if (preset === 'closeup') pos = target.clone().add(new THREE.Vector3(0, 0.15, -dist));
    else pos = target.clone().add(new THREE.Vector3(dist * 0.6, dist * 0.45, dist * 0.75));
    camera.position.copy(pos); controls.target.copy(target); controls.update();
  }, []);

  const focusSelected = useCallback(() => {
    const selected = objectsRef.current.find(o => o.id === selectedIdRef.current);
    const camera = cameraRef.current, controls = controlsRef.current;
    if (!selected || !camera || !controls) { message.info('请先选择场景对象'); return; }
    const box = new THREE.Box3().setFromObject(selected.root);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.65, 1.2);
    const direction = camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(center).add(direction.multiplyScalar(radius));
    controls.target.copy(center); controls.update();
  }, []);

  const easeInOut = (t: number) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

  // Catmull-Rom 样条插值（相机轨迹平滑：经过控制点且曲线连续，无折角）
  const catmullRom = (p0: number[], p1: number[], p2: number[], p3: number[], t: number): number[] => {
    const t2 = t * t, t3 = t2 * t;
    return [0, 1, 2].map(i =>
      0.5 * ((2 * p1[i]) + (-p0[i] + p2[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3)
    );
  };

  // —— 添加物体 ——
  const addObject = useCallback((preset: PresetDef) => {
    const scene = sceneRef.current;
    if (!scene) return;
    const mat = new THREE.MeshStandardMaterial({ color: randomColor(), roughness: 0.6 });
    const id = `obj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const name = preset.label;
    if (preset.kind === 'humanoid') {
      const { root, bones } = makeHumanoid(mat);
      if (preset.key === 'humanoid-small') root.scale.setScalar(0.7);
      else if (preset.key === 'humanoid-large') root.scale.setScalar(1.35);
      root.name = name;
      scene.add(root);
      const obj: SceneObj = { id, name, kind: 'humanoid', presetKey: preset.key, root, material: mat, bones, boneNames: bones.map(b => b.name), castShadow: true };
      objectsRef.current.push(obj);
      setObjects(prev => [...prev, { id, name, kind: 'humanoid', note: '' }]);
      selectObject(id);
    } else {
      const root = preset.kind === 'geometry' ? makeGeometry(preset.key, mat) : preset.kind === 'environment' ? makeEnvironment(preset.key, mat) : makeProp(preset.key, mat);
      root.name = name;
      if (preset.kind === 'prop') root.position.y = 0.01;
      scene.add(root);
      const obj: SceneObj = { id, name, kind: preset.kind, presetKey: preset.key, root, material: mat, castShadow: true };
      objectsRef.current.push(obj);
      setObjects(prev => [...prev, { id, name, kind: preset.kind, note: '' }]);
      selectObject(id);
    }
  }, []);

  // —— 选中对象 ——
  const selectObject = useCallback((id: string) => {
    selectedIdRef.current = id; setSelectedId(id);
    const obj = objectsRef.current.find(o => o.id === id);
    setBoneNames([]); setBoneLabels([]); setBoneRots({});
    if (obj) {
      transformControlsRef.current?.attach(obj.root);
      if (obj.bones) {
        setBoneNames(obj.boneNames || []); setBoneLabels((obj.boneNames || []).map(boneSemantic));
        const rots: Record<string, [number, number, number]> = {};
        obj.bones.forEach((b, i) => { rots[obj.boneNames?.[i] || b.name] = [b.rotation.x, b.rotation.y, b.rotation.z]; });
        setBoneRots(rots);
      } else { setBoneRots({}); }
      if (obj.material) setSelColor('#' + obj.material.color.getHexString());
      const p = obj.root.position, r = obj.root.rotation, s = obj.root.scale;
      setSelTransform({ px: p.x, py: p.y, pz: p.z, rx: r.x, ry: r.y, rz: r.z, sx: s.x, sy: s.y, sz: s.z });
    }
  }, []);

  const deleteObject = useCallback(() => {
    const id = selectedIdRef.current; if (!id) return;
    const idx = objectsRef.current.findIndex(o => o.id === id);
    if (idx >= 0) {
      const obj = objectsRef.current[idx];
      sceneRef.current?.remove(obj.root);
      objectsRef.current.splice(idx, 1);
      // L3 修复：释放对象几何体/材质（防 GPU 内存累积）；骨骼材质随 traverse 一并 dispose
      obj.root.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(m => { if (m && m !== obj.material) { try { m.dispose(); } catch { /* ignore */ } } });
          if (mesh.geometry) { try { mesh.geometry.dispose(); } catch { /* ignore */ } }
        }
      });
      try { obj.material?.dispose(); } catch { /* ignore */ }
      if (transformControlsRef.current?.object === obj.root) transformControlsRef.current.detach();
      // L3 修复：删除对象时同步清理其 motionPaths，并清除引用该对象的关键帧（防止孤儿路径撑大时间线/prefs 残留）
      setMotionPaths(prev => prev.filter(p => p.targetId !== id));
      setKeyframes(prev => prev.map(k => ({ ...k, objects: { ...k.objects }, bones: { ...k.bones } })).map(k => {
        const objects = { ...k.objects }; delete objects[id];
        const bones = { ...k.bones }; delete bones[id];
        return { ...k, objects, bones };
      }));
      setCameraShots(prev => prev.filter(s => s.targetId !== id));
    }
    setObjects(prev => prev.filter(o => o.id !== id));
    selectedIdRef.current = ''; setSelectedId(''); setBoneNames([]); setBoneRots({});
    setCurrentKf(-1);
  }, []);

  // 复制选中物体（深拷贝 3D 树 + 独立材质 + 重新收集骨骼），偏移一点避免重叠
  const duplicateObject = useCallback(() => {
    const id = selectedIdRef.current; if (!id) { message.warning('请先选中一个物体'); return; }
    const src = objectsRef.current.find(o => o.id === id);
    if (!src) return;
    const cloneRoot = src.root.clone(true);
    // 独立材质：复制颜色/粗糙度，避免与原对象共享材质导致改色互串
    const newMat = src.material ? new THREE.MeshStandardMaterial({ color: src.material.color.clone(), roughness: src.material.roughness ?? 0.6, metalness: src.material.metalness ?? 0 }) : undefined;
    cloneRoot.traverse(o => { if ((o as THREE.Mesh).isMesh && newMat) (o as THREE.Mesh).material = newMat; });
    const newId = `obj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    cloneRoot.name = src.name;
    cloneRoot.position.set(src.root.position.x + 0.6, src.root.position.y, src.root.position.z + 0.6);
    sceneRef.current?.add(cloneRoot);
    const newObj: SceneObj = { id: newId, name: src.name, kind: src.kind, presetKey: src.presetKey, root: cloneRoot, material: newMat, castShadow: src.castShadow };
    if (src.bones && src.boneNames) {
      const byName = new Map<string, THREE.Bone>();
      cloneRoot.traverse(o => { if ((o as THREE.Bone).isBone && o.name) byName.set(o.name, o as THREE.Bone); });
      const clonedBones = src.boneNames.map(n => byName.get(n)).filter((b): b is THREE.Bone => !!b);
      newObj.bones = clonedBones; newObj.boneNames = src.boneNames;
    }
    objectsRef.current.push(newObj);
    setObjects(prev => [...prev, { id: newId, name: src.name, kind: src.kind, note: '' }]);
    selectObject(newId);
    message.success(`已复制「${src.name}」`);
  }, [selectObject]);

  const updateTransform = useCallback((key: string, value: number) => {
    const obj = objectsRef.current.find(o => o.id === selectedIdRef.current);
    if (!obj) return;
    const root = obj.root;
    if (key === 'px') root.position.x = value;
    else if (key === 'py') root.position.y = value;
    else if (key === 'pz') root.position.z = value;
    else if (key === 'rx') root.rotation.x = value;
    else if (key === 'ry') root.rotation.y = value;
    else if (key === 'rz') root.rotation.z = value;
    else if (key === 'sx') root.scale.x = value;
    else if (key === 'sy') root.scale.y = value;
    else if (key === 'sz') root.scale.z = value;
    setSelTransform(prev => ({ ...prev, [key]: value }));
  }, []);

  // 修改选中物体颜色（原色模式下可见）
  // —— 机位（镜头）——
  const recordShot = useCallback(() => {
    const cam = cameraRef.current, ctl = controlsRef.current;
    if (!cam || !ctl) return;
    const shot: CameraShot = {
      id: 'shot-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: `机位 ${cameraShots.length + 1}`,
      pos: [cam.position.x, cam.position.y, cam.position.z],
      target: [ctl.target.x, ctl.target.y, ctl.target.z],
    };
    setCameraShots(prev => [...prev, shot]);
    message.success(`已记录「${shot.name}」`);
  }, [cameraShots.length]);

  const switchShot = useCallback((id: string) => {
    const shot = cameraShots.find(s => s.id === id);
    if (!shot || !cameraRef.current || !controlsRef.current) return;
    cameraRef.current.position.set(shot.pos[0], shot.pos[1], shot.pos[2]);
    controlsRef.current.target.set(shot.target[0], shot.target[1], shot.target[2]);
    controlsRef.current.update();
    setViewMode('free');
    message.info(`已切到「${shot.name}」`);
  }, [cameraShots]);

  const deleteShot = useCallback((id: string) => {
    setCameraShots(prev => prev.filter(s => s.id !== id));
  }, []);

  // —— 相机运镜录制：采样相机轨迹为时间线关键帧 ——
  const startCamRecording = useCallback(() => {
    // M2 修复：进入运镜录制前先停其它录制（动画录制/运镜录制），避免两个 MediaRecorder 或 motion 与 FPV 同时驱动相机
    if (recorderRef.current?.state === 'recording') { try { recorderRef.current.stop(); } catch { /* ignore */ } }
    motionRef.current = null;
    // 停止旧动画播放（否则 playStateRef 会让 FPV 镜头动不了）
    playStateRef.current = null; setPlaying(false);
    camSamplesRef.current = [];
    camRecordStartRef.current = performance.now();
    camLastSampleRef.current = 0;
    camRecordingRef.current = true;
    setCamRecording(true);
    setCamRecordSecs(0);
    // M3 修复：不再无条件清空关键帧——保存快照，录制太短时恢复；已有时间线时合并采样而非全量替换
    preCamKeyframesRef.current = keyframes;
    if (keyframes.length) message.info(`将录制运镜（现有 ${keyframes.length} 个关键帧会与录制结果合并，可录制后删除不需要的帧）`);
    // M2 修复：人物视角/轨道视角下 FPV 会失效（相机被钉在角色上），强制切回自由视角录制
    setViewMode('free');
    viewModeRef.current = 'free';
    // 进入无人机（FPV）模式：从当前相机朝向初始化 yaw/pitch，禁用 OrbitControls，隐藏并捕获鼠标
    const cam = cameraRef.current, ctl = controlsRef.current;
    if (cam && ctl) {
      const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
      fpvYawRef.current = Math.atan2(fwd.x, fwd.z);
      fpvPitchRef.current = Math.asin(Math.max(-1, Math.min(1, fwd.y)));
      ctl.enabled = false;
      fpvActiveRef.current = true;
      const el = rendererRef.current?.domElement;
      if (el) {
        el.style.cursor = 'none';
        try {
          // M4 修复：requestPointerLock 可能是 promise 式失败（距上次解锁太近/非用户手势），失败时回滚 FPV 状态而不是残留隐藏光标
          const ret = (el as any).requestPointerLock?.();
          if (ret && typeof ret.catch === 'function') ret.catch(() => {
            fpvActiveRef.current = false;
            camRecordingRef.current = false;
            setCamRecording(false);
            el.style.cursor = '';
            message.warning('无法锁定鼠标（浏览器限制），已退出录制模式');
          });
        } catch { /* 部分环境不支持 pointer lock */ }
      }
    }
    message.info('录制运镜（无人机模式）：鼠标移动=朝向，WASD/QE=前后左右上下移动，Esc 退出鼠标锁定，点「停止运镜」结束');
  }, [keyframes]);

  const stopCamRecording = useCallback(() => {
    camRecordingRef.current = false;
    setCamRecording(false);
    setCamRecordSecs(0);
    fpvActiveRef.current = false;
    if (controlsRef.current) controlsRef.current.enabled = true;
    const el = rendererRef.current?.domElement;
    if (el) { el.style.cursor = ''; if (document.pointerLockElement === el) { try { document.exitPointerLock?.(); } catch { /* ignore */ } } }
    const samples = camSamplesRef.current;
    if (samples.length < 2) {
      message.warning('录制太短，请先移动相机再停止');
      // M3 修复：恢复录制前的关键帧，而不是清空用户已有的时间线
      setKeyframes(prev => preCamKeyframesRef.current ?? prev);
      preCamKeyframesRef.current = null;
      return;
    }
    const kfs: Keyframe[] = samples.map(s => ({ time: s.time, objects: s.objects, bones: s.bones, camera: { pos: s.pos, target: s.target } }));
    // M2 修复：合并进现有时间线（按时间排序）而非全量替换，保留录制前用户手动打的 K 帧
    setKeyframes(prev => {
      const before = preCamKeyframesRef.current ?? prev;
      preCamKeyframesRef.current = null;
      return [...before, ...kfs].sort((a, b) => a.time - b.time);
    });
    message.success(`运镜录制完成：${kfs.length} 帧，时长 ${samples[samples.length - 1].time.toFixed(2)}s，可在时间线播放/变速/裁切`);
  }, []);
  // 挂载 Esc 分层退出所需的稳定回调引用（避免 useCallback 提升顺序问题）
  useEffect(() => { stopCamRecordingRef.current = stopCamRecording; }, [stopCamRecording]);
  // 运镜录制时长计时（每 100ms 刷新一次显示，停止后归零）
  const [camRecordSecs, setCamRecordSecs] = useState(0);
  useEffect(() => {
    if (!camRecording) return;
    const timer = window.setInterval(() => {
      setCamRecordSecs(camRecordStartRef.current ? (performance.now() - camRecordStartRef.current) / 1000 : 0);
    }, 100);
    return () => window.clearInterval(timer);
  }, [camRecording]);

  const setObjectColor = useCallback((hex: string) => {
    const obj = objectsRef.current.find(o => o.id === selectedIdRef.current);
    if (!obj) return;
    if (obj.material) obj.material.color.set(hex);
    else obj.root.traverse(o => { if ((o as THREE.Mesh).isMesh) { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (m?.color) m.color.set(hex); } });
    setSelColor(hex);
    setMaterialMode('original'); // 改颜色时自动切原色，让颜色立即可见
  }, []);

  // 修改选中对象备注
  const setObjectNote = useCallback((id: string, note: string) => {
    // L9 一致性：同步 SceneObj.note，否则序列化保存场景时备注丢失
    const obj = objectsRef.current.find(o => o.id === id);
    if (obj) obj.note = note;
    setObjects(prev => prev.map(o => o.id === id ? { ...o, note } : o));
  }, []);

  // 直接设置指定骨骼的旋转（展开列表用）
  const setBoneRotByName = useCallback((name: string, axis: 'x' | 'y' | 'z', value: number) => {
    const obj = objectsRef.current.find(o => o.id === selectedIdRef.current);
    const idx = (obj?.boneNames || []).indexOf(name);
    const bone = obj?.bones?.[idx];
    if (bone) {
      bone.rotation[axis] = value;
      setBoneRots(prev => ({ ...prev, [name]: [bone.rotation.x, bone.rotation.y, bone.rotation.z] }));
    }
  }, []);

  // —— 关键帧 ——
  const snapshotKeyframe = useCallback((): Keyframe => {
    const objects: Keyframe['objects'] = {};
    const bones: Keyframe['bones'] = {};
    for (const o of objectsRef.current) {
      objects[o.id] = { pos: [o.root.position.x, o.root.position.y, o.root.position.z], rot: [o.root.rotation.x, o.root.rotation.y, o.root.rotation.z], scale: [o.root.scale.x, o.root.scale.y, o.root.scale.z] };
      o.bones?.forEach((b, i) => { bones[`${o.id}:${b.name}`] = [b.rotation.x, b.rotation.y, b.rotation.z]; });
    }
    const cam = cameraRef.current, ctl = controlsRef.current;
    const camera = cam && ctl ? { pos: [cam.position.x, cam.position.y, cam.position.z] as [number, number, number], target: [ctl.target.x, ctl.target.y, ctl.target.z] as [number, number, number] } : undefined;
    return { time: keyframes.length, objects, bones, camera };
  }, [keyframes]);

  const addKeyframe = useCallback(() => { setKeyframes(prev => [...prev, snapshotKeyframe()]); }, [snapshotKeyframe]);

  // 记录关键帧快捷键（可自定义）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (matchShortcut(e, getShortcuts()['director-keyframe'])) addKeyframe();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [addKeyframe]);

  // 跳转到某个关键帧：恢复该帧的物体/骨骼/相机状态，供编辑
  const jumpToKeyframe = useCallback((index: number) => {
    const kf = keyframes[index];
    if (!kf) return;
    for (const o of objectsRef.current) {
      const t = kf.objects[o.id];
      if (t) { o.root.position.set(t.pos[0], t.pos[1], t.pos[2]); o.root.rotation.set(t.rot[0], t.rot[1], t.rot[2]); o.root.scale.set(t.scale[0], t.scale[1], t.scale[2]); }
      o.bones?.forEach((b) => { const r = kf.bones[`${o.id}:${b.name}`]; if (r) b.rotation.set(r[0], r[1], r[2]); });
    }
    if (kf.camera && cameraRef.current && controlsRef.current) {
      cameraRef.current.position.set(kf.camera.pos[0], kf.camera.pos[1], kf.camera.pos[2]);
      controlsRef.current.target.set(kf.camera.target[0], kf.camera.target[1], kf.camera.target[2]);
    }
    setCurrentKf(index); setPlaying(false); playStateRef.current = null;
    message.info(`已跳到关键帧 ${index + 1}，可编辑后点「更新关键帧」`);
  }, [keyframes]);

  // 更新当前编辑的关键帧（用当前场景状态覆盖，保持原 time）
  const updateKeyframe = useCallback(() => {
    if (currentKf < 0) { message.warning('请先点击时间线上的关键帧跳转'); return; }
    setKeyframes(prev => prev.map((kf, i) => {
      if (i !== currentKf) return kf;
      const snap = snapshotKeyframe();
      // 保留该帧原有相机轨迹（先录运镜再 K 物体时不破坏相机）
      return { ...snap, time: kf.time, camera: kf.camera ?? snap.camera };
    }));
    message.success('关键帧已更新（物体/骨骼已写入，相机轨迹保留）');
  }, [currentKf, snapshotKeyframe]);

  // 删除当前选中的关键帧（裁切）
  const deleteCurrentKf = useCallback(() => {
    if (currentKf < 0) return;
    const oldFirst = keyframes[0]?.time ?? 0;
    setKeyframes(prev => {
      const next = normalizeKeyframeTimes(prev.filter((_, i) => i !== currentKf));
      const newFirst = next[0]?.time ?? 0;
      // M6：同步平移 motionPaths，保持人物路径与关键帧轨道对齐
      if (oldFirst > 0 && newFirst < oldFirst) setMotionPaths(paths => shiftMotionPathsForKeyframes(paths, oldFirst, newFirst));
      return next;
    });
    setCurrentKf(-1);
    message.success('已删除该关键帧');
  }, [currentKf, keyframes]);

  // 删除框选范围的关键帧（批量裁切）
  const deleteRangeKfs = useCallback(() => {
    if (!rangeSel) return;
    const s = Math.min(rangeSel.start, rangeSel.end);
    const e = Math.max(rangeSel.start, rangeSel.end);
    const oldFirst = keyframes[0]?.time ?? 0;
    setKeyframes(prev => {
      const next = normalizeKeyframeTimes(prev.filter((_, i) => i < s || i > e));
      const newFirst = next[0]?.time ?? 0;
      if (oldFirst > 0 && newFirst < oldFirst) setMotionPaths(paths => shiftMotionPathsForKeyframes(paths, oldFirst, newFirst));
      return next;
    });
    setRangeSel(null);
    setCurrentKf(-1);
    message.success(`已裁掉第 ${s + 1}~${e + 1} 帧（共 ${e - s + 1} 帧）`);
  }, [rangeSel, keyframes]);

  // 记录导演台素材（截图/录制成品入库）
  const addDirectorAsset = useCallback((media: { type: 'image' | 'video'; url: string; name: string }) => {
    setDirectorAssets(prev => [{ id: 'dasset-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), type: media.type, url: media.url, name: media.name, note: '', time: Date.now() }, ...prev]);
  }, []);

  const setDirectorAssetNote = useCallback((id: string, note: string) => {
    setDirectorAssets(prev => prev.map(a => a.id === id ? { ...a, note } : a));
  }, []);
  // 导出比例：截图/录制时按比例裁剪/调整
  const [exportRatio, setExportRatio] = useState('free');
  const exportRatioRef = useRef('free');
  useEffect(() => { exportRatioRef.current = exportRatio; }, [exportRatio]);

  const playKeyframes = useCallback(() => {
    if (keyframes.length < 2) { message.info('至少 2 个关键帧才能播放动画'); return; }
    const total = Math.max(0.001, timelineDuration);
    playStateRef.current = { kfs: keyframes, start: performance.now(), idx: 0, total };
    setPlaying(true);
  }, [keyframes, timelineDuration]);

  const selectedHumanoid = objects.find(item => item.kind === 'humanoid');
  const previewPath = useCallback(() => {
    const path = motionPaths.find(item => item.targetId === (selectedId || selectedHumanoid?.id));
    if (!path) { message.info('请先选择人物并创建路径'); return; }
    const target = objectsRef.current.find(object => object.id === path.targetId);
    if (!target) { message.warning('路径对应的人物不存在'); return; }
    const base = snapshotKeyframe();
    const total = Math.max(timelineDuration, path.endTime || path.duration || 0);
    playStateRef.current = { kfs: [{ ...base, time: 0 }, { ...base, time: total }], start: performance.now(), idx: 0, total };
    setPlaying(true);
    message.success(`开始预览${path.gait === 'run' ? '跑步' : path.gait === 'walk' ? '行走' : '路径'}`);
  }, [motionPaths, selectedId, selectedHumanoid?.id, timelineDuration]);

  const stopPlay = useCallback(() => { playStateRef.current = null; setPlaying(false); setPreviewClipId(''); }, []);
  const restoreTimelineHistory = useCallback((index: number) => {
    const entry = historyRef.current[index];
    if (!entry) return;
    historyIndexRef.current = index;
    historySkipRef.current = true;
    setKeyframes(JSON.parse(JSON.stringify(entry.keyframes)));
    setMotionPaths(JSON.parse(JSON.stringify(entry.motionPaths)));
    setCurrentKf(-1);
  }, []);
  const undoTimeline = useCallback(() => {
    if (historyIndexRef.current <= 0) { message.info('没有可撤销的时间线编辑'); return; }
    restoreTimelineHistory(historyIndexRef.current - 1);
  }, [restoreTimelineHistory]);
  const redoTimeline = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) { message.info('没有可重做的时间线编辑'); return; }
    restoreTimelineHistory(historyIndexRef.current + 1);
  }, [restoreTimelineHistory]);
  const copyTimelineSelection = useCallback(() => {
    if (rangeSel && keyframes.length) {
      const s = Math.min(rangeSel.start, rangeSel.end), e = Math.max(rangeSel.start, rangeSel.end);
      timelineClipboardRef.current = { kind: 'keyframes', keyframes: JSON.parse(JSON.stringify(keyframes.slice(s, e + 1))) };
      message.success(`已复制 ${e - s + 1} 个关键帧`);
      return;
    }
    if (currentKf >= 0 && keyframes[currentKf]) {
      timelineClipboardRef.current = { kind: 'keyframes', keyframes: [JSON.parse(JSON.stringify(keyframes[currentKf]))] };
      message.success('已复制当前关键帧');
      return;
    }
    const path = motionPaths.find(item => item.targetId === (selectedId || selectedHumanoid?.id));
    if (path) { timelineClipboardRef.current = { kind: 'path', path: JSON.parse(JSON.stringify(path)) }; message.success('已复制当前人物路径'); return; }
    message.info('请先框选/选中关键帧，或选择一个人物路径');
  }, [currentKf, keyframes, motionPaths, rangeSel, selectedHumanoid?.id, selectedId]);
  const saveActionClip = useCallback(() => {
    if (!rangeSel || keyframes.length < 2) { message.info('请先框选至少两个关键帧'); return; }
    const s = Math.min(rangeSel.start, rangeSel.end), e = Math.max(rangeSel.start, rangeSel.end);
    const source = keyframes.slice(s, e + 1).map(kf => ({ ...kf, time: kf.time - keyframes[s].time }));
    const name = window.prompt('动作片段名称', `动作片段 ${actionClips.length + 1}`)?.trim();
    if (!name) return;
    const sourceTargetId = selectedId || selectedHumanoid?.id;
    const sourceObject = objectsRef.current.find(object => object.id === sourceTargetId);
    const sourceBoneSemantics: Record<string, string> = {};
    sourceObject?.boneNames?.forEach(name => { sourceBoneSemantics[name] = boneSemanticKey(name); });
    setActionClips(prev => [...prev, { id: `clip-${Date.now()}`, name, sourceTargetId, sourceBoneSemantics, sourceHeight: sourceObject ? characterHeight(sourceObject) : undefined, keyframes: JSON.parse(JSON.stringify(source)), duration: source[source.length - 1].time, createdAt: Date.now() }]);
    message.success(`已保存动作片段「${name}」`);
  }, [actionClips.length, keyframes, rangeSel]);
  const remapActionClip = useCallback((clip: ActionClip, targetId: string, includeCamera: boolean) => {
    if (!clip.sourceTargetId) return { keyframes: clip.keyframes.map(kf => ({ ...kf, camera: includeCamera ? kf.camera : undefined })), unmatched: 0 };
    const targetObject = objectsRef.current.find(object => object.id === targetId);
    const targetBySemantic = new Map<string, string>();
    targetObject?.boneNames?.forEach(name => targetBySemantic.set(boneSemanticKey(name), name));
    let unmatched = 0;
    const keyframes = clip.keyframes.map(kf => {
      const sourceObject = kf.objects[clip.sourceTargetId!];
      const sourceHeight = clip.sourceHeight || 1;
      const targetHeight = targetObject ? characterHeight(targetObject) : sourceHeight;
      const scaleRatio = retargetScale ? Math.max(0.25, Math.min(4, targetHeight / sourceHeight)) : 1;
      const objects: Keyframe['objects'] = sourceObject ? { [targetId]: { ...sourceObject, pos: [sourceObject.pos[0] * scaleRatio, sourceObject.pos[1] * scaleRatio, sourceObject.pos[2] * scaleRatio] as [number, number, number], scale: sourceObject.scale } } : {};
      const bones: Keyframe['bones'] = {};
      Object.entries(kf.bones).forEach(([key, value]) => {
        const separator = key.indexOf(':');
        if (separator < 0 || key.slice(0, separator) !== clip.sourceTargetId) return;
        const sourceName = key.slice(separator + 1);
        const semantic = clip.sourceBoneSemantics?.[sourceName] || boneSemanticKey(sourceName);
        const targetName = clip.customBoneMap?.[semantic] || targetBySemantic.get(semantic) || targetObject?.boneNames?.find(name => name === sourceName);
        if (targetName) bones[`${targetId}:${targetName}`] = value;
        else unmatched++;
      });
      return { time: kf.time, objects, bones, camera: includeCamera ? kf.camera : undefined };
    });
    return { keyframes, unmatched };
  }, [retargetScale]);

  const pasteActionClip = useCallback((clip: ActionClip) => {
    const targetId = selectedId || selectedHumanoid?.id;
    const offset = playTime;
    if (!targetId) { message.info('请先选择目标人物'); return; }
    if (!clip.sourceTargetId) {
      const pasted = clip.keyframes.map(kf => ({ ...kf, time: offset + kf.time }));
      setKeyframes(prev => [...prev, ...pasted].sort((a, b) => a.time - b.time));
      message.success(`已加入旧版动作片段「${clip.name}」`);
      return;
    }
    const { keyframes: remappedBase, unmatched } = remapActionClip(clip, targetId, clipIncludeCamera);
    if (unmatched > 0) message.warning(`${unmatched} 个骨骼未找到语义匹配，已跳过`);
    const sourceDuration = Math.max(0.01, clip.duration);
    const remapped: Keyframe[] = [];
    for (let loop = 0; loop < Math.max(1, clipLoopCount); loop++) remapped.push(...remappedBase.map(kf => ({ ...kf, time: offset + loop * sourceDuration + kf.time })));
    if (clipBlendSeconds > 0 && remapped.length && keyframes.length) {
      const before = [...keyframes].sort((a, b) => b.time - a.time).find(kf => kf.time <= offset);
      if (before) {
        const first = remapped[0];
        for (let step = 4; step >= 1; step--) remapped.unshift(blendKeyframes(before, first, (5 - step) / 5, Math.max(0, offset - clipBlendSeconds * step / 4)));
      }
    }
    setKeyframes(prev => [...prev, ...remapped].sort((a, b) => a.time - b.time));
    setSelectedId(targetId);
    message.success(`动作片段「${clip.name}」已适配到当前人物`);
  }, [clipBlendSeconds, clipIncludeCamera, clipLoopCount, keyframes, playTime, remapActionClip, selectedHumanoid?.id, selectedId]);
  const previewActionClip = useCallback((clip: ActionClip) => {
    const targetId = selectedId || selectedHumanoid?.id;
    if (!targetId) { message.info('请先选择预览人物'); return; }
    setPreviewClipId(clip.id);
    const mapped = remapActionClip(clip, targetId, false);
    if (mapped.unmatched > 0) message.warning(`${mapped.unmatched} 个骨骼未匹配，预览将跳过`);
    const preview = mapped.keyframes.map(kf => ({ ...kf, time: kf.time }));
    playStateRef.current = { kfs: preview, start: performance.now(), idx: 0 };
    setPlaying(true);
    message.success(`预览动作片段「${clip.name}」· ${objects.find(object => object.id === targetId)?.name || '当前人物'}，结束后不会写入时间线`);
  }, [objects, remapActionClip, selectedHumanoid?.id, selectedId]);
  const editClipMapping = useCallback((clip: ActionClip) => {
    const current = Object.entries(clip.customBoneMap || {}).map(([semantic, bone]) => `${semantic}=${bone}`).join('\n');
    const input = window.prompt('自定义骨骼映射（每行：语义=目标骨骼名）', current);
    if (input == null) return;
    const customBoneMap: Record<string, string> = {};
    input.split(/\r?\n/).forEach(line => { const [semantic, ...rest] = line.split('='); if (semantic?.trim() && rest.join('=').trim()) customBoneMap[semantic.trim()] = rest.join('=').trim(); });
    setActionClips(prev => prev.map(item => item.id === clip.id ? { ...item, customBoneMap } : item));
    message.success(`已更新「${clip.name}」的自定义骨骼映射（${Object.keys(customBoneMap).length} 项）`);
  }, []);
  const deleteActionClip = useCallback((id: string) => setActionClips(prev => prev.filter(clip => clip.id !== id)), []);
  const pasteTimelineSelection = useCallback(() => {
    const clip = timelineClipboardRef.current;
    if (!clip) { message.info('剪贴板为空'); return; }
    if (clip.kind === 'path' && clip.path) {
      const targetId = selectedId || selectedHumanoid?.id;
      if (!targetId) { message.info('请先选择目标人物'); return; }
      const path = { ...clip.path, targetId, points: clip.path.points.map(point => [...point] as [number, number, number]), startTime: playTime, endTime: playTime + (clip.path.endTime - clip.path.startTime), duration: clip.path.endTime - clip.path.startTime };
      setMotionPaths(prev => [...prev.filter(item => item.targetId !== targetId), path]);
      setActivePathTargetId(targetId);
      message.success('路径已粘贴到当前人物');
      return;
    }
    const source = clip.keyframes || [];
    if (!source.length) return;
    const offset = playTime - source[0].time;
    const pasted = source.map(kf => ({ ...kf, time: Math.max(0, kf.time + offset) }));
    setKeyframes(prev => [...prev, ...pasted].sort((a, b) => a.time - b.time));
    message.success(`已粘贴 ${pasted.length} 个关键帧`);
  }, [playTime, selectedHumanoid?.id, selectedId]);
  const seekTimeline = useCallback((time: number) => {
    const next = Math.max(0, Math.min(timelineDuration, time));
    setPlayTime(next);
    if (playStateRef.current) playStateRef.current.start = performance.now() - next * 1000 / Math.max(0.01, speedFactorRef.current);
  }, [timelineDuration]);
  const scrubTimeline = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    seekTimeline(((event.clientX - rect.left) / rect.width) * timelineDuration / timelineZoom);
  }, [seekTimeline, timelineDuration, timelineZoom]);
  const dragKeyframe = useCallback((event: React.PointerEvent, index: number) => {
    const rect = (event.currentTarget as HTMLElement).parentElement?.getBoundingClientRect();
    if (!rect) return;
    // 记录被拖帧的对象引用：结束排序后按引用找回它，避免索引漂移（updateKeyframe/删除等按 currentKf 操作时改错帧）
    keyframeDragRef.current = { index, originX: event.clientX, originTime: keyframes[index].time, kf: keyframes[index] };
    // 拖动结束若发生了实际位移（>2px），本次点击视为拖动而非选中跳转
    keyframeDragMovedRef.current = false;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }, [keyframes]);
  const moveKeyframe = useCallback((event: React.PointerEvent) => {
    const drag = keyframeDragRef.current;
    const rect = (event.currentTarget as HTMLElement).parentElement?.getBoundingClientRect();
    if (!drag || !rect) return;
    if (Math.abs(event.clientX - drag.originX) > 2) keyframeDragMovedRef.current = true;
    const delta = ((event.clientX - drag.originX) / rect.width) * timelineDuration / timelineZoom;
    const raw = Math.max(0, drag.originTime + delta);
    const time = snapToFrames ? Math.round(raw * fps) / fps : raw;
    // 拖动期间不排序：被拖帧始终停留在 drag.index，避免越过邻帧后 sort 导致索引漂移（拖到邻居帧身上）
    setKeyframes(prev => prev.map((kf, index) => index === drag.index ? { ...kf, time } : kf));
  }, [fps, snapToFrames, timelineDuration, timelineZoom]);
  const endKeyframeDrag = useCallback(() => {
    const drag = keyframeDragRef.current;
    keyframeDragRef.current = null;
    if (!drag || !drag.kf) return;
    // 拖动结束统一按时间排序一次，恢复时间线有序（期间不排序，索引稳定）
    const sorted = [...keyframes].sort((a, b) => a.time - b.time);
    setKeyframes(sorted);
    // 排序后同步 currentKf：被拖帧可能已不在原索引，按对象引用找回（避免 updateKeyframe/删除改错帧）
    if (currentKf === drag.index) {
      const newIndex = sorted.indexOf(drag.kf);
      if (newIndex >= 0) setCurrentKf(newIndex);
    }
  }, [keyframes, currentKf]);
  const onKeyframeClick = useCallback((index: number) => {
    if (keyframeDragMovedRef.current) { keyframeDragMovedRef.current = false; return; }
    jumpToKeyframe(index);
  }, [jumpToKeyframe]);
  const beginRangeMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!rangeSel || keyframes.length === 0) return;
    const s = Math.min(rangeSel.start, rangeSel.end);
    const e = Math.max(rangeSel.start, rangeSel.end);
    // 记录区间内帧的时间与引用快照：拖动期间按快照身份修改，越过邻帧后排序也不会把范围外的帧拖进来
    const selKfs = keyframes.slice(s, e + 1);
    rangeMoveRef.current = { originX: event.clientX, times: selKfs.map(kf => kf.time), kfs: selKfs };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [keyframes, rangeSel]);
  const moveRange = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = rangeMoveRef.current;
    if (!drag || !rangeSel) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const rawDelta = ((event.clientX - drag.originX) / rect.width) * timelineDuration / timelineZoom;
    const minTime = Math.min(...drag.times);
    const delta = Math.max(-minTime, snapToFrames ? Math.round(rawDelta * fps) / fps : rawDelta);
    // 按身份（引用快照内的帧）修改，而不是按 [s,e] 索引区间（排序后索引会漂移）
    setKeyframes(prev => prev.map(kf => drag.kfs!.includes(kf) ? { ...kf, time: Math.max(0, kf.time + delta) } : kf));
  }, [fps, rangeSel, snapToFrames, timelineDuration, timelineZoom]);
  const endRangeMove = useCallback(() => {
    const drag = rangeMoveRef.current;
    rangeMoveRef.current = null;
    if (!drag) return;
    // 拖动结束后统一按时间排序，恢复有序；排序会改变区间索引，同时清除选择高亮避免错位
    setKeyframes(prev => [...prev].sort((a, b) => a.time - b.time));
    setRangeSel(null);
  }, []);
  const selectedPath = motionPaths.find(path => path.targetId === (selectedId || selectedHumanoid?.id));
  const updateMotionPath = useCallback((patch: Partial<MotionPath>, explicitTargetId?: string) => {
    const targetId = explicitTargetId || selectedId || selectedHumanoid?.id;
    if (!targetId) { message.info('请先选择人物或创建一个人物'); return; }
    setMotionPaths(prev => prev.map(path => path.targetId === targetId ? { ...path, ...patch } : path));
  }, [selectedId, selectedHumanoid?.id]);
  const deleteMotionPath = useCallback((targetId?: string) => {
    const id = targetId || selectedPath?.targetId || selectedId || selectedHumanoid?.id;
    if (!id) { message.info('请先选择要删除路径的人物'); return; }
    setMotionPaths(prev => prev.filter(path => path.targetId !== id));
    if (activePathTargetId === id) setActivePathTargetId('');
    setPathEditMode(false);
    if (playing) stopPlay();
    message.success('路径已删除');
  }, [activePathTargetId, playing, selectedHumanoid?.id, selectedId, selectedPath?.targetId, stopPlay]);
  const beginPathTimelineDrag = useCallback((event: React.PointerEvent, path: MotionPath, mode: 'move' | 'start' | 'end') => {
    const track = (event.currentTarget as HTMLElement).parentElement;
    if (!track) return;
    timelineDragRef.current = { targetId: path.targetId, mode, originX: event.clientX, start: path.startTime, end: path.endTime };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }, []);
  const updatePathTimelineDrag = useCallback((event: React.PointerEvent, path: MotionPath) => {
    const drag = timelineDragRef.current;
    const track = (event.currentTarget as HTMLElement).parentElement;
    if (!drag || !track || drag.targetId !== path.targetId) return;
    const delta = ((event.clientX - drag.originX) / track.getBoundingClientRect().width) * timelineDuration / timelineZoom;
    const minLength = 0.2;
    let start = drag.start, end = drag.end;
    if (drag.mode === 'move') { start = Math.max(0, drag.start + delta); end = Math.max(start + minLength, drag.end + delta); }
    if (drag.mode === 'start') start = Math.max(0, Math.min(drag.end - minLength, drag.start + delta));
    if (drag.mode === 'end') end = Math.max(drag.start + minLength, drag.end + delta);
    updateMotionPath({ startTime: start, endTime: end, duration: end - start }, path.targetId);
  }, [timelineDuration, timelineZoom, updateMotionPath]);
  const endPathTimelineDrag = useCallback(() => { timelineDragRef.current = null; }, []);
  useEffect(() => {
    const onTimelineShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z') { event.preventDefault(); if (event.shiftKey) redoTimeline(); else undoTimeline(); }
      else if (key === 'y') { event.preventDefault(); redoTimeline(); }
       else if (key === 'c') { event.preventDefault(); copyTimelineSelection(); }
      else if (key === 'v') { event.preventDefault(); pasteTimelineSelection(); }
    };
    window.addEventListener('keydown', onTimelineShortcut);
    return () => window.removeEventListener('keydown', onTimelineShortcut);
  }, [copyTimelineSelection, pasteTimelineSelection, redoTimeline, undoTimeline]);

  const ensureMotionPath = useCallback((targetId?: string) => {
    const id = targetId || selectedId || selectedHumanoid?.id;
    if (!id) { message.info('请先选择人物'); return; }
    setMotionPaths(prev => prev.some(path => path.targetId === id) ? prev : [...prev, { targetId: id, points: [[0, 0, 0], [2, 0, 0]], duration: 4, startTime: 0, endTime: 4, speed: 1, loop: true, closed: false, smooth: true, autoOrient: true, turnSmoothing: 0.35, gait: 'walk', gaitAmount: 1 }]);
  }, [selectedId, selectedHumanoid?.id]);

  // 录制关键帧动画成白模视频（K 帧播放 + MediaRecorder）
  const recordKeyframes = useCallback(() => {
    if (keyframes.length < 2) { message.info('至少 2 个关键帧才能录制动画'); return; }
    const renderer = rendererRef.current;
    if (!renderer) return;
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    const recordFps = Math.max(24, Math.min(60, fps));
    const originalSize = renderer.getSize(new THREE.Vector2());
    const originalAspect = cameraRef.current?.aspect ?? originalSize.x / Math.max(1, originalSize.y);
    const outputSize = ratioDimensions(originalSize.x, originalSize.y, exportRatioRef.current);
    recordingOutputSizeRef.current = outputSize;
    renderer.setSize(outputSize.width, outputSize.height, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.objectFit = 'contain';
    if (cameraRef.current) { cameraRef.current.aspect = outputSize.width / outputSize.height; cameraRef.current.updateProjectionMatrix(); }
    const stream = renderer.domElement.captureStream(recordFps);
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(m => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) || '';
    const recorder = mime ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: recordFps >= 60 ? 32000000 : 24000000 }) : new MediaRecorder(stream, { videoBitsPerSecond: recordFps >= 60 ? 32000000 : 24000000 });
    recorderRef.current = recorder;
    const chunks: Blob[] = [];
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      const name = `白模动画-${Date.now()}`;
      void (async () => {
        const url = await persistBlob(blob, name + '.webm');
        autoSaveToAssets(url, [{ type: 'video', url, filename: name + '.webm' }], name);
        setRecordedUrl(url); setLastMedia({ type: 'video', url, name });
        addDirectorAsset({ type: 'video', url, name });
        message.success('白模动画已保存（点「发送到画布」加到画布）');
      })();
      recordingOutputSizeRef.current = null;
      renderer.setSize(originalSize.x, originalSize.y, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      renderer.domElement.style.objectFit = '';
      if (cameraRef.current) { cameraRef.current.aspect = originalAspect; cameraRef.current.updateProjectionMatrix(); }
      setRecording(false); recorderRef.current = null;
    };
    recorder.start(1000 / recordFps);
    recordingRef.current = true;
    setRecording(true); setRecordedUrl('');
    playKeyframes();
    setPlayTime(0);
    const total = timelineDuration / speedFactorRef.current;
    if (recordTimeoutRef.current != null) window.clearTimeout(recordTimeoutRef.current);
    recordTimeoutRef.current = window.setTimeout(() => { recordTimeoutRef.current = null; if (recorder.state === 'recording') recorder.stop(); stopPlay(); }, total * 1000 + 100);
  }, [keyframes, playKeyframes, stopPlay, persistBlob, addDirectorAsset, fps, timelineDuration]);

  // —— 运镜 ——
  const buildMotion = useCallback((kind: 'orbit' | 'dollyIn' | 'dollyOut', opts?: { angle?: number; duration?: number }): Motion | null => {
    const camera = cameraRef.current, controls = controlsRef.current;
    if (!camera || !controls) return null;
    const center = controls.target.clone();
    const now = performance.now();
    const angleRad = ((opts?.angle ?? 360) * Math.PI) / 180;
    const duration = opts?.duration ?? (kind === 'orbit' ? 12000 : 6000);
    if (kind === 'orbit') {
      const offset = camera.position.clone().sub(center);
      const radius = offset.length(); const startAngle = Math.atan2(offset.x, offset.z);
      return { kind: 'orbit', fromPos: camera.position.clone(), toPos: camera.position.clone(), fromTarget: center.clone(), toTarget: center.clone(), center: center.clone(), radius, startAngle, endAngle: startAngle + angleRad, height: offset.y, startTime: now, duration };
    }
    const dir = camera.position.clone().sub(center).normalize();
    const cur = camera.position.distanceTo(center);
    const targetDist = kind === 'dollyIn' ? Math.max(1.2, cur * 0.4) : Math.min(10, cur * 1.8);
    const toPos = center.clone().add(dir.multiplyScalar(targetDist));
    return { kind: 'lerp', fromPos: camera.position.clone(), toPos, fromTarget: center.clone(), toTarget: center.clone(), startTime: now, duration };
  }, []);

  const startRecording = useCallback(async (kind: 'orbit' | 'dollyIn' | 'dollyOut', opts?: { angle?: number; duration?: number }) => {
    controlsRef.current?.update();
    const renderer = rendererRef.current;
    if (!renderer) return;
    const motion = buildMotion(kind, opts); if (!motion) return;
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    // 先启动运镜（即使录制失败，运镜也要动）

    try {
      const requestedFps = Math.max(24, Math.min(60, fps));
     const recordFps = requestedFps === 60 ? 59.94 : requestedFps;
     const originalSize = renderer.getSize(new THREE.Vector2());
     const originalAspect = cameraRef.current?.aspect ?? originalSize.x / Math.max(1, originalSize.y);
     const outputSize = ratioDimensions(originalSize.x, originalSize.y, exportRatioRef.current);
     recordingOutputSizeRef.current = outputSize;
     renderer.setSize(outputSize.width, outputSize.height, false);
     renderer.domElement.style.width = '100%';
     renderer.domElement.style.height = '100%';
     renderer.domElement.style.objectFit = 'contain';
     if (cameraRef.current) { cameraRef.current.aspect = outputSize.width / outputSize.height; cameraRef.current.updateProjectionMatrix(); }
     const stream = renderer.domElement.captureStream(recordFps);
      const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(m => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) || '';
      let recorder: MediaRecorder;
      try {
        recorder = mime ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: recordFps >= 59 ? 32000000 : 24000000 }) : new MediaRecorder(stream, { videoBitsPerSecond: recordFps >= 59 ? 32000000 : 24000000 });
      } catch {
        recorder = new MediaRecorder(stream, { mimeType: 'video/webm', videoBitsPerSecond: 18000000 });
      }
      recorderRef.current = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const name = `白模运镜-${kind}-${Date.now()}`;
        void (async () => {
          const url = await persistBlob(blob, name + '.webm');
          autoSaveToAssets(url, [{ type: 'video', url, filename: name + '.webm' }], name);
          setRecordedUrl(url); setLastMedia({ type: 'video', url, name });
          addDirectorAsset({ type: 'video', url, name });
          message.success('白模视频已保存（点「发送到画布」加到画布）');
        })();
        recordingRef.current = false;
        recordingOutputSizeRef.current = null;
        renderer.setSize(originalSize.x, originalSize.y, false);
        renderer.domElement.style.width = '100%';
        renderer.domElement.style.height = '100%';
        renderer.domElement.style.objectFit = '';
        if (cameraRef.current) { cameraRef.current.aspect = originalAspect; cameraRef.current.updateProjectionMatrix(); }
       setRecording(false); recorderRef.current = null;
      };
      recorder.start(1000 / recordFps);
      setRecording(true); setRecordedUrl('');
      motion.startTime = performance.now();
      motionRef.current = motion;
      motion.onDone = () => { if (recorder.state === 'recording') recorder.stop(); };
    } catch (e: any) {
      console.warn('MediaRecorder 启动失败，仅运镜不录制', e);
      // M1 修复：录制失败也要让运镜跑起来（此前只设 onDone，motion 从未进入动画循环 → 无运镜也无提示）
      motion.startTime = performance.now();
      motionRef.current = motion;
      motion.onDone = () => { message.info('运镜完成（当前环境录制不可用）'); };
    }
  }, [buildMotion, persistBlob, addDirectorAsset, fps]);

  // 发送到画布：通过事件让画布把素材加到当前视野中心
  const sendToCanvas = useCallback((asset?: { type: 'image' | 'video'; url: string; name: string }) => {
    const media = asset || lastMedia;
    if (!media) return;
    window.dispatchEvent(new CustomEvent('ai-canvas-add-asset', { detail: { type: media.type, url: media.url, name: media.name } }));
    message.success('已发送到画布（素材节点在视野中心）');
    onClose();
  }, [lastMedia, onClose]);

  const capture = useCallback(async () => {
    const renderer = rendererRef.current, scene = sceneRef.current, camera = cameraRef.current;
    if (!renderer || !scene || !camera) return;
    setCapturing(true);
    try {
      renderer.render(scene, camera);
      const rawDataUrl = renderer.domElement.toDataURL('image/png');
      const dataUrl = await cropToRatio(rawDataUrl, exportRatioRef.current);
      // base64 → blob（不依赖 fetch(data:)），再持久化到磁盘 file:// 永久保存
      const comma = dataUrl.indexOf(',');
      const byteString = atob(dataUrl.slice(comma + 1));
      const mime = (dataUrl.match(/^data:(.*?);/) || [])[1] || 'image/png';
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
      const blob = new Blob([ab], { type: mime });
      const name = `白模参考-${materialMode}-${Date.now()}`;
      const url = await persistBlob(blob, name + '.png');
      autoSaveToAssets(url, [{ type: 'image', url, filename: name + '.png' }], name);
      setLastMedia({ type: 'image', url, name });
      addDirectorAsset({ type: 'image', url, name });
      message.success('截图已保存到素材库（点「发送到画布」加到画布）');
    } catch (e: any) { message.error('截图失败：' + String(e?.message || e)); }
    finally { setCapturing(false); }
  }, [materialMode, persistBlob, addDirectorAsset]);

  // Gizmo 模式切换 + 启用/禁用
  useEffect(() => { transformControlsRef.current?.setMode(gizmoMode); }, [gizmoMode]);
  useEffect(() => {
    const tc = transformControlsRef.current;
    if (!tc) return;
    if (gizmoEnabled) { const obj = objectsRef.current.find(o => o.id === selectedIdRef.current); if (obj) tc.attach(obj.root); }
    else tc.detach();
  }, [gizmoEnabled, selectedId]);

  // 光影设置
  useEffect(() => { if (keyLightRef.current) keyLightRef.current.intensity = lightKey; }, [lightKey]);
  useEffect(() => { if (ambLightRef.current) ambLightRef.current.intensity = lightAmb; }, [lightAmb]);
  useEffect(() => { if (keyLightRef.current) keyLightRef.current.position.set(lightPos.x, lightPos.y, lightPos.z); }, [lightPos]);
  useEffect(() => { if (sceneRef.current) { sceneRef.current.background = new THREE.Color(bgColor); sceneRef.current.fog = new THREE.Fog(bgColor, 12, 30); } }, [bgColor]);

  // 切到人物视角时，把相机移到目标人物头部后方
  useEffect(() => {
    if (viewMode !== 'character') return;
    const humanoid = objectsRef.current.find(o => (characterTarget ? o.id === characterTarget : o.kind === 'humanoid')) || objectsRef.current.find(o => o.kind === 'humanoid');
    const head = humanoid?.bones?.find(b => b.name === 'Head');
    if (head && cameraRef.current && controlsRef.current) {
      const wp = new THREE.Vector3();
      head.getWorldPosition(wp);
      cameraRef.current.position.copy(wp).add(new THREE.Vector3(0, 0.3, 2.5));
      controlsRef.current.target.copy(wp);
    }
  }, [viewMode, characterTarget]);

  // 构建场景上下文字符串：让 AI 知道"什么在什么地方、哪个模型是什么、相机在哪"
  const buildSceneContext = useCallback((): string => {
    const lines: string[] = [];
    lines.push('【场景物体】（坐标单位米，y 轴向上，地面在 y=0）');
    if (!objectsRef.current.length) lines.push('（空场景，没有任何物体）');
    objectsRef.current.forEach((o, i) => {
      const p = o.root.position;
      const kindLabel = o.kind === 'humanoid' ? '人物' : o.kind === 'prop' ? '道具' : o.kind === 'environment' ? '环境' : '几何体';
      lines.push(`${i + 1}.「${o.name}」（${kindLabel}）位置 x=${p.x.toFixed(1)}, y=${p.y.toFixed(1)}, z=${p.z.toFixed(1)}`);
    });
    const cam = cameraRef.current, ctl = controlsRef.current;
    if (cam && ctl) {
      lines.push('');
      lines.push('【相机】');
      lines.push(`位置 x=${cam.position.x.toFixed(1)}, y=${cam.position.y.toFixed(1)}, z=${cam.position.z.toFixed(1)}`);
      lines.push(`看向目标 x=${ctl.target.x.toFixed(1)}, y=${ctl.target.y.toFixed(1)}, z=${ctl.target.z.toFixed(1)}`);
    }
    return lines.join('\n');
  }, []);

  // —— AI 运镜 / 摆姿势（优先走 DSH，未装 DSH 时回退聊天 AI 配置）——
  const runAiMotion = useCallback(async () => {
    const prompt = aiPrompt.trim(); if (!prompt) { message.warning('请描述运镜'); return; }
    setAiLoading(true);
    try {
      const sceneCtx = buildSceneContext();
      const sysPrompt = `你是 3D 导演台的运镜助手。下面是当前场景信息，请据此理解"什么在什么地方、相机在哪"。

${sceneCtx}

把描述转成 JSON：{"type":"orbit"|"dollyIn"|"dollyOut","angle":环绕角度(度,默认360),"duration":时长(秒,默认4)}。环绕/转圈→orbit（围绕相机当前看向的目标）；推近/特写→dollyIn；拉远/全景→dollyOut。只输出 JSON。`;
      let text = '';
      const { dshAsk } = await import('@/services/dsh.service');
      const usable = await dshAsk({ task: prompt, systemPrompt: sysPrompt, timeoutMs: 8 * 60 * 1000 });
      if (usable.ok && usable.text.trim()) {
        text = usable.text.trim();
      } else {
        const { sendChat } = await import('@/services/chat.service');
        const res = await sendChat(prompt, [], [], undefined, { systemPrompt: sysPrompt });
        text = String(res?.text || '').trim();
      }
      const m = text.match(/\{[\s\S]*\}/); if (!m) throw new Error('AI 未返回有效运镜');
      const obj = JSON.parse(m[0].replace(/,\s*}/g, '}').replace(/,\s*]/g, ']'));
      const kind: 'orbit' | 'dollyIn' | 'dollyOut' = obj.type === 'orbit' ? 'orbit' : obj.type === 'dollyOut' ? 'dollyOut' : 'dollyIn';
      const angle = Math.max(30, Math.min(720, Number(obj.angle) || 360));
      const durationMs = Math.max(2000, Math.min(15000, (Number(obj.duration) || 4) * 1000));
      await startRecording(kind, { angle, duration: durationMs });
    } catch (e: any) { message.error('AI 运镜失败：' + String(e?.message || e)); }
    finally { setAiLoading(false); }
  }, [aiPrompt, startRecording, buildSceneContext]);

  const applyPosePreset = useCallback((preset: 'idle' | 'walk' | 'run' | 'point') => {
    const obj = objectsRef.current.find(o => o.id === selectedIdRef.current);
    if (!obj?.bones || obj.kind !== 'humanoid') { message.info('请先选择一个人物'); return; }
    const values: Record<string, [number, number, number]> = {
      Hips: preset === 'run' ? [0.08, 0, 0] : [0, 0, 0],
      Spine: preset === 'run' ? [-0.08, 0, 0] : [0, 0, 0],
      Chest: preset === 'run' ? [-0.12, 0, 0] : [0, 0, 0],
      LeftUpperArm: preset === 'idle' ? [0, 0, 0.08] : preset === 'point' ? [0, 0, -1.1] : [preset === 'run' ? -0.9 : -0.45, 0, 0.12],
      RightUpperArm: preset === 'point' ? [0, 0, 1.1] : preset === 'idle' ? [0, 0, -0.08] : [preset === 'run' ? 0.9 : 0.45, 0, -0.12],
      LeftLowerArm: preset === 'point' ? [0, 0, -0.15] : [preset === 'run' ? -0.35 : -0.15, 0, 0],
      RightLowerArm: preset === 'point' ? [0, 0, 0.15] : [preset === 'run' ? 0.35 : 0.15, 0, 0],
      LeftUpperLeg: preset === 'walk' ? [0.38, 0, 0] : preset === 'run' ? [0.65, 0, 0] : [0, 0, 0],
      RightUpperLeg: preset === 'walk' ? [-0.38, 0, 0] : preset === 'run' ? [-0.65, 0, 0] : [0, 0, 0],
      LeftLowerLeg: preset === 'run' ? [-0.55, 0, 0] : [0, 0, 0],
      RightLowerLeg: preset === 'run' ? [0.55, 0, 0] : [0, 0, 0],
    };
    obj.bones.forEach((bone, index) => { const value = values[obj.boneNames?.[index] || bone.name]; if (value) bone.rotation.set(value[0], value[1], value[2]); });
    const rots: Record<string, [number, number, number]> = {};
    obj.bones.forEach((bone, index) => { rots[obj.boneNames?.[index] || bone.name] = [bone.rotation.x, bone.rotation.y, bone.rotation.z]; });
    setBoneRots(rots);
    message.success(`已应用${preset === 'idle' ? '待机' : preset === 'walk' ? '行走' : preset === 'run' ? '跑步' : '指向'}姿势`);
  }, []);

  const runAiPose = useCallback(async () => {
    const prompt = posePrompt.trim(); if (!prompt) { message.warning('请描述姿势'); return; }
    if (!boneNames.length) { message.warning('请先选中一个人物对象'); return; }
    setPoseLoading(true);
    try {
      const { sendChat } = await import('@/services/chat.service');
      const sceneCtx = buildSceneContext();
      const selObj = objectsRef.current.find(o => o.id === selectedIdRef.current);
      const selName = selObj?.name || '选中人物';
      const selPos = selObj ? `x=${selObj.root.position.x.toFixed(1)}, y=${selObj.root.position.y.toFixed(1)}, z=${selObj.root.position.z.toFixed(1)}` : '未知';
      const selYaw = selObj ? `${(selObj.root.rotation.y * 180 / Math.PI).toFixed(0)}°` : '未知';
      const boneDetails = boneNames.map((b, i) => {
        const bone = selObj?.bones?.[i];
        const cur = bone ? `当前 x=${bone.rotation.x.toFixed(2)}, y=${bone.rotation.y.toFixed(2)}, z=${bone.rotation.z.toFixed(2)}` : '当前 0,0,0';
        return `${b}（${boneLabels[i] || b}）：${cur}`;
      }).join('\n');
      const list = boneNames.map((b, i) => boneLabels[i] ? `${b}（${boneLabels[i]}）` : b).join('、');
      const res = await sendChat(prompt, [], [], undefined, { systemPrompt: `你是 3D 摆姿势助手。下面是当前场景信息，请据此理解"什么在什么地方"。

${sceneCtx}

【要摆姿势的人物】名称「${selName}」，位置 ${selPos}，朝向 yaw=${selYaw}（0°=面朝 -Z，正值=朝右转）。

【骨骼列表与当前旋转】（单位弧度，90°≈1.57）
${boneDetails}

骨骼层级：Hips(骨盆)→Spine(躯干)→Chest(胸)→Neck(颈)→Head(头)；左右上臂→左右小臂→左右手；左右大腿→左右小腿→左右脚。
旋转语义：x=绕身体左右轴前后摆（正=向前）；y=绕竖直轴左右转（正=向身体外侧）；z=绕身体前后轴侧抬。
重要：描述里的"左/右"要相对人物朝向（人物面朝 yaw 方向），不是世界坐标的左右；例如人物背对你时，你的"左"是它的"右"。
把描述转成 JSON：{"bones":[{"name":"骨骼名","rotation":{"x":弧度,"y":弧度,"z":弧度}}]}。只改需要动的骨骼（用上面的英文骨骼名）；单位弧度；只输出 JSON。` });
      const text = String(res?.text || '').trim();
      const m = text.match(/\{[\s\S]*\}/); if (!m) throw new Error('AI 未返回有效姿势');
      const obj = JSON.parse(m[0].replace(/,\s*}/g, '}').replace(/,\s*]/g, ']'));
      const obj3d = objectsRef.current.find(o => o.id === selectedIdRef.current);
      let applied = 0;
      for (const item of (Array.isArray(obj.bones) ? obj.bones : [])) {
        const idx = boneNames.indexOf(String(item.name || '')); if (idx < 0) continue;
        const bone = obj3d?.bones?.[idx]; if (!bone) continue;
        const r = item.rotation || {};
        bone.rotation.x = Number(r.x) || 0; bone.rotation.y = Number(r.y) || 0; bone.rotation.z = Number(r.z) || 0; applied++;
      }
      if (!applied) throw new Error('AI 输出的骨骼名不匹配');
      message.success(`已摆好姿势（${applied} 个骨骼）`);
    } catch (e: any) { message.error('AI 摆姿势失败：' + String(e?.message || e)); }
    finally { setPoseLoading(false); }
  }, [boneNames, boneLabels, posePrompt, buildSceneContext]);

  // 场景初始化
  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const width = el.clientWidth || 800, height = el.clientHeight || 600;
    let disposed = false; let animationId = 0;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1f2a);
    scene.fog = new THREE.Fog(0x1a1f2a, 12, 30);
    sceneRef.current = scene;

    // 三点光照 + 阴影
    const amb = new THREE.AmbientLight(0xffffff, 0.35); scene.add(amb); ambLightRef.current = amb;
    const hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 0.5); scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(4, 6, 3); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048); key.shadow.camera.near = 0.5; key.shadow.camera.far = 40;
    key.shadow.camera.left = -30; key.shadow.camera.right = 30; key.shadow.camera.top = 30; key.shadow.camera.bottom = -30;
    key.shadow.bias = -0.0005; scene.add(key); keyLightRef.current = key;
    const rim = new THREE.DirectionalLight(0x8899bb, 0.8); rim.position.set(-3, 2, -4); scene.add(rim);

    // 地面：网格 + 接收阴影的地面
    const grid = new THREE.GridHelper(60, 60, 0x3a4356, 0x232936); scene.add(grid);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0xe8edf2, roughness: 0.9 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.005; ground.receiveShadow = true; scene.add(ground);
    groundRef.current = ground;
    const pathVisualGroup = new THREE.Group();
    pathVisualGroup.name = 'director-path-controls';
    scene.add(pathVisualGroup);
    pathVisualGroupRef.current = pathVisualGroup;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(3.2, 2.2, 3.8); cameraRef.current = camera;
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08; controls.target.set(0, 0.8, 0);
    controls.rotateSpeed = 1; controls.zoomSpeed = 1;
    controlsRef.current = controls;

    // Gizmo（TransformControls）：直接拖拽移动/旋转/缩放选中物体
    const gizmoScene = new THREE.Scene();
    const tc = new TransformControls(camera, renderer.domElement);
    tc.setMode('translate');
    transformControlsRef.current = tc;
    gizmoScene.add(tc.getHelper());
    tc.addEventListener('dragging-changed', (e: any) => {
      // M4 修复：FPV/运镜录制期间不恢复 OrbitControls（否则与 FPV 帧循环打架、相机被 orbit 拉走）
      controls.enabled = !e.value && !fpvActiveRef.current && !camRecordingRef.current;
    });
    tc.addEventListener('objectChange', () => {
      const obj = objectsRef.current.find(o => o.id === selectedIdRef.current);
      if (obj) {
        const p = obj.root.position, r = obj.root.rotation, s = obj.root.scale;
        setSelTransform({ px: p.x, py: p.y, pz: p.z, rx: r.x, ry: r.y, rz: r.z, sx: s.x, sy: s.y, sz: s.z });
      }
    });

    const clock = new THREE.Clock();
    const animate = () => {
      if (disposed) return;
      const delta = clock.getDelta();
      // 运镜动画
      const motion = motionRef.current;
      if (motion) {
        const t = Math.min(1, (performance.now() - motion.startTime) / motion.duration);
        const e = easeInOut(t);
        if (motion.kind === 'orbit' && motion.center && motion.radius != null && motion.startAngle != null && motion.endAngle != null) {
          const a = motion.startAngle + (motion.endAngle - motion.startAngle) * e;
          camera.position.set(motion.center.x + motion.radius * Math.sin(a), motion.center.y + (motion.height ?? 0), motion.center.z + motion.radius * Math.cos(a));
          controls.target.copy(motion.center);
        } else { camera.position.lerpVectors(motion.fromPos, motion.toPos, e); controls.target.lerpVectors(motion.fromTarget, motion.toTarget, e); }
        if (t >= 1) { motionRef.current = null; motion.onDone?.(); }
      }
      // Clear the last procedural offset for every character before sampling this frame.
      // This must happen even when a character has no keyframe on the current track.
      for (const object of objectsRef.current) clearProceduralGait(object);
      // 关键帧动画播放
      const ps = playStateRef.current;
      if (ps) {
        const now = performance.now();
        const total = Math.max(0.001, ps.total ?? ps.kfs[ps.kfs.length - 1].time);
        const rawTime = ((now - ps.start) / 1000) * speedFactorRef.current;
        const t = Math.min(total, Math.max(0, rawTime));
        if (now - lastPlayTimeSync.current > 100) { lastPlayTimeSync.current = now; setPlayTime(t); }
        if (rawTime >= total) { playStateRef.current = null; setPlaying(false); }
        const kfs = ps.kfs;
        let i = 0;
        while (i < kfs.length - 1 && kfs[i + 1].time <= t) i++;
        const a = kfs[i], b = kfs[Math.min(i + 1, kfs.length - 1)];
        const span = Math.max(0.001, b.time - a.time);
        const f = Math.min(1, Math.max(0, (t - a.time) / span));
        const e = easeInOut(f);
        for (const o of objectsRef.current) {
          const ta = a.objects[o.id], tb = b.objects[o.id];
          if (!ta || !tb) continue;
          o.root.position.set(ta.pos[0] + (tb.pos[0] - ta.pos[0]) * e, ta.pos[1] + (tb.pos[1] - ta.pos[1]) * e, ta.pos[2] + (tb.pos[2] - ta.pos[2]) * e);
          o.root.rotation.set(ta.rot[0] + (tb.rot[0] - ta.rot[0]) * e, ta.rot[1] + (tb.rot[1] - ta.rot[1]) * e, ta.rot[2] + (tb.rot[2] - ta.rot[2]) * e);
          o.root.scale.set(ta.scale[0] + (tb.scale[0] - ta.scale[0]) * e, ta.scale[1] + (tb.scale[1] - ta.scale[1]) * e, ta.scale[2] + (tb.scale[2] - ta.scale[2]) * e);
          o.bones?.forEach((bone, bi) => {
            const ka = a.bones[`${o.id}:${bone.name}`] || b.bones[`${o.id}:${bone.name}`];
            const kb = b.bones[`${o.id}:${bone.name}`] || a.bones[`${o.id}:${bone.name}`];
            if (ka && kb) bone.rotation.set(ka[0] + (kb[0] - ka[0]) * e, ka[1] + (kb[1] - ka[1]) * e, ka[2] + (kb[2] - ka[2]) * e);
          });
        }
        // 路径在关键帧根节点插值之后应用；骨骼姿态仍由关键帧驱动。
        for (const path of motionPathsRef.current) {
          const target = objectsRef.current.find(object => object.id === path.targetId);
          if (target) applyMotionPath(target, path, t);
        }
        // 相机轨迹插值（可开关平滑：Catmull-Rom 样条 / 线性）
        if (a.camera && b.camera) {
          if (smoothCamRef.current) {
            const p0 = (kfs[Math.max(0, i - 1)].camera || a.camera);
            const p3 = (kfs[Math.min(kfs.length - 1, i + 2)].camera || b.camera);
            const pp = catmullRom(p0.pos, a.camera.pos, b.camera.pos, p3.pos, f);
            const tt = catmullRom(p0.target, a.camera.target, b.camera.target, p3.target, f);
            camera.position.set(pp[0], pp[1], pp[2]);
            controls.target.set(tt[0], tt[1], tt[2]);
          } else {
            // 线性插值：用原始时间 f（不用 easeInOut），保证录制匀速位移 → 播放匀速位移
            camera.position.set(a.camera.pos[0] + (b.camera.pos[0] - a.camera.pos[0]) * f, a.camera.pos[1] + (b.camera.pos[1] - a.camera.pos[1]) * f, a.camera.pos[2] + (b.camera.pos[2] - a.camera.pos[2]) * f);
            controls.target.set(a.camera.target[0] + (b.camera.target[0] - a.camera.target[0]) * f, a.camera.target[1] + (b.camera.target[1] - a.camera.target[1]) * f, a.camera.target[2] + (b.camera.target[2] - a.camera.target[2]) * f);
          }
        }
      }
      // 人物视角：第一人称（相机在人物眼睛，朝向可旋转）
      if (viewModeRef.current === 'character' && !playStateRef.current && !motionRef.current) {
        const humanoid = objectsRef.current.find(o => (characterTargetRef.current ? o.id === characterTargetRef.current : o.kind === 'humanoid')) || objectsRef.current.find(o => o.kind === 'humanoid');
        const head = humanoid?.bones?.find(b => b.name === 'Head');
        if (head) {
          const wp = new THREE.Vector3();
          head.getWorldPosition(wp);
          camera.position.copy(wp).add(new THREE.Vector3(0, 0.08, 0));
          const { yaw, pitch } = charRotRef.current;
          const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
          camera.lookAt(wp.clone().add(dir.multiplyScalar(5)));
          controls.target.copy(wp.clone().add(dir.multiplyScalar(5)));
        }
      }
      // 自由视角：FPV 录制时用无人机式（鼠标=朝向，键盘=沿朝向移动）；普通自由视角用 OrbitControls WASD
      if (viewModeRef.current === 'free' && !playStateRef.current) {
        if (fpvActiveRef.current) {
          // 无人机模式：先应用 yaw/pitch 朝向，再沿朝向（含上下）移动，target 跟随朝向往屏幕中心
          camera.quaternion.setFromEuler(new THREE.Euler(fpvPitchRef.current, fpvYawRef.current, 0, 'YXZ'));
          const k = camKeysRef.current;
          if (k['w'] || k['a'] || k['s'] || k['d'] || k['q'] || k['e']) {
            const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
            const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
            const speed = camSpeedRef.current;
            const move = new THREE.Vector3();
            if (k['w']) move.add(fwd.clone().multiplyScalar(speed));
            if (k['s']) move.add(fwd.clone().multiplyScalar(-speed));
            if (k['d']) move.add(right.clone().multiplyScalar(speed));
            if (k['a']) move.add(right.clone().multiplyScalar(-speed));
            if (k['e']) move.y += speed;
            if (k['q']) move.y -= speed;
            camera.position.add(move);
          }
          const fwd2 = new THREE.Vector3(); camera.getWorldDirection(fwd2);
          controls.target.copy(camera.position).add(fwd2.multiplyScalar(5));
        } else {
          const k = camKeysRef.current;
          if (k['w'] || k['a'] || k['s'] || k['d'] || k['q'] || k['e']) {
            const dir = new THREE.Vector3();
            camera.getWorldDirection(dir); dir.y = 0; dir.normalize();
            const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
            const speed = camSpeedRef.current;
            const move = new THREE.Vector3();
            if (k['w']) move.add(dir.clone().multiplyScalar(speed));
            if (k['s']) move.add(dir.clone().multiplyScalar(-speed));
            if (k['d']) move.add(right.clone().multiplyScalar(speed));
            if (k['a']) move.add(right.clone().multiplyScalar(-speed));
            if (k['e']) move.y += speed;
            if (k['q']) move.y -= speed;
            camera.position.add(move);
            controls.target.add(move);
          }
        }
      }
      // 相机运镜录制采样（每 100ms 采样一次相机轨迹 + 物体/骨骼状态，模型摆姿势也会一起录进时间线）
      if (camRecordingRef.current) {
        const now = performance.now();
        if (now - camLastSampleRef.current >= 100) {
          camLastSampleRef.current = now;
          const elapsed = (now - camRecordStartRef.current) / 1000;
          const objects: Keyframe['objects'] = {};
          const bones: Keyframe['bones'] = {};
          for (const o of objectsRef.current) {
            objects[o.id] = { pos: [o.root.position.x, o.root.position.y, o.root.position.z], rot: [o.root.rotation.x, o.root.rotation.y, o.root.rotation.z], scale: [o.root.scale.x, o.root.scale.y, o.root.scale.z] };
            o.bones?.forEach((b, i) => { bones[`${o.id}:${b.name}`] = [b.rotation.x, b.rotation.y, b.rotation.z]; });
          }
          camSamplesRef.current.push({
            time: elapsed,
            pos: [camera.position.x, camera.position.y, camera.position.z],
            target: [controls.target.x, controls.target.y, controls.target.z],
            objects, bones,
          });
        }
      }
      controls.update();
      renderer.render(scene, camera);
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(gizmoScene, camera);
      renderer.autoClear = true;
      animationId = requestAnimationFrame(animate);
    };
    animate();

    let lastWidth = 0, lastHeight = 0;
    const onResize = () => {
      if (recordingOutputSizeRef.current) return;
      const w = el.clientWidth || 800, h = el.clientHeight || 600;
      if (w === lastWidth && h === lastHeight) return;
      lastWidth = w; lastHeight = h;
      renderer.setSize(w, h);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(el);

    const updatePathVisuals = () => {
      const group = pathVisualGroupRef.current;
      if (!group) return;
      while (group.children.length) {
        const child = group.children.pop();
        if (child) { child.traverse(node => { const mesh = node as THREE.Mesh; mesh.geometry?.dispose(); if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose()); else (mesh.material as THREE.Material)?.dispose(); }); }
      }
      const show = !recordingRef.current && pathEditModeRef.current;
      group.visible = show;
      if (!show) return;
      for (const path of motionPathsRef.current) {
        if (!path.points.length) continue;
        const active = path.targetId === activePathTargetRef.current;
        const color = active ? 0xf59e0b : 0x60a5fa;
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(path.points.map(p => new THREE.Vector3(p[0], 0.025, p[2]))), new THREE.LineBasicMaterial({ color, transparent: true, opacity: active ? 0.95 : 0.45 }));
        group.add(line);
        path.points.forEach((point, index) => {
          const marker = new THREE.Mesh(new THREE.SphereGeometry(active ? 0.085 : 0.055, 12, 8), new THREE.MeshBasicMaterial({ color }));
          marker.position.set(point[0], 0.06, point[2]);
          marker.userData = { pathTargetId: path.targetId, pathIndex: index };
          marker.visible = active || pathEditModeRef.current;
          group.add(marker);
        });
      }
    };

    // 点击选中物体；路径编辑模式下由专用指针事件处理。
    const onClick = (e: MouseEvent) => {
      if (pathEditModeRef.current) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointerRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycasterRef.current.setFromCamera(pointerRef.current, camera);
      const pickables: THREE.Object3D[] = [];
      for (const o of objectsRef.current) o.root.traverse(c => { if ((c as THREE.Mesh).isMesh) pickables.push(c); });
      const hits = raycasterRef.current.intersectObjects(pickables, false);
      if (hits.length) {
        let hit = hits[0].object; while (hit.parent && !objectsRef.current.some(o => o.root === hit)) hit = hit.parent;
        const obj = objectsRef.current.find(o => hit === o.root || (hit && o.root.getObjectById(hit.id) === hit));
        const owner = objectsRef.current.find(o => { let cur: THREE.Object3D | null = hits[0].object; while (cur) { if (cur === o.root) return true; cur = cur.parent; } return false; });
        if (owner) selectObject(owner.id);
        else { selectedIdRef.current = ''; setSelectedId(''); setBoneNames([]); setBoneLabels([]); setBoneRots({}); transformControlsRef.current?.detach(); }
      } else {
        // 点击空白处取消选择
        selectedIdRef.current = ''; setSelectedId(''); setBoneNames([]); setBoneLabels([]); setBoneRots({});
        transformControlsRef.current?.detach();
      }
    };
    renderer.domElement.addEventListener('click', onClick);
    const pathPointAt = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycasterRef.current.setFromCamera(pointerRef.current, camera);
      return raycasterRef.current.intersectObject(ground, false)[0]?.point || null;
    };
    const onPathPointerDown = (e: MouseEvent) => {
      if (!pathEditModeRef.current || (e.button !== 0 && e.button !== 2)) return;
      const group = pathVisualGroupRef.current;
      if (!group) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointerRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycasterRef.current.setFromCamera(pointerRef.current, camera);
      const marker = raycasterRef.current.intersectObjects(group.children.filter(child => child instanceof THREE.Mesh), false)[0]?.object;
      if (marker?.userData?.pathTargetId === activePathTargetRef.current) {
        if (e.button === 2 || e.shiftKey || e.ctrlKey || e.metaKey) {
          const targetId = String(marker.userData.pathTargetId);
          const index = Number(marker.userData.pathIndex);
          setMotionPaths(prev => prev.map(path => path.targetId === targetId ? { ...path, points: path.points.length > 2 ? path.points.filter((_, pointIndex) => pointIndex !== index) : path.points } : path));
          e.preventDefault();
          return;
        }
        pathDragRef.current = { index: marker.userData.pathIndex };
        controls.enabled = false;
        e.preventDefault();
        return;
      }
      const point = pathPointAt(e);
      const targetId = activePathTargetRef.current;
      if (!point || !targetId) return;
      setMotionPaths(prev => prev.map(path => path.targetId === targetId ? { ...path, points: [...path.points, [point.x, 0, point.z]] } : path));
      e.preventDefault();
    };
    const onPathPointerMove = (e: MouseEvent) => {
      const drag = pathDragRef.current;
      if (!pathEditModeRef.current || !drag) return;
      const point = pathPointAt(e);
      const targetId = activePathTargetRef.current;
      if (!point || !targetId) return;
      setMotionPaths(prev => prev.map(path => path.targetId === targetId ? { ...path, points: path.points.map((value, index) => index === drag.index ? [point.x, 0, point.z] : value) } : path));
    };
    const onPathPointerUp = () => { if (pathDragRef.current && !fpvActiveRef.current && !camRecordingRef.current) controls.enabled = true; pathDragRef.current = null; };
    renderer.domElement.addEventListener('mousedown', onPathPointerDown);
    renderer.domElement.addEventListener('contextmenu', event => { if (pathEditModeRef.current) event.preventDefault(); });
    window.addEventListener('mousemove', onPathPointerMove);
    window.addEventListener('mouseup', onPathPointerUp);

    // 人物视角下，鼠标拖动旋转朝向
    const onCharMouseDown = (e: MouseEvent) => { if (viewModeRef.current === 'character') charDragRef.current = { x: e.clientX, y: e.clientY }; };
    const onCharMouseMove = (e: MouseEvent) => {
      if (!charDragRef.current || viewModeRef.current !== 'character') return;
      const dx = e.clientX - charDragRef.current.x;
      const dy = e.clientY - charDragRef.current.y;
      charDragRef.current = { x: e.clientX, y: e.clientY };
      charRotRef.current.yaw -= dx * 0.005;
      charRotRef.current.pitch -= dy * 0.005;
      charRotRef.current.pitch = Math.max(-1.5, Math.min(1.5, charRotRef.current.pitch));
    };
    const onCharMouseUp = () => { charDragRef.current = null; };
    renderer.domElement.addEventListener('mousedown', onCharMouseDown);
    window.addEventListener('mousemove', onCharMouseMove);
    window.addEventListener('mouseup', onCharMouseUp);

    // FPV 无人机模式：pointer lock 下用 movementX/Y 更新朝向（鼠标移动=转向，屏幕中心=前进方向）
    const onFpvMouseMove = (e: MouseEvent) => {
      if (!fpvActiveRef.current) return;
      fpvYawRef.current -= (e.movementX || 0) * 0.002;
      fpvPitchRef.current -= (e.movementY || 0) * 0.002;
      fpvPitchRef.current = Math.max(-1.5, Math.min(1.5, fpvPitchRef.current));
    };
    window.addEventListener('mousemove', onFpvMouseMove);

    // WASD 相机移动（自由视角）
    const onCamKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      camKeysRef.current[e.key.toLowerCase()] = true;
    };
    const onCamKeyUp = (e: KeyboardEvent) => { camKeysRef.current[e.key.toLowerCase()] = false; };
    window.addEventListener('keydown', onCamKeyDown);
    window.addEventListener('keyup', onCamKeyUp);

    // 加载外部模型（url 有值时）
    if (url) {
      const loader = new GLTFLoader();
      (async () => {
        let loadUrl = url;
        try {
          const res = await (window as any).electronAPI?.loadMediaB64?.({ url });
          if (res?.b64) { const bytes = Uint8Array.from(atob(res.b64), c => c.charCodeAt(0)); loadUrl = URL.createObjectURL(new Blob([bytes], { type: res.mime || 'model/gltf-binary' })); }
        } catch { }
        if (disposed) return;
        loader.load(loadUrl, gltf => {
          if (disposed) return;
          const root = gltf.scene;
          const box = new THREE.Box3().setFromObject(root); const size = box.getSize(new THREE.Vector3()); const center = box.getCenter(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z, 0.001); const scale = 2.4 / maxDim;
          root.scale.setScalar(scale); root.position.sub(center.clone().multiplyScalar(scale)); root.position.y += 0.01;
          root.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
          scene.add(root);
          const bones: THREE.Bone[] = []; root.traverse(o => { if ((o as any).isBone) bones.push(o as THREE.Bone); });
          const obj: SceneObj = { id: `obj-${Date.now()}`, name: '导入模型', kind: 'geometry', presetKey: 'import', root, bones: bones.length ? bones : undefined, boneNames: bones.length ? bones.map(b => b.name) : undefined, castShadow: true };
          objectsRef.current.push(obj);
          setObjects(prev => [...prev, { id: obj.id, name: obj.name, kind: 'geometry', note: '' }]);
          selectObject(obj.id); setLoaded(true); setView('front');
        }, undefined, err => { console.error('3D 模型加载失败:', err); });
      })();
    } else {
      // 恢复保存的场景；无保存则默认一个人形
      let restored = 0;
      try {
        const saved = localStorage.getItem('director3d-scene');
        if (saved) {
          const parsed = JSON.parse(saved);
          const items = Array.isArray(parsed) ? parsed : (parsed.objects || []);
          if (!Array.isArray(parsed) && parsed.materialMode) setMaterialMode(parsed.materialMode);
          for (const item of items) {
            const preset = PRESET_LIBRARY.find(p => p.key === item.key);
            if (!preset || preset.key === 'import') continue;
            const mat = new THREE.MeshStandardMaterial({ color: 0xdfe6ec, roughness: 0.6 });
            if (item.color) mat.color.set(item.color);
            let root: THREE.Object3D, bones: THREE.Bone[] | undefined;
            if (preset.kind === 'humanoid') {
              const h = makeHumanoid(mat); root = h.root; bones = h.bones;
              if (preset.key === 'humanoid-small') root.scale.setScalar(0.7);
              else if (preset.key === 'humanoid-large') root.scale.setScalar(1.35);
            } else {
              root = preset.kind === 'geometry' ? makeGeometry(preset.key, mat) : preset.kind === 'environment' ? makeEnvironment(preset.key, mat) : makeProp(preset.key, mat);
              if (preset.kind === 'prop') root.position.y = 0.01;
            }
            root.position.set(item.pos?.[0] ?? 0, item.pos?.[1] ?? 0, item.pos?.[2] ?? 0);
            root.rotation.set(item.rot?.[0] ?? 0, item.rot?.[1] ?? 0, item.rot?.[2] ?? 0);
            if (item.scale) root.scale.set(item.scale[0], item.scale[1], item.scale[2]);
            if (item.bones && bones) bones.forEach((b, i) => { if (item.bones[i]) b.rotation.set(item.bones[i][0], item.bones[i][1], item.bones[i][2]); });
            scene.add(root);
            // H3 修复：沿用保存的稳定 id（旧场景无 id 时生成新 id）；L9：恢复自定义 name/note
            const obj: SceneObj = { id: typeof item.id === 'string' && item.id ? item.id : `obj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: typeof item.name === 'string' && item.name ? item.name : preset.label, kind: preset.kind, presetKey: preset.key, root, material: mat, bones, boneNames: bones?.map(b => b.name), castShadow: true };
            objectsRef.current.push(obj);
            setObjects(prev => [...prev, { id: obj.id, name: obj.name, kind: obj.kind, note: typeof item.note === 'string' ? item.note : '' }]);
            restored++;
          }
        }
      } catch { /* 恢复失败回退默认 */ }
      if (restored === 0) {
        addObject({ key: 'humanoid', label: '人物', kind: 'humanoid' });
      }
      setView('front');
    }
    setLoaded(true);

    return () => {
      disposed = true; cancelAnimationFrame(animationId);
      // H4 修复：卸载时停止录制器/退出鼠标锁定/取消录制停止定时器，避免 MediaRecorder 继续采集与卸载后 setState
      if (recordTimeoutRef.current != null) { window.clearTimeout(recordTimeoutRef.current); recordTimeoutRef.current = null; }
      if (recorderRef.current?.state === 'recording') { try { recorderRef.current.stop(); } catch { /* ignore */ } }
      if (document.pointerLockElement) { try { document.exitPointerLock?.(); } catch { /* ignore */ } }
      window.removeEventListener('resize', onResize);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('click', onClick);
      renderer.domElement.removeEventListener('mousedown', onPathPointerDown);
      window.removeEventListener('mousemove', onPathPointerMove);
      window.removeEventListener('mouseup', onPathPointerUp);
      renderer.domElement.removeEventListener('mousedown', onCharMouseDown);
      window.removeEventListener('mousemove', onCharMouseMove);
      window.removeEventListener('mouseup', onCharMouseUp);
      window.removeEventListener('mousemove', onFpvMouseMove);
      window.removeEventListener('keydown', onCamKeyDown);
      window.removeEventListener('keyup', onCamKeyUp);
      // L4 修复：释放场景内所有对象的几何体/材质/纹理（含地面、灯光、overrideMaterial），防长期开关导演台累积 GPU 内存
      try {
        sceneRef.current?.traverse(obj => {
          const mesh = obj as THREE.Mesh;
          if (mesh.isMesh) {
            if (Array.isArray(mesh.material)) mesh.material.forEach(m => { try { m.dispose(); } catch { /* ignore */ } });
            else if (mesh.material) { try { mesh.material.dispose(); } catch { /* ignore */ } }
            if (mesh.geometry) { try { mesh.geometry.dispose(); } catch { /* ignore */ } }
          }
        });
        if (sceneRef.current?.overrideMaterial) { try { sceneRef.current.overrideMaterial.dispose(); } catch { /* ignore */ } }
        sceneRef.current?.clear();
      } catch { /* ignore */ }
      controls.dispose(); transformControlsRef.current?.dispose(); transformControlsRef.current = null; renderer.dispose(); rendererRef.current = null;
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  }, [url, addObject, selectObject, setView]);

  const beginLayoutDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const parent = event.currentTarget.parentElement;
    if (!parent) return;
    layoutDragRef.current = { originY: event.clientY, originRatio: effectiveViewportRatio };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [effectiveViewportRatio]);
  const moveLayoutDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = layoutDragRef.current;
    const parent = event.currentTarget.parentElement;
    if (!drag || !parent) return;
    const height = parent.getBoundingClientRect().height;
    const next = Math.max(0.25, Math.min(0.72, drag.originRatio + (event.clientY - drag.originY) / Math.max(1, height)));
    pendingViewportRatioRef.current = next;
    if (layoutDragFrameRef.current === null) {
      layoutDragFrameRef.current = requestAnimationFrame(() => {
        layoutDragFrameRef.current = null;
        const ratio = pendingViewportRatioRef.current;
        if (ratio !== null) setViewportRatio(ratio);
      });
    }
  }, []);
  const endLayoutDrag = useCallback(() => {
    layoutDragRef.current = null;
    if (layoutDragFrameRef.current !== null) {
      cancelAnimationFrame(layoutDragFrameRef.current);
      layoutDragFrameRef.current = null;
    }
    if (pendingViewportRatioRef.current !== null) setViewportRatio(pendingViewportRatioRef.current);
    pendingViewportRatioRef.current = null;
  }, []);

  // 场景对象列表（UI 用）
  const objectList = useMemo(() => objects, [objects]);

  return (
    <>
    {createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(8,10,16,.95)', display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, color: '#fff', overflow: 'hidden' }}>
      {/* 顶栏 */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,.12)', flexShrink: 0, position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 700, flexShrink: 0 }}>杰斯3D导演台</span>
          <Segmented size="small" value={materialMode} onChange={v => setMaterialMode(v as MaterialMode)} options={[{ label: '白模', value: 'white' }, { label: '灰模', value: 'gray' }, { label: '线框', value: 'wireframe' }, { label: '原色', value: 'original' }]} />
          <Segmented size="small" value={gizmoMode} onChange={v => setGizmoMode(v as 'translate' | 'rotate' | 'scale')} options={[{ label: '移动', value: 'translate' }, { label: '旋转', value: 'rotate' }, { label: '缩放', value: 'scale' }]} />
          <Segmented size="small" value={viewMode} onChange={v => setViewMode(v as 'free' | 'character')} options={[{ label: '第三视角', value: 'free' }, { label: '人物视角', value: 'character' }]} />
          {viewMode === 'character' && (
            <select value={characterTarget} onChange={e => setCharacterTarget(e.target.value)} style={{ background: '#1c2230', color: '#fff', border: '1px solid rgba(255,255,255,.2)', borderRadius: 5, padding: '2px 6px', fontSize: 11, maxWidth: 120 }}>
              <option value="">第一个人物</option>
              {objects.filter(o => o.kind === 'humanoid').map((o, i) => <option key={o.id} value={o.id}>{o.name} {i + 1}</option>)}
            </select>
          )}
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,.55)' }}>机位:</span>
          <select defaultValue="" onChange={event => { const action = event.target.value; if (action === 'focus') focusSelected(); else if (action === 'front') setView('front'); else if (action === 'closeup') setView('closeup'); event.currentTarget.value = ''; }} title="选择机位操作" style={{ background: '#1c2230', color: '#fff', border: '1px solid rgba(255,255,255,.2)', borderRadius: 5, padding: '3px 6px', fontSize: 11 }}>
            <option value="">选择机位操作</option>
            <option value="focus">对焦选中</option>
            <option value="front">正面</option>
            <option value="closeup">特写</option>
          </select>
           <Button size="small" type="text" icon={<CameraOutlined />} style={{ color: '#fff', fontSize: 11 }} onClick={recordShot}>记录机位</Button>
          {cameraShots.map(s => (
            <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, background: 'rgba(99,102,241,.25)', borderRadius: 5, padding: '1px 4px', fontSize: 11 }}>
              <span style={{ cursor: 'pointer', padding: '1px 2px' }} onClick={() => switchShot(s.id)} title="切到该机位">{s.name}</span>
              <span style={{ cursor: 'pointer', color: '#f87171', padding: '1px 2px' }} onClick={() => deleteShot(s.id)} title="删除机位">×</span>
            </span>
          ))}
          <Button size="small" type={showTopPanel ? 'primary' : 'text'} style={{ color: '#fff', fontSize: 11 }} onClick={() => setShowTopPanel(v => !v)}>{showTopPanel ? '收起光影' : '光影/运镜'}</Button>
          <div style={{ flex: 1 }} />
          <Button size="small" type={showAssetsPanel ? 'primary' : 'text'} style={{ color: '#fff', fontSize: 11 }} onClick={() => setShowAssetsPanel(v => !v)}>素材{`（${directorAssets.length}）`}</Button>
          <Button size="small" type="text" icon={<CloseOutlined />} style={{ color: '#fff', flexShrink: 0 }} onClick={handleClose}>关闭</Button>
        </div>
        {showTopPanel && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 5, display: 'flex', gap: 20, padding: '8px 14px 12px', borderTop: '1px solid rgba(255,255,255,.08)', background: 'rgba(20,24,34,.98)', boxShadow: '0 8px 24px rgba(0,0,0,.4)', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 280, flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.8)' }}>光影</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'rgba(255,255,255,.6)' }}><span style={{ width: 40 }}>主光</span><input type="range" min={0} max={3} step={0.05} value={lightKey} onChange={e => setLightKey(Number(e.target.value))} style={{ flex: 1 }} /><span style={{ width: 26, textAlign: 'right' }}>{lightKey.toFixed(1)}</span></label>
              {[['x', 'X'], ['y', 'Y'], ['z', 'Z']].map(([k, label]) => (
                <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'rgba(255,255,255,.6)' }}><span style={{ width: 40 }}>光源{label}</span><input type="range" min={-10} max={10} step={0.5} value={lightPos[k as 'x' | 'y' | 'z']} onChange={e => setLightPos(prev => ({ ...prev, [k]: Number(e.target.value) }))} style={{ flex: 1 }} /><span style={{ width: 26, textAlign: 'right' }}>{lightPos[k as 'x' | 'y' | 'z']}</span></label>
              ))}
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'rgba(255,255,255,.6)' }}><span style={{ width: 40 }}>环境</span><input type="range" min={0} max={1.5} step={0.05} value={lightAmb} onChange={e => setLightAmb(Number(e.target.value))} style={{ flex: 1 }} /><span style={{ width: 26, textAlign: 'right' }}>{lightAmb.toFixed(2)}</span></label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'rgba(255,255,255,.6)' }}><span style={{ width: 40 }}>背景</span><input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)} style={{ width: 32, height: 20, border: 'none', background: 'transparent', cursor: 'pointer' }} /></label>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 280, flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.8)' }}>运镜速度（录制时镜头移动）</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'rgba(255,255,255,.6)' }}><span style={{ width: 40 }}>移动</span><input type="range" min={0.005} max={2} step={0.005} value={camSpeed} onChange={e => setCamSpeed(Number(e.target.value))} style={{ flex: 1 }} /><span style={{ width: 26, textAlign: 'right' }}>{camSpeed.toFixed(3)}</span></label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'rgba(255,255,255,.6)' }}><span style={{ width: 40 }}>旋转</span><input type="range" min={0.05} max={3} step={0.05} value={rotateSpeed} onChange={e => setRotateSpeed(Number(e.target.value))} style={{ flex: 1 }} /><span style={{ width: 26, textAlign: 'right' }}>{rotateSpeed.toFixed(2)}</span></label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'rgba(255,255,255,.6)' }}><span style={{ width: 40 }}>缩放</span><input type="range" min={0.05} max={3} step={0.05} value={zoomSpeed} onChange={e => setZoomSpeed(Number(e.target.value))} style={{ flex: 1 }} /><span style={{ width: 26, textAlign: 'right' }}>{zoomSpeed.toFixed(2)}</span></label>
            </div>
          </div>
        )}
      </div>
      {showAssetsPanel && (
        <div style={{ position: 'absolute', top: 52, right: 14, width: 300, maxHeight: '70vh', overflow: 'auto', background: 'rgba(20,24,34,.98)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 10, padding: 10, zIndex: 12, boxShadow: '0 12px 40px rgba(0,0,0,.5)' }}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: 'rgba(255,255,255,.8)' }}>导演台素材（{directorAssets.length}）</div>
          {directorAssets.length === 0 && <div style={{ fontSize: 9, color: 'rgba(255,255,255,.35)', marginBottom: 6 }}>截图 / 录制后自动存到这里</div>}
          {directorAssets.map(a => (
            <div key={a.id} style={{ marginBottom: 7, border: '1px solid rgba(255,255,255,.1)', borderRadius: 6, padding: 5, background: 'rgba(255,255,255,.03)' }}>
              <MediaThumb url={a.url} type={a.type} onPreview={() => setPreviewItem({ url: a.url, type: a.type, name: a.note || a.name })} style={{ width: '100%', height: 56, borderRadius: 4, cursor: 'zoom-in' }} />
              <input value={a.note} onChange={e => setDirectorAssetNote(a.id, e.target.value)} placeholder="写备注…" style={{ width: '100%', marginTop: 4, background: '#1c2230', color: '#fff', border: '1px solid rgba(255,255,255,.2)', borderRadius: 4, padding: '2px 4px', fontSize: 9, boxSizing: 'border-box' }} />
              <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                <Button size="small" style={{ fontSize: 9, flex: 1 }} onClick={() => sendToCanvas({ type: a.type, url: a.url, name: a.name })}>发画布</Button>
                <Button size="small" danger style={{ fontSize: 9 }} onClick={() => setDirectorAssets(prev => prev.filter(x => x.id !== a.id))}>删</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: `0 0 ${effectiveViewportRatio * 100}%`, minHeight: 180, minWidth: 0, display: 'flex' }}>
        {/* 左侧：物体库 + 对象列表 */}
        <div style={{ width: 212, flexShrink: 0, minHeight: 0, borderRight: '1px solid rgba(255,255,255,.1)', padding: 8, overflow: 'hidden', background: 'rgba(255,255,255,.03)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, color: 'rgba(255,255,255,.8)' }}>场景</div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
            <input value={sceneName} onChange={e => setSceneName(e.target.value)} placeholder="场景名" style={{ flex: 1, background: '#1c2230', color: '#fff', border: '1px solid rgba(255,255,255,.2)', borderRadius: 4, padding: 3, fontSize: 10 }} />
            <Button size="small" onClick={saveScene} style={{ fontSize: 10 }}>保存</Button>
          </div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            <Button size="small" onClick={loadSceneList} style={{ fontSize: 10, flex: 1 }}>刷新列表</Button>
            <Button size="small" danger onClick={() => Modal.confirm({ title: '开始新场地？', content: '将清空当前场景的全部对象、机位与关键帧（素材库中的成品保留），此操作不可撤销。建议先「保存」场景。', okText: '开始新场地', okButtonProps: { danger: true }, cancelText: '取消', onOk: newScene })} style={{ fontSize: 10 }}>新场地</Button>
          </div>
          {savedScenes.map(s => (
            <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 6px', borderRadius: 4, marginBottom: 3, fontSize: 10, background: 'rgba(255,255,255,.05)' }}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }} onClick={() => loadScene(s.name)}>{s.name}</span>
              <DeleteOutlined style={{ fontSize: 11, color: '#f87171', cursor: 'pointer' }} onClick={() => Modal.confirm({ title: `删除场景「${s.name}」？`, content: '删除后不可恢复。', okText: '删除', okButtonProps: { danger: true }, cancelText: '取消', onOk: () => deleteScene(s.name) })} />
            </div>
          ))}
          {savedScenes.length === 0 && <div style={{ fontSize: 9, color: 'rgba(255,255,255,.35)', marginBottom: 6 }}>暂无保存的场景（输入名字点保存）</div>}
          <Button size="small" type={showModelLibrary ? 'primary' : 'default'} onClick={() => setShowModelLibrary(value => !value)} style={{ width: '100%', textAlign: 'left' }}>{showModelLibrary ? '收起模型/物体库' : '展开模型/物体库'} <span style={{ float: 'right' }}>{PRESET_LIBRARY.length}</span></Button>
          {showModelLibrary && <div style={{ maxHeight: '34%', minHeight: 0, overflowY: 'auto', padding: 5, border: '1px solid rgba(255,255,255,.1)', borderRadius: 5, background: 'rgba(0,0,0,.12)' }}><div style={{ fontSize: 11, fontWeight: 600, margin: '2px 0 6px', color: 'rgba(255,255,255,.8)' }}>添加模型 / 物体</div>
          {(['humanoid', 'geometry', 'prop', 'environment'] as PresetKind[]).map(gk => {
            const libItems = PRESET_LIBRARY.filter(p => p.kind === gk);
            if (!libItems.length) return null;
            const libLabel = gk === 'humanoid' ? '人物' : gk === 'geometry' ? '几何体' : gk === 'prop' ? '道具' : '环境';
            return (
              <div key={gk} style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,.4)', margin: '4px 0 3px' }}>{libLabel}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 5 }}>
                  {libItems.map(p => <Button key={p.key} size="small" icon={<PlusOutlined />} style={{ fontSize: 10 }} onClick={() => addObject(p)}>{p.label}</Button>)}
                </div>
              </div>
            );
          })}
           </div>}
           <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 3 }}>
          <div style={{ fontSize: 11, fontWeight: 600, margin: '4px 0 6px', color: 'rgba(255,255,255,.8)' }}>场景对象</div>
          {objectList.length === 0 && <div style={{ fontSize: 10, color: 'rgba(255,255,255,.4)' }}>空场景</div>}
          {(['humanoid', 'geometry', 'prop', 'environment'] as PresetKind[]).map(gk => {
            const gItems = objectList.filter(o => o.kind === gk);
            if (!gItems.length) return null;
            const gLabel = gk === 'humanoid' ? '人物' : gk === 'geometry' ? '几何体' : gk === 'prop' ? '道具' : '环境';
            const collapsed = collapsedGroups[gk];
            return (
              <div key={gk} style={{ marginBottom: 4 }}>
                <div onClick={() => setCollapsedGroups(prev => ({ ...prev, [gk]: !prev[gk] }))} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 6px', cursor: 'pointer', fontSize: 10, color: 'rgba(255,255,255,.55)', background: 'rgba(255,255,255,.03)', borderRadius: 4 }}>
                  <span>{collapsed ? '▶' : '▼'}</span><span>{gLabel}</span><span style={{ marginLeft: 'auto', color: 'rgba(255,255,255,.3)' }}>{gItems.length}</span>
                </div>
                {!collapsed && gItems.map(o => (
                  <div key={o.id} onClick={() => selectObject(o.id)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px 4px 16px', borderRadius: 5, margin: '2px 0', cursor: 'pointer', fontSize: 11, background: selectedId === o.id ? 'rgba(99,102,241,.35)' : 'transparent' }}>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.name}</span>
                    {o.note && <span style={{ fontSize: 9, color: 'rgba(255,255,255,.4)', maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.note}</span>}
                    {selectedId === o.id && <CopyOutlined title="复制" style={{ fontSize: 12, color: 'rgba(255,255,255,.6)' }} onClick={e => { e.stopPropagation(); duplicateObject(); }} />}
                    {selectedId === o.id && <DeleteOutlined style={{ fontSize: 12, color: '#f87171' }} onClick={e => { e.stopPropagation(); Modal.confirm({ title: `删除「${o.name}」？`, content: '删除后不可撤销。', okText: '删除', okButtonProps: { danger: true }, cancelText: '取消', onOk: deleteObject }); }} />}
                  </div>
                ))}
              </div>
            );
          })}
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,.4)', marginTop: 12, lineHeight: 1.5 }}>点物体选中；右侧面板调位置/旋转/缩放；人物可摆骨骼。</div>
        </div>
        </div>

        {/* 中央：视口 */}
<div ref={containerRef} style={{ flex: 1, minWidth: 0, position: 'relative' }} />

        {/* 右侧：选中对象属性面板 */}
        <div style={{ width: 240, flexShrink: 0, borderLeft: '1px solid rgba(255,255,255,.1)', padding: 8, overflow: 'auto', background: 'rgba(255,255,255,.03)' }}>
          {!selectedId ? <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)' }}>未选中对象<br />点视口里的物体或左侧列表选中</div> : (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 10, color: 'rgba(255,255,255,.6)' }}>
                <span>颜色</span>
                <input type="color" value={selColor} onChange={e => setObjectColor(e.target.value)} style={{ width: 32, height: 22, border: 'none', background: 'transparent', cursor: 'pointer' }} />
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,.4)' }}>切到「原色」可见</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 10, color: 'rgba(255,255,255,.6)' }}>
                <span>备注</span>
                <input value={objectList.find(o => o.id === selectedId)?.note || ''} onChange={e => setObjectNote(selectedId, e.target.value)} placeholder="给这个物体写备注" style={{ flex: 1, background: '#1c2230', color: '#fff', border: '1px solid rgba(255,255,255,.2)', borderRadius: 4, padding: 2, fontSize: 10 }} />
              </label>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: 'rgba(255,255,255,.8)' }}>变换</div>
              {[['px', '位置 X'], ['py', '位置 Y'], ['pz', '位置 Z'], ['rx', '旋转 X'], ['ry', '旋转 Y'], ['rz', '旋转 Z']].map(([k, label]) => {
                const isRot = k.startsWith('r');
                const min = isRot ? -3.14 : -50;
                const max = isRot ? 3.14 : 50;
                const step = isRot ? 0.01 : 0.05;
                return (
                <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, fontSize: 10, color: 'rgba(255,255,255,.6)' }}>
                  <span style={{ width: 48 }}>{label}</span>
                  <input type="range" min={min} max={max} step={step} value={Number((selTransform as any)[k])} onChange={e => updateTransform(k, Number(e.target.value))} style={{ flex: 1, height: 18 }} />
                  <span style={{ width: 34, textAlign: 'right', fontSize: 9 }}>{Number((selTransform as any)[k]).toFixed(2)}</span>
                </label>
                );
              })}
              <div style={{ fontSize: 10, fontWeight: 600, margin: '6px 0 5px', color: 'rgba(255,255,255,.55)' }}>尺寸（按钮式 · 无范围限制）</div>
              {[['sx', '长'], ['sy', '高'], ['sz', '宽']].map(([k, label]) => (
                <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, fontSize: 10, color: 'rgba(255,255,255,.6)' }}>
                  <span style={{ width: 48 }}>{label}</span>
                  <Button size="small" onClick={() => updateTransform(k, Math.max(0.01, Number((selTransform as any)[k]) - 0.1))} style={{ fontSize: 10, padding: '0 6px' }}>-</Button>
                  <input type="number" min={0.01} step={0.1} value={Number((selTransform as any)[k])} onChange={e => updateTransform(k, Math.max(0.01, Number(e.target.value) || 0.01))} style={{ flex: 1, background: '#1c2230', color: '#fff', border: '1px solid rgba(255,255,255,.2)', borderRadius: 4, padding: '2px 4px', fontSize: 10, width: 40 }} />
                  <Button size="small" onClick={() => updateTransform(k, Number((selTransform as any)[k]) + 0.1)} style={{ fontSize: 10, padding: '0 6px' }}>+</Button>
                </label>
              ))}
              {boneNames.length > 0 && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 600, margin: '12px 0 8px', color: 'rgba(255,255,255,.8)' }}>骨骼摆姿势（{boneNames.length} 关节）</div>
                  {boneNames.map((b, i) => {
                    const label = boneLabels[i] ? `${b}（${boneLabels[i]}）` : b;
                    const rot = boneRots[b] || [0, 0, 0];
                    const collapsed = collapsedBones[b];
                    return (
                      <div key={b} style={{ marginBottom: 5, border: '1px solid rgba(255,255,255,.08)', borderRadius: 5, padding: 4 }}>
                        <div onClick={() => setCollapsedBones(prev => ({ ...prev, [b]: !prev[b] }))} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 10, color: 'rgba(255,255,255,.75)' }}>
                          <span style={{ fontSize: 9 }}>{collapsed ? '▶' : '▼'}</span>
                          <span style={{ flex: 1 }}>{label}</span>
                        </div>
                        {!collapsed && ['x', 'y', 'z'].map(axis => {
                          const val = axis === 'x' ? rot[0] : axis === 'y' ? rot[1] : rot[2];
                          return (
                            <label key={axis} style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '3px 0 2px 14px', fontSize: 10, color: 'rgba(255,255,255,.6)' }}>
                              <span style={{ width: 12 }}>{axis.toUpperCase()}</span>
                              <input type="range" min={-3.14} max={3.14} step={0.01} value={val} onChange={e => setBoneRotByName(b, axis as 'x' | 'y' | 'z', Number(e.target.value))} style={{ flex: 1, height: 16 }} />
                              <span style={{ width: 30, textAlign: 'right', fontSize: 9 }}>{val.toFixed(2)}</span>
                            </label>
                          );
                        })}
                      </div>
                    );
                  })}
                </>
              )}
            </>
          )}
        </div>
      </div>
      <div onPointerDown={beginLayoutDrag} onPointerMove={moveLayoutDrag} onPointerUp={endLayoutDrag} onPointerCancel={endLayoutDrag} title="拖动调整 3D 视口与导演区比例" style={{ height: 7, flexShrink: 0, cursor: 'ns-resize', background: 'rgba(96,165,250,.22)', borderTop: '1px solid rgba(96,165,250,.45)', borderBottom: '1px solid rgba(96,165,250,.45)' }} />

      {/* 底部：关键帧时间轴 + AI */}
      <div style={{ flex: `0 0 ${Math.max(28, (1 - effectiveViewportRatio) * 100)}%`, minHeight: 190, minWidth: 0, maxHeight: '72%', overflowY: 'auto', overflowX: 'hidden', borderTop: '1px solid rgba(255,255,255,.1)', padding: '8px 14px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6, boxSizing: 'border-box' }}><div style={{ display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid rgba(255,255,255,.08)', paddingBottom: 6 }}><span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.8)' }}>导演时间线</span><span style={{ fontSize: 10, color: 'rgba(255,255,255,.45)' }}>时间线 · 角色路径 · 输出与 AI</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,.6)' }}>导出:</span>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,.55)' }}>比例</span>
          <select value={exportRatio} onChange={e => setExportRatio(e.target.value)} title="导出比例（截图/录制）" style={{ background: '#1c2230', color: '#fff', border: '1px solid rgba(255,255,255,.2)', borderRadius: 5, padding: '2px 4px', fontSize: 10 }}>
            <option value="free">自由</option>
            <option value="16:9">16:9</option>
            <option value="9:16">9:16</option>
            <option value="1:1">1:1</option>
            <option value="4:3">4:3</option>
            <option value="21:9">21:9</option>
          </select>
          <Button size="small" icon={<CameraOutlined />} loading={capturing} onClick={() => void capture()}>截图</Button>
          {lastMedia && <Button size="small" type="primary" onClick={() => sendToCanvas()} title={`发送「${lastMedia.name}」到主画布`}>发布到画布</Button>}
          {/* M2 修复：四类录制互斥——任一录制进行中禁用其它录制/关键帧入口，避免两个 MediaRecorder 或 motion 与 FPV 同时驱动相机 */}
          <Button size="small" icon={<VideoCameraOutlined />} disabled={recording || camRecording} onClick={() => void startRecording('orbit')}>环绕录制</Button>
          <Button size="small" icon={<VideoCameraOutlined />} disabled={recording || camRecording} onClick={() => void startRecording('dollyIn')}>推近录制</Button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,.6)' }}>运镜:</span>
          <Button size="small" type={camRecording ? 'primary' : 'default'} danger={camRecording} onClick={camRecording ? stopCamRecording : startCamRecording} disabled={recording}>{camRecording ? '⏹ 停止运镜' : '⏺ 录制运镜'}</Button>
          {camRecording && <span style={{ fontSize: 11, color: '#f87171', fontVariantNumeric: 'tabular-nums' }}>● {camRecordSecs.toFixed(1)}s</span>}
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,.6)' }}>关键帧:</span>
          <Button size="small" icon={<PlusOutlined />} onClick={addKeyframe} disabled={recording || camRecording}>记录关键帧</Button>
           <Button size="small" onClick={undoTimeline}>撤销</Button>
           <Button size="small" onClick={redoTimeline}>重做</Button>
           <Button size="small" onClick={copyTimelineSelection}>复制</Button>
           <Button size="small" onClick={pasteTimelineSelection}>粘贴</Button>
           <Button size="small" onClick={saveActionClip}>保存片段</Button>
          <Button size="small" onClick={playing ? stopPlay : playKeyframes} disabled={keyframes.length < 2 || camRecording}>{playing ? '暂停' : '播放'}</Button>
          <Button size="small" icon={<VideoCameraOutlined />} onClick={() => void recordKeyframes()} disabled={recording || camRecording || keyframes.length < 2}>录制动画</Button>
          <Button size="small" onClick={updateKeyframe} disabled={currentKf < 0}>更新关键帧</Button>
          <Button size="small" danger onClick={deleteCurrentKf} disabled={currentKf < 0}>删除此帧</Button>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,.55)' }}>速度:</span>
          <input type="range" min={0.25} max={4} step={0.05} value={speedFactor} disabled={recording} onChange={e => setSpeedFactor(Number(e.target.value))} style={{ width: 70, opacity: recording ? 0.4 : 1 }} title={recording ? '录制中不可修改速度（否则视频时长与播放错位）' : '播放/导出速度'} />
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,.6)' }}>{speedFactor.toFixed(2)}x</span>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,.55)' }}>平滑:</span>
          <Switch size="small" checked={smoothCam} onChange={setSmoothCam} />
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,.55)' }}>吸附帧格:</span><Switch size="small" checked={snapToFrames} onChange={setSnapToFrames} />
           <span style={{ fontSize: 10, color: 'rgba(255,255,255,.55)' }}>帧率:</span>
          <select value={fps} onChange={e => setFps(Number(e.target.value))} style={{ background: '#1c2230', color: '#fff', border: '1px solid rgba(255,255,255,.2)', borderRadius: 4, padding: '2px 4px', fontSize: 10 }}>
            {[24, 30, 60].map(f => <option key={f} value={f}>{f} 帧/秒</option>)}
          </select>
          {keyframes.length > 0 && <Button size="small" type="text" onClick={() => { stopPlay(); setKeyframes([]); setCurrentKf(-1); }}>清空</Button>}
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,.45)' }}>{camRecording ? '● 录制中…移动相机' : `${keyframes.length} 帧${playing ? ' · 播放中' : ''}（点「录制运镜」录相机轨迹，或摆好姿态点「记录关键帧」）`}</span>
          {recordedUrl && <video src={recordedUrl} controls muted playsInline style={{ height: 36, maxWidth: 160, borderRadius: 4, background: '#000', marginLeft: 'auto' }} />}
        </div>
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 0', borderTop: '1px solid rgba(255,255,255,.08)', borderBottom: '1px solid rgba(255,255,255,.08)' }}><div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.8)' }}>轨道工作区 <span style={{ fontSize: 10, fontWeight: 400, color: 'rgba(255,255,255,.45)' }}>{playTime.toFixed(2)}s / {timelineDuration.toFixed(1)}s</span><span style={{ marginLeft: 'auto', fontWeight: 400 }}>缩放 <input type="range" min={0.5} max={3} step={0.1} value={timelineZoom} onChange={e => setTimelineZoom(Number(e.target.value))} style={{ width: 80, verticalAlign: 'middle' }} /></span></div><div style={{ marginLeft: 92, display: 'flex', justifyContent: 'space-between', color: 'rgba(255,255,255,.35)', fontSize: 9 }}>{Array.from({ length: Math.min(9, Math.ceil(timelineDuration) + 1) }, (_, index) => <span key={`tick-${index}`}>{(index * timelineDuration / Math.min(8, Math.ceil(timelineDuration))).toFixed(1)}s</span>)}</div><div style={{ display: 'grid', gridTemplateColumns: '92px 1fr', gap: 4, alignItems: 'center' }}><span style={{ fontSize: 10, color: '#a78bfa' }}>相机轨道</span><div style={{ height: 18, position: 'relative', overflow: 'hidden', background: 'rgba(167,139,250,.12)', borderRadius: 3 }}>{keyframes.filter(kf => kf.camera).map((kf, index) => <span key={`camera-kf-${index}`} title={`相机关键帧 ${index + 1} · ${kf.time.toFixed(2)}s`} onClick={() => jumpToKeyframe(keyframes.indexOf(kf))} style={{ position: 'absolute', left: `${Math.max(0, Math.min(94, (kf.time / Math.max(0.01, timelineDuration)) * 94))}%`, top: 3, width: 12, height: 12, borderRadius: 2, background: '#a78bfa', cursor: 'pointer' }} />)}{!keyframes.some(kf => kf.camera) && <span style={{ fontSize: 10, color: 'rgba(255,255,255,.35)', paddingLeft: 6 }}>记录关键帧或录制运镜后会出现在这里</span>}</div></div><div style={{ display: 'grid', gridTemplateColumns: '92px 1fr', gap: 4, alignItems: 'center' }}><span style={{ fontSize: 10, color: '#60a5fa' }}>人物轨道</span><div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>{objects.filter(object => object.kind === 'humanoid').map(object => <div key={`actor-track-${object.id}`} style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 4, alignItems: 'center' }}><button onClick={() => setSelectedId(object.id)} style={{ border: 0, background: 'transparent', color: selectedId === object.id ? '#fff' : 'rgba(255,255,255,.55)', textAlign: 'left', fontSize: 10, cursor: 'pointer', padding: 0 }}>{object.name}</button><div style={{ height: 18, position: 'relative', overflow: 'hidden', background: selectedId === object.id ? 'rgba(96,165,250,.2)' : 'rgba(96,165,250,.08)', borderRadius: 3 }}>{keyframes.map((kf, index) => kf.objects[object.id] ? <span key={`track-kf-${object.id}-${index}`} title={`${object.name} 关键帧 ${index + 1} · ${kf.time.toFixed(2)}s`} onClick={() => jumpToKeyframe(index)} style={{ position: 'absolute', left: `${Math.max(0, Math.min(94, (kf.time / Math.max(0.01, timelineDuration)) * 94))}%`, top: 3, width: 12, height: 12, borderRadius: '50%', background: currentKf === index ? '#f59e0b' : '#60a5fa', cursor: 'pointer' }} /> : null)}</div></div>)}{!objects.some(object => object.kind === 'humanoid') && <span style={{ fontSize: 10, color: 'rgba(255,255,255,.35)', paddingLeft: 6 }}>暂无人物</span>}</div></div><div style={{ display: 'grid', gridTemplateColumns: '92px 1fr', gap: 4, alignItems: 'center' }}><span style={{ fontSize: 10, color: '#f59e0b' }}>路径轨道</span><div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>{objects.filter(object => object.kind === 'humanoid').map(object => { const path = motionPaths.find(item => item.targetId === object.id); return <div key={`path-track-${object.id}`} style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 4, alignItems: 'center' }}><button onClick={() => { setSelectedId(object.id); if (path) setActivePathTargetId(object.id); }} style={{ border: 0, background: 'transparent', color: path?.targetId === activePathTargetId ? '#fff' : 'rgba(255,255,255,.55)', textAlign: 'left', fontSize: 10, cursor: 'pointer', padding: 0 }}>{object.name}</button><div style={{ minHeight: 18, background: path?.targetId === activePathTargetId ? 'rgba(245,158,11,.2)' : 'rgba(245,158,11,.08)', borderRadius: 3, padding: '2px 5px' }}>{path ? <div onClick={() => { setActivePathTargetId(path.targetId); setSelectedId(path.targetId); }} style={{ width: '100%' }}><div style={{ position: 'relative', height: 22, width: '100%' }} onPointerMove={event => updatePathTimelineDrag(event, path)} onPointerUp={endPathTimelineDrag}><div style={{ position: 'absolute', left: `${(path.startTime / timelineDuration) * 100}%`, width: `${((path.endTime - path.startTime) / timelineDuration) * 100}%`, top: 2, bottom: 2, borderRadius: 3, background: path.targetId === activePathTargetId ? '#f59e0b' : 'rgba(245,158,11,.55)' }}><span onPointerDown={event => beginPathTimelineDrag(event, path, 'start')} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 7, cursor: 'ew-resize' }} /><span onPointerDown={event => beginPathTimelineDrag(event, path, 'move')} style={{ position: 'absolute', left: 7, right: 7, top: 0, bottom: 0, cursor: 'grab', paddingLeft: 8, fontSize: 9, color: '#1e293b' }}>{path.gait === 'run' ? '跑步' : path.gait === 'walk' ? '行走' : '路径'} {path.startTime.toFixed(1)}–{path.endTime.toFixed(1)}s</span><span onPointerDown={event => beginPathTimelineDrag(event, path, 'end')} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 7, cursor: 'ew-resize' }} /></div></div></div> : <span style={{ fontSize: 10, color: 'rgba(255,255,255,.3)' }}>未创建路径</span>}</div></div>; })}</div></div></div>
         <div style={{ position: 'relative', height: 14, marginLeft: 92, background: 'rgba(255,255,255,.04)', cursor: 'ew-resize', touchAction: 'none' }} onPointerDown={event => { timelineScrubRef.current = true; event.currentTarget.setPointerCapture(event.pointerId); scrubTimeline(event); }} onPointerMove={event => { if (timelineScrubRef.current) scrubTimeline(event); }} onPointerUp={() => { timelineScrubRef.current = false; }} onPointerCancel={() => { timelineScrubRef.current = false; }}><div style={{ position: 'absolute', left: `${(playTime / Math.max(0.01, timelineDuration)) * timelineZoom * 100}%`, top: 0, bottom: 0, width: 3, background: '#f87171', cursor: 'ew-resize' }} /></div>
         {keyframes.length > 0 && (
          <div
            style={{ position: 'relative', height: 26, background: 'rgba(255,255,255,.06)', borderRadius: 4, cursor: 'crosshair' }}
            onMouseDown={e => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              const idx = Math.round(ratio * (keyframes.length - 1));
              rangeDragRef.current = { dragging: true, start: idx };
              setRangeSel({ start: idx, end: idx });
            }}
            onMouseMove={e => {
              if (!rangeDragRef.current?.dragging) return;
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              const idx = Math.round(ratio * (keyframes.length - 1));
              setRangeSel({ start: rangeDragRef.current.start, end: idx });
            }}
            onMouseUp={() => { if (rangeDragRef.current) rangeDragRef.current.dragging = false; }}
            onMouseLeave={() => { if (rangeDragRef.current) rangeDragRef.current.dragging = false; }}
          >


         {rangeSel && (
              <div style={{ position: 'absolute', left: `${(Math.min(rangeSel.start, rangeSel.end) / Math.max(1, keyframes.length - 1)) * 100}%`, width: `${(Math.abs(rangeSel.end - rangeSel.start) / Math.max(1, keyframes.length - 1)) * 100}%`, top: 0, bottom: 0, background: 'rgba(245,158,11,.25)', borderLeft: '1px solid #f59e0b', borderRight: '1px solid #f59e0b', cursor: 'grab', pointerEvents: 'auto', touchAction: 'none' }} onPointerDown={beginRangeMove} onPointerMove={moveRange} onPointerUp={endRangeMove} />
            )}
            {keyframes.map((kf, i) => {
              const total = keyframes[keyframes.length - 1].time || 1;
              return <span key={`${i}-${kf.time}`} onPointerDown={event => { event.stopPropagation(); dragKeyframe(event, i); }} onPointerMove={moveKeyframe} onPointerUp={endKeyframeDrag} onClick={() => onKeyframeClick(i)} title={`关键帧 ${i + 1}（第 ${Math.round(kf.time * fps)} 帧 / ${kf.time.toFixed(2)}s）· 拖动调整时间`} style={{ position: 'absolute', left: `${(kf.time / total) * 100}%`, top: '50%', transform: 'translate(-50%,-50%)', width: currentKf === i ? 16 : 12, height: currentKf === i ? 16 : 12, borderRadius: '50%', background: currentKf === i ? '#f59e0b' : '#60a5fa', border: '2px solid #1e293b', cursor: 'grab', zIndex: 2, touchAction: 'none' }} />;
            })}
            {playing && <span style={{ position: 'absolute', left: `${(playTime / (keyframes[keyframes.length - 1].time || 1)) * 100}%`, top: 0, bottom: 0, width: 2, background: '#f87171', transition: 'left .1s linear' }} />}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 0', borderTop: '1px solid rgba(255,255,255,.08)' }}><div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.8)' }}>人物轨道编辑 <span style={{ fontSize: 10, color: 'rgba(255,255,255,.45)', fontWeight: 400 }}>（{humanoidTrackCount} 条，可滚动选择）</span></div><div style={{ maxHeight: humanoidTrackCount > 4 ? 132 : 'none', overflowY: humanoidTrackCount > 4 ? 'auto' : 'visible', paddingRight: humanoidTrackCount > 4 ? 4 : 0 }}>{objects.filter(item => item.kind === 'humanoid').map(item => { const path = motionPaths.find(candidate => candidate.targetId === item.id); const active = selectedId === item.id; return <div key={`track-editor-${item.id}`} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', background: active ? 'rgba(96,165,250,.16)' : 'rgba(255,255,255,.03)', border: `1px solid ${active ? 'rgba(96,165,250,.5)' : 'rgba(255,255,255,.08)'}`, borderRadius: 4 }}><span style={{ width: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10 }}>{item.name}</span><span style={{ flex: 1, color: 'rgba(255,255,255,.42)', fontSize: 10 }}>{path ? `路径 ${path.points.length} 点 · ${(path.endTime - path.startTime).toFixed(1)}s` : '未创建路径'}</span><Button size="small" type={active ? 'primary' : 'default'} onClick={() => selectObject(item.id)}>编辑人物</Button><Button size="small" onClick={() => { setSelectedId(item.id); ensureMotionPath(item.id); setActivePathTargetId(item.id); }}>新建/编辑路径</Button></div>; })}</div></div>
           <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.8)' }}>动作预设</span><span style={{ fontSize: 10, color: 'rgba(255,255,255,.4)' }}>当前人物</span>
           <Button size="small" onClick={() => applyPosePreset('idle')}>待机</Button>
           <Button size="small" onClick={() => applyPosePreset('walk')}>行走</Button>
           <Button size="small" onClick={() => applyPosePreset('run')}>跑步</Button>
           <Button size="small" onClick={() => applyPosePreset('point')}>指向</Button>
           <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.8)', marginLeft: 10 }}>路径编辑</span>
          <select value={selectedPath?.targetId || ''} onChange={e => { if (e.target.value) setSelectedId(e.target.value); }} style={{ background: '#1c2230', color: '#fff', border: '1px solid rgba(255,255,255,.2)', borderRadius: 4, padding: '2px 4px', fontSize: 10 }}>
            <option value="">选择人物</option>
            {objects.filter(item => item.kind === 'humanoid').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <Button size="small" onClick={() => { ensureMotionPath(); const id = selectedId || selectedHumanoid?.id || ''; if (id) setActivePathTargetId(id); }}>新建路径</Button><Button size="small" danger disabled={!selectedPath} onClick={() => deleteMotionPath()}>删除路径</Button>
           <Button size="small" type={pathEditMode ? 'primary' : 'default'} onClick={() => { const id = selectedPath?.targetId || selectedId || selectedHumanoid?.id || ''; if (!id) { message.info('请先选择人物并新建路径'); return; } setActivePathTargetId(id); setPathEditMode(value => !value); }}>{pathEditMode ? '完成编辑' : '编辑路径'}</Button>
           <Button size="small" type={playing ? 'default' : 'primary'} onClick={playing ? stopPlay : previewPath}>{playing ? '停止预览' : '预览路径'}</Button>
          {selectedPath && <>
            <label style={{ fontSize: 10 }}>速度 <input type="number" min={0.1} max={10} step={0.1} value={selectedPath.speed} onChange={e => updateMotionPath({ speed: Math.max(0.1, Number(e.target.value) || 0.1) })} style={{ width: 52 }} /></label>
            <label style={{ fontSize: 10 }}>时长 <input type="number" min={0.1} max={600} step={0.1} value={selectedPath.endTime - selectedPath.startTime} onChange={e => { const duration = Math.max(0.1, Number(e.target.value) || 0.1); updateMotionPath({ duration, endTime: selectedPath.startTime + duration }); }} style={{ width: 52 }} /></label>
            <label><Switch size="small" checked={selectedPath.loop} onChange={loop => updateMotionPath({ loop })} /> 循环片段</label>
            <label><Switch size="small" checked={selectedPath.closed} onChange={closed => updateMotionPath({ closed })} /> 闭环</label>
            <label><Switch size="small" checked={selectedPath.smooth} onChange={smooth => updateMotionPath({ smooth })} /> 平滑</label>
            <label><Switch size="small" checked={selectedPath.autoOrient} onChange={autoOrient => updateMotionPath({ autoOrient })} /> 朝向</label>
            <label style={{ fontSize: 10 }}>动作 <select value={selectedPath.gait} onChange={e => updateMotionPath({ gait: e.target.value as MotionPath['gait'] })} style={{ background: '#1c2230', color: '#fff', border: '1px solid rgba(255,255,255,.2)', borderRadius: 4, fontSize: 10 }}><option value="none">无</option><option value="walk">行走</option><option value="run">跑步</option></select></label>
            <label style={{ fontSize: 10 }}>幅度 <input type="range" min={0} max={1.5} step={0.05} value={selectedPath.gaitAmount} onChange={e => updateMotionPath({ gaitAmount: Number(e.target.value) })} style={{ width: 55 }} /></label>
            <label style={{ fontSize: 10 }}>转向 <input type="range" min={0.15} max={1} step={0.05} value={selectedPath.turnSmoothing} onChange={e => updateMotionPath({ turnSmoothing: Number(e.target.value) })} style={{ width: 55 }} /></label>
            <span style={{ fontSize: 10, color: pathEditMode ? '#fbbf24' : 'rgba(255,255,255,.4)' }}>{pathEditMode ? '在视口地面点击添加点，拖动橙色点调整轨迹' : `${selectedPath.points.length} 个轨迹点`}</span>
          </>}
        </div>
        {rangeSel && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: 'rgba(255,255,255,.6)' }}>
            {actionClips.length > 0 && <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '4px 0', borderTop: '1px solid rgba(255,255,255,.06)' }}><span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.75)' }}>动作片段库</span><label style={{ fontSize: 10 }}>比例 <Switch size="small" checked={retargetScale} onChange={setRetargetScale} /></label><label style={{ fontSize: 10 }}>粘贴 <select value={clipIncludeCamera ? 'both' : 'actor'} onChange={event => setClipIncludeCamera(event.target.value === 'both')} style={{ background: '#1c2230', color: '#fff', border: '1px solid rgba(255,255,255,.2)', borderRadius: 3, fontSize: 10 }}><option value="actor">仅人物</option><option value="both">人物+相机</option></select></label><label style={{ fontSize: 10 }}>循环 <input type="number" min={1} max={12} value={clipLoopCount} onChange={event => setClipLoopCount(Math.max(1, Math.min(12, Number(event.target.value) || 1)))} style={{ width: 34, background: '#1c2230', color: '#fff', border: '1px solid rgba(255,255,255,.2)', borderRadius: 3, fontSize: 10 }} /></label><label style={{ fontSize: 10 }}>过渡 <input type="number" min={0} max={2} step={0.05} value={clipBlendSeconds} onChange={event => setClipBlendSeconds(Math.max(0, Math.min(2, Number(event.target.value) || 0)))} style={{ width: 42, background: '#1c2230', color: '#fff', border: '1px solid rgba(255,255,255,.2)', borderRadius: 3, fontSize: 10 }} />s</label>{actionClips.map(clip => <span key={clip.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: 'rgba(52,211,153,.16)', border: '1px solid rgba(52,211,153,.35)', borderRadius: 4, padding: '2px 4px' }}><Button size="small" type={previewClipId === clip.id ? 'primary' : 'text'} onClick={() => previewActionClip(clip)} style={{ color: '#a7f3d0', fontSize: 10, padding: '0 3px' }}>{clip.name} · {objects.find(object => object.id === clip.sourceTargetId)?.name || '旧片段'} · {clip.duration.toFixed(1)}s</Button><Button size="small" type="text" onClick={() => pasteActionClip(clip)} style={{ color: '#fef08a', fontSize: 10, padding: '0 3px' }}>插入</Button><Button size="small" type="text" onClick={() => editClipMapping(clip)} style={{ color: '#93c5fd', fontSize: 10, padding: '0 3px' }}>映射</Button><span onClick={() => deleteActionClip(clip.id)} title="删除片段" style={{ color: '#f87171', cursor: 'pointer', fontSize: 12 }}>×</span></span>)}</div>}
             <span>已框选第 {Math.min(rangeSel.start, rangeSel.end) + 1}~{Math.max(rangeSel.start, rangeSel.end) + 1} 帧（{Math.abs(rangeSel.end - rangeSel.start) + 1} 帧）</span>
            <Button size="small" danger onClick={deleteRangeKfs}>删除选中段</Button>
            <Button size="small" type="text" onClick={() => setRangeSel(null)}>取消</Button>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,.6)' }}>AI 摆姿势:</span>
          <input value={posePrompt} onChange={e => setPosePrompt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void runAiPose(); }} placeholder="如：右手举起" style={{ width: 170, background: '#1c2230', color: '#fff', border: '1px solid rgba(255,255,255,.2)', borderRadius: 5, padding: '3px 8px', fontSize: 11 }} />
          <Button size="small" loading={poseLoading} disabled={!boneNames.length || !posePrompt.trim()} onClick={() => void runAiPose()}>摆姿势</Button>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,.6)' }}>AI 运镜:</span>
          <input value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void runAiMotion(); }} placeholder="如：环绕半圈" style={{ width: 170, background: '#1c2230', color: '#fff', border: '1px solid rgba(255,255,255,.2)', borderRadius: 5, padding: '3px 8px', fontSize: 11 }} />
          <Button size="small" loading={aiLoading} disabled={recording || !aiPrompt.trim()} onClick={() => void runAiMotion()}>运镜</Button>
          <span style={{ fontSize: 10, color: hasChatKey ? 'rgba(255,255,255,.4)' : '#fbbf24' }}>{hasChatKey ? `AI：${chatProvider} / ${chatModel}（设置→AI 可换）` : '⚠ 未配置 AI，请到 设置 → AI 配置 填写 API Key'}</span>
        </div>
      </div>
      </div>
    </div>,
    document.body
    )}
    <Lightbox item={previewItem} onClose={() => setPreviewItem(null)} />
    </>
  );
};

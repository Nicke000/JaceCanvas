import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * JA导演台 3D舞台（对齐 LibTV 3D导演台）：
 * - 真实 Three.js 场景：角色/道具为真实3D物体，机位带视锥线框
 * - “机位视角”用机位的真实透视相机渲染，焦距换算为真实 FOV
 * - 支持全景图背景（等距柱状投影贴图）和地面透明度/高度
 * - 支持拖拽移动/旋转/缩放，并可导出真实3D渲染截图供 ComfyUI 使用
 */
export type Vec3 = [number, number, number];
export type ActorPose = 'stand' | 'walk' | 'run' | 'sit' | 'wave';
export interface PoseSettings { torsoPitch: number; torsoYaw: number; headPitch: number; headYaw: number; leftArm: number; rightArm: number; leftLeg: number; rightLeg: number }
export interface StageActor { id: string; name: string; color: string; pose: ActorPose; poseSettings: PoseSettings; position: Vec3; rotation: number; scale: number }
export type PropModel = 'cube' | 'sphere' | 'cylinder' | 'cone' | 'capsule';
export interface StageProp { id: string; name: string; color: string; model: PropModel; position: Vec3; rotation: number; scale: number }
export interface StageCamera { x: number; y: number; z: number; focal: number; angle: string }
export interface StageKeyframe { actorId: string; position: Vec3; time: number }
export type TrajectoryType = 'circle' | 'line' | 'rectangle' | 'freehand';
export interface StageTrajectory { type: TrajectoryType; targetId: string; position: Vec3; rotation: number; scale: number; points?: Vec3[] }
export interface DirectorStage3DHandle { captureSnapshot: (aspect?: string) => string }

interface DirectorStage3DProps {
  mode: 'director' | 'camera';
  tool: 'move' | 'rotate' | 'scale';
  actors: StageActor[];
  propsList: StageProp[];
  camera: StageCamera;
  activeActorId: string;
  panoramaUrl?: string;
  skyColor?: string;
  groundOpacity: number;
  groundHeight: number;
  onSelectActor: (id: string) => void;
  onUpdateActor: (id: string, patch: Partial<StageActor>) => void;
  onUpdateProp: (id: string, patch: Partial<StageProp>) => void;
  onUpdateCamera: (patch: Partial<StageCamera>) => void;
  keyframes?: StageKeyframe[];
  showTrajectories?: boolean;
  trajectories?: StageTrajectory[];
  drawingTrajectoryIndex?: number;
  drawingFreehand?: boolean;
  onFreehandChange?: (points: Vec3[]) => void;
}

/** 35mm 等效焦距换算为垂直 FOV（度），焦距越大视野越窄，符合真实光学关系。 */
function focalToFov(focalMm: number): number {
  const sensor = 24; // 35mm 全画幅传感器高度(mm)
  const fovRad = 2 * Math.atan(sensor / (2 * Math.max(8, focalMm)));
  return THREE.MathUtils.radToDeg(fovRad);
}

/** 机位角度转换为俯仰角（弧度），侧拍/背面转换为水平偏航角。 */
function angleToPitchYaw(angle: string): { pitch: number; yaw: number } {
  switch (angle) {
    case '俯拍': return { pitch: -0.4, yaw: 0 };
    case '仰拍': return { pitch: 0.4, yaw: 0 };
    case '侧拍': return { pitch: 0, yaw: Math.PI / 2 };
    case '背面': return { pitch: 0, yaw: Math.PI };
    default: return { pitch: 0, yaw: 0 };
  }
}

function makeLabelSprite(text: string, tint: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(8,11,18,0.82)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = tint; ctx.lineWidth = 3; ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.6, 0.4, 1);
  return sprite;
}

/**
 * 用带关节枢轴的人形骨架拼出角色。
 * 四肢必须从肩/髋关节旋转，而不是围绕几何体中心旋转，否则走路、坐姿和挥手
 * 会出现“断肢”和姿态漂移，这也是旧版角色动作失真的主要原因。
 */
function makeActorMesh(color: string): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 16), material);
  head.name = 'head';
  head.position.y = 1.62; head.castShadow = true; group.add(head);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.55, 4, 8), material);
  torso.name = 'torso';
  torso.position.y = 1.1; torso.castShadow = true; group.add(torso);
  const makeLimb = (name: string, x: number, y: number, length: number) => {
    const pivot = new THREE.Group(); pivot.name = name; pivot.position.set(x, y, 0);
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(length < 0.5 ? 0.07 : 0.09, length, 4, 8), material);
    mesh.position.y = -length / 2; mesh.castShadow = true; pivot.add(mesh); group.add(pivot); return pivot;
  };
  const armL = makeLimb('arm-left', -0.28, 1.34, 0.42);
  const armR = makeLimb('arm-right', 0.28, 1.34, 0.42);
  const legL = makeLimb('leg-left', -0.1, 0.78, 0.65);
  const legR = makeLimb('leg-right', 0.1, 0.78, 0.65);
  const selection = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.47, 32), new THREE.MeshBasicMaterial({ color: '#fbbf24', transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
  selection.name = 'selection-ring'; selection.rotation.x = -Math.PI / 2; selection.position.y = 0.03; selection.visible = false; group.add(selection);
  const jointMaterial = new THREE.MeshBasicMaterial({ color: '#67e8f9' });
  [[-0.28, 1.34, 0], [0.28, 1.34, 0], [-0.1, 0.78, 0], [0.1, 0.78, 0]].forEach(([x, y, z]) => { const joint = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), jointMaterial); joint.position.set(x, y, z); joint.name = 'joint'; group.add(joint); });
  return group;
}

function applyActorPose(group: THREE.Group, pose: ActorPose, settings: PoseSettings): void {
  const armL = group.getObjectByName('arm-left'); const armR = group.getObjectByName('arm-right');
  const legL = group.getObjectByName('leg-left'); const legR = group.getObjectByName('leg-right');
  const torso = group.getObjectByName('torso'); const head = group.getObjectByName('head');
  if (!armL || !armR || !legL || !legR || !torso || !head) return;
  armL.rotation.set(0, 0, -0.12); armR.rotation.set(0, 0, 0.12); legL.rotation.set(0, 0, 0); legR.rotation.set(0, 0, 0);
  if (pose === 'walk') { legL.rotation.z = -0.35; legR.rotation.z = 0.35; armL.rotation.z = 0.45; armR.rotation.z = -0.45; }
  if (pose === 'run') { legL.rotation.z = -0.65; legR.rotation.z = 0.65; armL.rotation.z = 0.75; armR.rotation.z = -0.75; }
  if (pose === 'sit') { legL.rotation.z = -1.15; legR.rotation.z = 1.15; armL.rotation.z = -0.45; armR.rotation.z = 0.45; }
  if (pose === 'wave') { armR.rotation.z = -1.25; armR.rotation.x = -0.35; }
  torso.rotation.set(THREE.MathUtils.degToRad(settings.torsoPitch), THREE.MathUtils.degToRad(settings.torsoYaw), 0);
  head.rotation.set(THREE.MathUtils.degToRad(settings.headPitch), THREE.MathUtils.degToRad(settings.headYaw), 0);
  armL.rotation.z += THREE.MathUtils.degToRad(settings.leftArm); armR.rotation.z += THREE.MathUtils.degToRad(settings.rightArm);
  legL.rotation.z += THREE.MathUtils.degToRad(settings.leftLeg); legR.rotation.z += THREE.MathUtils.degToRad(settings.rightLeg);
}

function makePropMesh(color: string, model: PropModel): THREE.Mesh {
  const geometries: Record<PropModel, THREE.BufferGeometry> = {
    cube: new THREE.BoxGeometry(0.5, 0.5, 0.5),
    sphere: new THREE.SphereGeometry(0.32, 20, 14),
    cylinder: new THREE.CylinderGeometry(0.28, 0.28, 0.65, 20),
    cone: new THREE.ConeGeometry(0.34, 0.72, 20),
    capsule: new THREE.CapsuleGeometry(0.22, 0.42, 6, 12),
  };
  const mesh = new THREE.Mesh(geometries[model], new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
  mesh.position.y = 0.25; mesh.castShadow = true;
  return mesh;
}

/** 机位：橙色机身 + 视锥线框，还原 LibTV 截图里的样式。 */
function makeCameraRig(): { rig: THREE.Group; frustum: THREE.LineSegments } {
  const rig = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.32, 0.5), new THREE.MeshStandardMaterial({ color: '#f59e0b', roughness: 0.4 }));
  body.castShadow = true; rig.add(body);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.22, 16), new THREE.MeshStandardMaterial({ color: '#111827' }));
  lens.rotation.x = Math.PI / 2; lens.position.z = 0.36; rig.add(lens);
  const frustumGeo = new THREE.BufferGeometry();
  const frustum = new THREE.LineSegments(frustumGeo, new THREE.LineBasicMaterial({ color: '#7dd3fc', transparent: true, opacity: 0.6 }));
  rig.add(frustum);
  return { rig, frustum };
}

/** 根据 FOV/宽高比/深度重建视锥线框的 8 条边，随焦距变化实时更新。 */
function updateFrustumGeometry(frustum: THREE.LineSegments, fovDeg: number, aspect: number, depth: number) {
  const halfH = Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2) * depth;
  const halfW = halfH * aspect;
  const near = new THREE.Vector3(0, 0, 0);
  const p1 = new THREE.Vector3(-halfW, -halfH, depth);
  const p2 = new THREE.Vector3(halfW, -halfH, depth);
  const p3 = new THREE.Vector3(halfW, halfH, depth);
  const p4 = new THREE.Vector3(-halfW, halfH, depth);
  const pts = [near, p1, near, p2, near, p3, near, p4, p1, p2, p2, p3, p3, p4, p4, p1];
  frustum.geometry.setFromPoints(pts);
}

interface Picked { kind: 'actor' | 'prop' | 'camera'; id?: string }

export const DirectorStage3D = forwardRef<DirectorStage3DHandle, DirectorStage3DProps>((props, ref) => {
  const { mode, tool, actors, propsList, camera, activeActorId, panoramaUrl, groundOpacity, groundHeight, onSelectActor, onUpdateActor, onUpdateProp, onUpdateCamera, keyframes = [], showTrajectories = true, trajectories = [], drawingTrajectoryIndex = -1, drawingFreehand = false, onFreehandChange } = props;
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; directorCamera: THREE.PerspectiveCamera; shotCamera: THREE.PerspectiveCamera;
    controls: OrbitControls; shotControls: OrbitControls; ground: THREE.Mesh; actorMeshes: Map<string, THREE.Group>; propMeshes: Map<string, THREE.Mesh>; trajectories: Map<string, THREE.Line>; customTrajectories: Map<number, THREE.Line>;
    cameraRig: THREE.Group; frustum: THREE.LineSegments; raycaster: THREE.Raycaster; dragPlane: THREE.Plane;
    drag: { kind: 'actor' | 'prop' | 'camera'; id?: string; startWorld: THREE.Vector3; startPos: Vec3; startRotation: number; startScale: number } | null;
    drawing: boolean; drawingPoints: Vec3[];
  } | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useImperativeHandle(ref, () => ({
    captureSnapshot: (aspect = 'source') => {
      const state = stateRef.current;
      if (!state) return '';
      state.renderer.render(state.scene, state.directorCamera);
      const source = state.renderer.domElement;
      if (aspect === 'source') return source.toDataURL('image/png');
      const [ratioWidth, ratioHeight] = aspect.split(':').map(Number);
      const ratio = ratioWidth / ratioHeight;
      const sourceRatio = source.width / source.height;
      const cropWidth = sourceRatio > ratio ? Math.round(source.height * ratio) : source.width;
      const cropHeight = sourceRatio > ratio ? source.height : Math.round(source.width / ratio);
      const left = Math.round((source.width - cropWidth) / 2);
      const top = Math.round((source.height - cropHeight) / 2);
      const output = document.createElement('canvas');
      output.width = cropWidth; output.height = cropHeight;
      output.getContext('2d')!.drawImage(source, left, top, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
      return output.toDataURL('image/png');
    },
  }));

  // 初始化场景（只执行一次）
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#060608');
    scene.fog = new THREE.Fog('#060608', 10, 40);

    const width = mount.clientWidth || 800; const height = mount.clientHeight || 480;
    const directorCamera = new THREE.PerspectiveCamera(50, width / height, 0.1, 200);
    directorCamera.position.set(4, 3.2, 6);
    const shotCamera = new THREE.PerspectiveCamera(focalToFov(camera.focal), width / height, 0.1, 200);

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);

    const hemi = new THREE.HemisphereLight('#8fa8ff', '#0a0a0f', 0.7); scene.add(hemi);
    const key = new THREE.DirectionalLight('#ffffff', 1.1);
    key.position.set(5, 8, 4); key.castShadow = true; scene.add(key);

    const gridHelper = new THREE.GridHelper(30, 30, '#3d5a86', '#22304a');
    scene.add(gridHelper);
    const groundGeo = new THREE.PlaneGeometry(60, 60);
    const groundMat = new THREE.MeshStandardMaterial({ color: '#0e1420', transparent: true, opacity: groundOpacity });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    scene.add(ground);

    const controls = new OrbitControls(directorCamera, renderer.domElement);
    controls.target.set(0, 1, 0); controls.enableDamping = true; controls.dampingFactor = 0.08;
    const shotControls = new OrbitControls(shotCamera, renderer.domElement);
    shotControls.enableDamping = true; shotControls.dampingFactor = 0.08;

    const { rig: cameraRig, frustum } = makeCameraRig();
    scene.add(cameraRig);

    const raycaster = new THREE.Raycaster();
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    stateRef.current = { renderer, scene, directorCamera, shotCamera, controls, shotControls, ground, actorMeshes: new Map(), propMeshes: new Map(), trajectories: new Map(), customTrajectories: new Map(), cameraRig, frustum, raycaster, dragPlane, drag: null, drawing: false, drawingPoints: [] };

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const isDirectorMode = propsRef.current.mode === 'director';
      controls.enabled = isDirectorMode && !stateRef.current?.drag;
      shotControls.enabled = !isDirectorMode;
      controls.update();
      shotControls.update();
      const activeCam = isDirectorMode ? directorCamera : shotCamera;
      cameraRig.visible = isDirectorMode;
      renderer.render(scene, activeCam);
    };
    loop();

    const onResize = () => {
      const w = mount.clientWidth || width; const h = mount.clientHeight || height;
      renderer.setSize(w, h);
      directorCamera.aspect = w / h; directorCamera.updateProjectionMatrix();
      shotCamera.aspect = w / h; shotCamera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      controls.dispose();
      shotControls.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      stateRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 同步角色 3D 物体
  useEffect(() => {
    const state = stateRef.current; if (!state) return;
    const existing = new Set(state.actorMeshes.keys());
    for (const actor of actors) {
      let mesh = state.actorMeshes.get(actor.id);
      if (!mesh) {
        mesh = makeActorMesh(actor.color);
        const label = makeLabelSprite(actor.name, actor.color);
        label.position.y = 2.05; mesh.add(label);
        state.scene.add(mesh); state.actorMeshes.set(actor.id, mesh);
      }
      mesh.position.set(actor.position[0], actor.position[1], actor.position[2]);
      mesh.rotation.y = THREE.MathUtils.degToRad(actor.rotation);
      mesh.scale.setScalar(actor.scale);
      applyActorPose(mesh, actor.pose, actor.poseSettings);
      const selection = mesh.getObjectByName('selection-ring');
      if (selection) selection.visible = actor.id === activeActorId;
      mesh.traverse(child => {
        if (child instanceof THREE.Mesh) (child.material as THREE.MeshStandardMaterial).color.set(actor.color);
      });
      mesh.traverse(child => { (child as any).userData.actorId = actor.id; });
      existing.delete(actor.id);
    }
    for (const staleId of existing) { const mesh = state.actorMeshes.get(staleId); if (mesh) { state.scene.remove(mesh); state.actorMeshes.delete(staleId); } }
  }, [actors, activeActorId]);

  // 同步道具 3D 物体
  useEffect(() => {
    const state = stateRef.current; if (!state) return;
    const existing = new Set(state.propMeshes.keys());
    for (const prop of propsList) {
      let mesh = state.propMeshes.get(prop.id);
      if (mesh && (mesh as any).userData.model !== prop.model) {
        state.scene.remove(mesh); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); state.propMeshes.delete(prop.id); mesh = undefined;
      }
      if (!mesh) {
        mesh = makePropMesh(prop.color, prop.model); state.scene.add(mesh); state.propMeshes.set(prop.id, mesh); }
      mesh.position.set(prop.position[0], prop.position[1] + 0.25, prop.position[2]);
      mesh.rotation.y = THREE.MathUtils.degToRad(prop.rotation);
      mesh.scale.setScalar(prop.scale);
      const material = mesh.material as THREE.MeshStandardMaterial;
      material.color.set(prop.color);
      (mesh as any).userData.propId = prop.id;
      (mesh as any).userData.model = prop.model;
      existing.delete(prop.id);
    }
    for (const staleId of existing) { const mesh = state.propMeshes.get(staleId); if (mesh) { state.scene.remove(mesh); state.propMeshes.delete(staleId); } }
  }, [propsList]);

  useEffect(() => {
    const state = stateRef.current; if (!state) return;
    const grouped = new Map<string, StageKeyframe[]>();
    for (const keyframe of keyframes) grouped.set(keyframe.actorId, [...(grouped.get(keyframe.actorId) || []), keyframe]);
    for (const [actorId, line] of state.trajectories) {
      const points = (grouped.get(actorId) || []).sort((a, b) => a.time - b.time).map(key => new THREE.Vector3(key.position[0], key.position[1] + 0.03, key.position[2]));
      line.visible = showTrajectories && points.length > 1;
      if (points.length > 1) line.geometry.setFromPoints(points);
      grouped.delete(actorId);
    }
    for (const [actorId, frames] of grouped) {
      const points = frames.sort((a, b) => a.time - b.time).map(key => new THREE.Vector3(key.position[0], key.position[1] + 0.03, key.position[2]));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineDashedMaterial({ color: '#fbbf24', dashSize: 0.16, gapSize: 0.1 }));
      line.computeLineDistances(); line.visible = showTrajectories && points.length > 1; state.scene.add(line); state.trajectories.set(actorId, line);
    }
  }, [keyframes, showTrajectories]);

  useEffect(() => {
    const state = stateRef.current; if (!state) return;
    const makePoints = (item: StageTrajectory): THREE.Vector3[] => {
      const [x, y, z] = item.position; const size = item.scale || 1;
      if (item.type === 'circle') return Array.from({ length: 49 }, (_, index) => { const a = (index / 48) * Math.PI * 2; return new THREE.Vector3(x + Math.cos(a) * size, y + 0.04, z + Math.sin(a) * size); });
      if (item.type === 'rectangle') return [[-1,-.7],[1,-.7],[1,.7],[-1,.7],[-1,-.7]].map(([px, pz]) => new THREE.Vector3(x + px * size, y + 0.04, z + pz * size));
      if (item.type === 'freehand' && item.points?.length) return item.points.map(point => new THREE.Vector3(point[0] + x, point[1] + y + 0.04, point[2] + z));
      return [new THREE.Vector3(x - size, y + 0.04, z), new THREE.Vector3(x + size, y + 0.04, z)];
    };
    trajectories.forEach((item, index) => {
      const points = makePoints(item); let line = state.customTrajectories.get(index);
      if (!line) { line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: '#38bdf8', dashSize: .16, gapSize: .1 })); state.scene.add(line); state.customTrajectories.set(index, line); }
      line.geometry.setFromPoints(points); line.computeLineDistances(); line.visible = showTrajectories;
    });
    for (const [index, line] of state.customTrajectories) if (index >= trajectories.length) { state.scene.remove(line); line.geometry.dispose(); (line.material as THREE.Material).dispose(); state.customTrajectories.delete(index); }
  }, [trajectories, showTrajectories]);

  // 同步机位（位置/朝向/视锥/机位视角相机的真实 FOV）
  useEffect(() => {
    const state = stateRef.current; if (!state) return;
    state.cameraRig.position.set(camera.x, camera.y, camera.z);
    const { pitch, yaw } = angleToPitchYaw(camera.angle);
    // 导演台模型的镜头朝 +Z，而 Three.js PerspectiveCamera 的视线轴是 -Z。
    // 两者不能直接复用 quaternion，否则切换到机位视角时会朝向场景背面。
    const target = new THREE.Vector3(
      state.cameraRig.position.x + Math.sin(yaw) * 10,
      state.cameraRig.position.y + Math.sin(pitch) * 10,
      state.cameraRig.position.z - Math.cos(yaw) * 10,
    );
    state.shotCamera.position.copy(state.cameraRig.position);
    state.shotCamera.lookAt(target);
    state.shotControls.target.copy(target);
    const fov = focalToFov(camera.focal);
    state.shotCamera.fov = fov;
    state.shotCamera.updateProjectionMatrix();

    // 机位模型和视锥朝 +Z，单独设置模型旋转，不影响真实预览相机。
    state.cameraRig.rotation.set(0, Math.PI - yaw, 0);
    state.cameraRig.rotateX(-pitch);
    updateFrustumGeometry(state.frustum, fov, state.shotCamera.aspect, 4);
  }, [camera.x, camera.y, camera.z, camera.focal, camera.angle]);

  // 同步地面透明度/高度
  useEffect(() => {
    const state = stateRef.current; if (!state) return;
    (state.ground.material as THREE.MeshStandardMaterial).opacity = groundOpacity;
    state.ground.position.y = groundHeight;
  }, [groundOpacity, groundHeight]);

  // 同步全景图背景（等距柱状投影球体，接到导演台左侧输入即可），未接全景图时用天空颜色
  useEffect(() => {
    const state = stateRef.current; if (!state) return;
    if (!panoramaUrl) { state.scene.background = new THREE.Color(props.skyColor || '#060608'); state.scene.environment = null; return; }
    new THREE.TextureLoader().load(panoramaUrl, (texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      texture.colorSpace = THREE.SRGBColorSpace;
      if (stateRef.current) { stateRef.current.scene.background = texture; stateRef.current.scene.environment = texture; }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panoramaUrl, props.skyColor]);

  const pickAtPointer = (event: React.PointerEvent<HTMLDivElement>): Picked | null => {
    const state = stateRef.current; if (!state) return null;
    const rect = mountRef.current!.getBoundingClientRect();
    const pointer = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    state.raycaster.setFromCamera(pointer, state.directorCamera);
    const actorTargets = [...state.actorMeshes.entries()];
    const propTargets = [...state.propMeshes.entries()];
    const cameraHit = state.raycaster.intersectObject(state.cameraRig, true);
    if (cameraHit.length) return { kind: 'camera' };
    for (const [id, mesh] of actorTargets) { if (state.raycaster.intersectObject(mesh, true).length) return { kind: 'actor', id }; }
    for (const [id, mesh] of propTargets) { if (state.raycaster.intersectObject(mesh, true).length) return { kind: 'prop', id }; }
    return null;
  };

  /** 将屏幕坐标转换为导演相机视线与地面的交点，保证拖拽方向随视角变化。 */
  const worldPointAtGround = (event: React.PointerEvent<HTMLDivElement>): THREE.Vector3 | null => {
    const state = stateRef.current; if (!state || !mountRef.current) return null;
    const rect = mountRef.current.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    state.raycaster.setFromCamera(pointer, state.directorCamera);
    const hit = new THREE.Vector3();
    return state.raycaster.ray.intersectPlane(state.dragPlane, hit) ? hit : null;
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = stateRef.current;
    if (mode === 'director' && drawingFreehand && drawingTrajectoryIndex >= 0 && state) {
      state.drawing = true; state.drawingPoints = [];
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      return;
    }
    // 机位视角交给 OrbitControls 处理，可直接拖动旋转/缩放预览；导演视角才进入对象拖拽逻辑。
    if (mode !== 'director') return;
    const picked = pickAtPointer(event);
    if (!state) return;
    if (!picked) { state.drag = null; return; }
    if (picked.kind === 'actor' && picked.id) onSelectActor(picked.id);
    const startPos: Vec3 = picked.kind === 'actor' ? [...(actors.find(a => a.id === picked.id)?.position || [0, 0, 0])] as Vec3
      : picked.kind === 'prop' ? [...(propsList.find(p => p.id === picked.id)?.position || [0, 0, 0])] as Vec3
      : [camera.x, camera.y, camera.z];
    const startRotation = picked.kind === 'actor' ? (actors.find(a => a.id === picked.id)?.rotation || 0) : picked.kind === 'prop' ? (propsList.find(p => p.id === picked.id)?.rotation || 0) : 0;
    const startScale = picked.kind === 'actor' ? (actors.find(a => a.id === picked.id)?.scale || 1) : picked.kind === 'prop' ? (propsList.find(p => p.id === picked.id)?.scale || 1) : 1;
    const startWorld = worldPointAtGround(event);
    if (!startWorld) return;
    state.drag = { kind: picked.kind, id: picked.id, startWorld, startPos, startRotation, startScale };
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = stateRef.current; if (!state) return;
    if (state.drawing) {
      const hit = worldPointAtGround(event);
      if (hit) { const point: Vec3 = [Number(hit.x.toFixed(3)), 0, Number(hit.z.toFixed(3))]; const last = state.drawingPoints[state.drawingPoints.length - 1]; if (!last || Math.hypot(point[0] - last[0], point[2] - last[2]) > 0.08) { state.drawingPoints.push(point); onFreehandChange?.(state.drawingPoints); } }
      return;
    }
    if (!state.drag) return;
    const currentWorld = worldPointAtGround(event);
    if (!currentWorld) return;
    const dx = currentWorld.x - state.drag.startWorld.x;
    const dz = currentWorld.z - state.drag.startWorld.z;
    const { kind, id, startPos, startRotation, startScale } = state.drag;
    if (kind === 'actor' && id) {
      if (tool === 'rotate') onUpdateActor(id, { rotation: startRotation + dx * 90 });
      else if (tool === 'scale') onUpdateActor(id, { scale: Math.max(0.35, Math.min(3, startScale - dz)) });
      else onUpdateActor(id, { position: [startPos[0] + dx, startPos[1], startPos[2] + dz] });
    } else if (kind === 'prop' && id) {
      if (tool === 'rotate') onUpdateProp(id, { rotation: startRotation + dx * 90 });
      else if (tool === 'scale') onUpdateProp(id, { scale: Math.max(0.35, Math.min(3, startScale - dz)) });
      else onUpdateProp(id, { position: [startPos[0] + dx, startPos[1], startPos[2] + dz] });
    } else if (kind === 'camera') {
      onUpdateCamera({ x: startPos[0] + dx, z: startPos[2] + dz });
    }
  };

  const onPointerUp = () => { const state = stateRef.current; if (state) { state.drag = null; state.drawing = false; } };

  return <div ref={mountRef} className={`director-stage-3d${drawingFreehand ? ' is-drawing' : ''}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} />;
});
DirectorStage3D.displayName = 'DirectorStage3D';

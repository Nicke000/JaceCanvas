import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * 3D 模型查看器：经主进程读取模型文件（规避 file:// 与远程 CORS 限制），
 * GLTFLoader 渲染 + 轨道控制 + 自动旋转 + 包围盒自适应居中。
 */
export const ModelViewer: React.FC<{ url: string; height?: number }> = ({ url, height = 260 }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const width = el.clientWidth || 280;
    let disposed = false;
    let object: THREE.Object3D | null = null;
    let animationId = 0;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x334466, 1.1));
    const dir = new THREE.DirectionalLight(0xffffff, 1.6);
    dir.position.set(3, 4, 2);
    scene.add(dir);
    scene.add(new THREE.AmbientLight(0xffffff, 0.25));

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 500);
    camera.position.set(2.4, 1.8, 2.8);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.6;

    const animate = () => {
      if (disposed) return;
      controls.update();
      renderer.render(scene, camera);
      animationId = requestAnimationFrame(animate);
    };
    animate();

    const loader = new GLTFLoader();
    (async () => {
      let loadUrl = url;
      try {
        const res = await (window as any).electronAPI?.loadMediaB64?.({ url });
        if (res?.b64) {
          const bytes = Uint8Array.from(atob(res.b64), c => c.charCodeAt(0));
          loadUrl = URL.createObjectURL(new Blob([bytes], { type: res.mime || 'model/gltf-binary' }));
        }
      } catch { /* 回退直接加载 */ }
      if (disposed) return;
      loader.load(loadUrl, gltf => {
        if (disposed) return;
        object = gltf.scene;
        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z, 0.001);
        const scale = 2.4 / maxDim;
        object.scale.setScalar(scale);
        object.position.sub(center.clone().multiplyScalar(scale));
        scene.add(object);
      }, undefined, err => {
        console.error('3D 模型加载失败:', err);
      });
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(animationId);
      controls.dispose();
      renderer.dispose();
      if (object) scene.remove(object);
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  }, [url, height]);

  return <div ref={containerRef} style={{ width: '100%', height, background: 'rgba(15,20,40,.55)', borderRadius: 6, overflow: 'hidden' }} />;
};

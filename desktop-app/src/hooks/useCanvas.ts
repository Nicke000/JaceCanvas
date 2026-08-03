import { useCallback, useRef } from 'react';
import type { ReactFlowInstance } from '@xyflow/react';
import { useCanvasStore } from '@/stores/canvasStore';
import type { NodeComponentType } from '@/types';

/** 画布核心 hook */
export function useCanvas() {
  const reactFlowRef = useRef<ReactFlowInstance | null>(null);

  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const onNodesChange = useCanvasStore((s) => s.onNodesChange);
  const onEdgesChange = useCanvasStore((s) => s.onEdgesChange);
  const onConnect = useCanvasStore((s) => s.onConnect);
  const addNode = useCanvasStore((s) => s.addNode);
  const activeTool = useCanvasStore((s) => s.activeTool);

  const setReactFlowInstance = useCallback((instance: ReactFlowInstance) => {
    reactFlowRef.current = instance;
  }, []);

  /** 在画布中央添加节点 */
  const addNodeAtCenter = useCallback(
    (type: NodeComponentType) => {
      if (!reactFlowRef.current) return;
      const viewport = reactFlowRef.current.getViewport();
      const center = reactFlowRef.current.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });

      addNode(type, {
        x: center.x - 75,
        y: center.y - 25,
      });
    },
    [addNode]
  );

  /** 在画布上点击时处理（用于工具添加节点） */
  const handlePaneClick = useCallback(
    (event: React.MouseEvent) => {
      if (activeTool === 'select') return;

      const bounds = (event.target as HTMLElement)
        .closest('.react-flow__pane')
        ?.getBoundingClientRect();
      if (!bounds) return;

      addNode(activeTool, {
        x: event.clientX - bounds.left - 75,
        y: event.clientY - bounds.top - 25,
      });
    },
    [activeTool, addNode]
  );

  return {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    setReactFlowInstance,
    addNodeAtCenter,
    handlePaneClick,
  };
}

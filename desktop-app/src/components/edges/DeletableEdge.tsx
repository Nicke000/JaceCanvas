import React from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';
import { useCanvasStore } from '@/stores/canvasStore';

export const DeletableEdge: React.FC<EdgeProps> = ({id,sourceX,sourceY,targetX,targetY,sourcePosition,targetPosition,markerEnd,style}) => {
  const [path,labelX,labelY]=getBezierPath({sourceX,sourceY,targetX,targetY,sourcePosition,targetPosition});
  const remove=useCanvasStore(s=>s.deleteEdge);
  return <>
    <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style}/>
    <EdgeLabelRenderer><button className="edge-delete nodrag nopan" title="删除连接线" onClick={e=>{e.stopPropagation();remove(id)}}
      style={{transform:`translate(-50%, -50%) translate(${labelX}px,${labelY}px)`}}>×</button></EdgeLabelRenderer>
  </>;
};
import React from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';
import { useCanvasStore } from '@/stores/canvasStore';

export const DeletableEdge: React.FC<EdgeProps> = ({id,sourceX,sourceY,targetX,targetY,sourcePosition,targetPosition,markerEnd,style,selected}) => {
  const [path,labelX,labelY]=getBezierPath({sourceX,sourceY,targetX,targetY,sourcePosition,targetPosition});
  const remove=useCanvasStore(s=>s.deleteEdge);
  // 删除按钮只在鼠标悬停或连线被选中时显示，边多时不遮挡
  const [hover,setHover]=React.useState(false);
  return <>
    <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style}/>
    <EdgeLabelRenderer><button className="edge-delete nodrag nopan" title="删除连接线" onClick={e=>{e.stopPropagation();remove(id)}}
      onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      style={{transform:`translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,opacity:hover||selected?1:0,pointerEvents:hover||selected?'auto':'none',transition:'opacity .12s'}}>×</button></EdgeLabelRenderer>
  </>;
};
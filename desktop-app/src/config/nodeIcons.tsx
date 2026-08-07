import type { LucideIcon } from 'lucide-react';
import {
  Type, FileText, Clapperboard, GitCompare, Package, WandSparkles, Repeat2, Video, Eye, StickyNote,
  BoxSelect, Disc3, Sparkles, Paintbrush, Zap, Flame, Layers, Brush, Film, MonitorPlay, Mic,
  UserRound, Orbit, ZoomIn, Music, PersonStanding, Bot, Lightbulb, BookOpen, Palette, Puzzle,
  Settings2, Waves, Combine, Droplets, Eraser, SquarePlay, FilePen, LayoutGrid, ListVideo, Camera,
  Theater, Upload, Download, Plug, Workflow, MessageSquare, Scissors, Gauge, Crop, ImagePlus,
  Repeat, Projector, Play, Layers3, Cloud, Boxes, ImageDown, AudioLines, Wand2,
} from 'lucide-react';
import type { NodeComponentType } from '@/types';

/** 全站节点图标统一映射（P1 去 emoji）：lucide 线描图标，16px / 1.5px / currentColor */
export const NODE_ICONS: Record<NodeComponentType, LucideIcon> = {
  textInput: Type,
  scriptInput: FileText,
  sceneSettings: Clapperboard,
  compare: GitCompare,
  asset: Package,
  imageGeneration: WandSparkles,
  imageToImage: Repeat2,
  videoGeneration: Video,
  preview: Eye,
  note: StickyNote,
  frame: BoxSelect,
  reroute: Disc3,
  qwenImageGen: Sparkles,
  qwenImageEdit: Paintbrush,
  zimageGen: Zap,
  fluxImageGen: Flame,
  sdxlIL: Layers,
  fireRedEdit: Brush,
  wanVideoGen: Film,
  ltxVideoGen: MonitorPlay,
  lipSyncHuman: AudioLines,
  personReplace: UserRound,
  gaussianSplat: Boxes,
  upscaleWatermark: ZoomIn,
  audioGen: Music,
  motionTransfer: PersonStanding,
  storyboardGPT: Bot,
  intentImage: Lightbulb,
  booguImage: BookOpen,
  kreaImage: Palette,
  universalMaker: Puzzle,
  toolSettings: Settings2,
  joyAIEcho: Waves,
  refMultiFusion: Combine,
  refWashImage: Droplets,
  refImageClear: Eraser,
  refImageToVideo: SquarePlay,
  storyboardPrompt: FilePen,
  storyboardRender: LayoutGrid,
  timelineRender: ListVideo,
  cinematographyKnowledge: Camera,
  uploadNode: Upload,
  downloadNode: Download,
  apiNode: Plug,
  localWorkflow: Workflow,
  chatNode: MessageSquare,
  videoTrim: Scissors,
  imageCrop: Crop,
  paidTextToImage: ImagePlus,
  paidImageToImage: Repeat,
  paidTextToVideo: Projector,
  paidImageToVideo: Play,
  paidCapability: Layers3,
  bailianTextToImage: Cloud,
};

/** 便捷渲染：<NodeIcon type="textInput" size={15}/>，类型未知时回退 Wand2 */
export function NodeIcon({ type, size = 15, className }: { type: string; size?: number; className?: string }) {
  const Icon = NODE_ICONS[type as NodeComponentType] || Wand2;
  return <Icon size={size} className={className} strokeWidth={1.5} />;
}

/** 节点库/搜索面板等展示用：节点类型 → lucide 图标组件 */
export function nodeIconOf(type: string): LucideIcon {
  return NODE_ICONS[type as NodeComponentType] || Wand2;
}

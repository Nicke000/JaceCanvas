import type { NodeTypes } from '@xyflow/react';
import {
  TextInputNode, ScriptInputNode, SceneSettingsNode, CompareNode, ImageGenerationNode, ImageToImageNode,
  VideoGenerationNode, AssetNode, UploadNode, PreviewNode, GenericNode, StoryboardPromptNode, CinematographyKnowledgeNode, DirectorStudioNode, VideoTrimNode, Video2XLocalNode,
} from './index';

export const nodeTypes: NodeTypes = {
  textInput: TextInputNode,
  scriptInput: ScriptInputNode,
  sceneSettings: SceneSettingsNode,
  compare: CompareNode,
  asset: AssetNode,
  imageGeneration: ImageGenerationNode,
  imageToImage: ImageToImageNode,
  videoGeneration: VideoGenerationNode,
  preview: PreviewNode,
  // New 25 types use GenericNode
  qwenImageGen: GenericNode, qwenImageEdit: GenericNode,
  zimageGen: GenericNode, fluxImageGen: GenericNode,
  sdxlIL: GenericNode, fireRedEdit: GenericNode,
  wanVideoGen: GenericNode, ltxVideoGen: GenericNode,
  lipSyncHuman: GenericNode, personReplace: GenericNode,
  gaussianSplat: GenericNode, upscaleWatermark: GenericNode,
  audioGen: GenericNode, motionTransfer: GenericNode,
  storyboardGPT: GenericNode, intentImage: GenericNode,
  booguImage: GenericNode, kreaImage: GenericNode,
  universalMaker: GenericNode, toolSettings: GenericNode,
  joyAIEcho: GenericNode,
  refMultiFusion: GenericNode, refWashImage: GenericNode,
  refImageClear: GenericNode, refImageToVideo: GenericNode,
  uploadNode: UploadNode, downloadNode: GenericNode,
  apiNode: GenericNode,
  storyboardPrompt: StoryboardPromptNode,
  cinematographyKnowledge: CinematographyKnowledgeNode,
  directorStudio: DirectorStudioNode,
  videoTrim: VideoTrimNode,
  video2xLocal: Video2XLocalNode,
};

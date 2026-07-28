/** 工作流预设配置 - 从 API 文件夹的 JSON 自动提取
 *  key: workflow_id (与服务器一致)
 *  value: { suggestNode: 推荐节点类型, inputs: { "节点ID:字段": 默认值 } }
 */
export const WORKFLOW_PRESETS: Record<string, { suggestNode: string; category: string; inputs: Record<string, unknown> }> = {
  // ======== 文生图 ========
  '文生图-Zimage-Nunchaku': { suggestNode:'zimageGen', category:'image', inputs:{ '93:text':'', '94:width':768, '94:height':1136, '94:batch_size':1, '95:filename_prefix':'z-image', '99:seed':-1, '99:steps':9, '99:cfg':1 } },
  'Zimage双采-三采-双放大': { suggestNode:'zimageGen', category:'image', inputs:{ '5:text':'', '7:text':'', '12:steps':12, '12:cfg':4, '12:denoise':1 } },
  '文生图+图像联结-ZimageControlNet': { suggestNode:'zimageGen', category:'image', inputs:{ '5:text':'', '7:text':'', '99:steps':4, '99:cfg':1 } },
  'Krea2文生图写实质感': { suggestNode:'kreaImage', category:'image', inputs:{ '51:text':'', '49:aspect_ratio':'9:16 (Portrait Widescreen)', '49:megapixels':4, '53:seed':-1, '53:steps':8, '53:cfg':1 } },
  'Qwen双节棍生图': { suggestNode:'qwenImageGen', category:'image', inputs:{ '93:text':'', '94:width':768, '94:height':1136, '94:batch_size':1, '95:filename_prefix':'qwen', '99:seed':-1, '99:steps':4, '99:cfg':1 } },
  'Qwen多视图生成': { suggestNode:'qwenImageGen', category:'image', inputs:{ '93:text':'', '94:width':1024, '94:height':1024, '99:seed':-1, '99:steps':4, '99:cfg':1 } },
  'Qwen人物多角度展示': { suggestNode:'qwenImageGen', category:'image', inputs:{ '93:text':'', '94:width':1024, '94:height':1024, '99:seed':-1, '99:steps':4, '99:cfg':1 } },

  // ======== 图编辑 ========
  'Qwen编辑（换装+换姿势+换动作）': { suggestNode:'qwenImageEdit', category:'image', inputs:{ '144:prompt':'让图片1中的人物摆出图片2中的姿势', '231:seed':-1, '231:steps':4, '231:cfg':1, '232:image':'', '235:image':'', '238:prompt':'图1的模特穿着图2的衣服' } },
  'Qwen二次元转真人+高清放大': { suggestNode:'qwenImageEdit', category:'image', inputs:{ '144:prompt':'', '231:seed':-1, '231:steps':4, '231:cfg':1 } },
  'Seed VR2图片高清放大': { suggestNode:'upscaleWatermark', category:'image', inputs:{ '12:image':'', '49:scale':4 } },

  // ======== 视频生成 ========
  'LTX-2.3-4宫格V3短剧': { suggestNode:'ltxVideoGen', category:'video', inputs:{ '93:text':'', '94:width':768, '94:height':768, '94:batch_size':1, '99:seed':-1, '99:steps':8, '99:cfg':1 } },
  'Ltx2.3动作模仿-图片跳舞-动作迁移': { suggestNode:'motionTransfer', category:'video', inputs:{ 'source_video':'', 'target_image':'' } },
  'ltx2.3多图参考': { suggestNode:'refMultiFusion', category:'video', inputs:{ 'image1':'', 'image2':'' } },
  'Wan2.2 Animate动作迁移真人动作对齐Q版人物（全身动作对齐半身图像）': { suggestNode:'motionTransfer', category:'video', inputs:{ 'source_video':'', 'target_image':'' } },
  '动作迁移-Wan2.2-Animate': { suggestNode:'motionTransfer', category:'video', inputs:{ 'source_video':'', 'target_image':'' } },
  '多图参考生成分镜（4宫格、9宫格、25宫格）': { suggestNode:'storyboardGPT', category:'video', inputs:{ 'script':'', 'style':'anime', 'num_frames':4 } },

  // ======== 数字人/对口型 ========
  '对口型-InfiniteTalk单人图像驱动': { suggestNode:'lipSyncHuman', category:'video', inputs:{ 'image':'', 'audio':'', 'text':'' } },
  '对口型-InfiniteTalk单人视频驱动': { suggestNode:'lipSyncHuman', category:'video', inputs:{ 'image':'', 'audio':'', 'text':'' } },
  '对口型-InfiniteTalk双人图像驱动': { suggestNode:'lipSyncHuman', category:'video', inputs:{ 'image':'', 'audio':'', 'text':'' } },

  // ======== JoyAI ========
  'JoyAI-Echo 多镜头连贯视频与音频生成': { suggestNode:'joyAIEcho', category:'video', inputs:{ '41:seed':-1, '41:shot_num_secs':24, '41:frame_rate':1, '42:value':1280, '43:value':736 } },
};
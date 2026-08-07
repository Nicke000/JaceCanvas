import React, { useMemo, useRef, useState } from 'react';
import { Sparkles, Video } from 'lucide-react';
import { Button, Input, InputNumber, message, Segmented, Modal, Form, Select } from 'antd';
import { fetchModelsFromApi } from '@/services/chat.service';
import { LeftOutlined, RightOutlined, CloseOutlined, ThunderboltOutlined, ReloadOutlined, CheckOutlined, UploadOutlined, PlusOutlined, UserOutlined, EnvironmentOutlined } from '@ant-design/icons';
import { generateStoryboard, type StoryboardSegment } from '@/services/storyboard.service';
import { optimizePrompt } from '@/services/promptOptimizer.service';
import { useSettingsStore } from '@/stores/settingsStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { callPaidApi } from '@/services/paidApi.service';
import { fetchWorkflows, fetchWorkflowConfig, generate, pollResult } from '@/services/comfyui.service';
import { cachePaidMedia } from '@/stores/canvasStore';
import { addGenerationHistory } from '@/utils/generationHistory';
import { downloadMedia } from '@/utils/downloadMedia';
import { getPaidProvidersForCapability, getPaidModelsForAdapter, PAID_API_ADAPTERS } from '@/config/paidApiAdapters';
import { getAllStyles } from '@/config/stylePresets';

const STEPS = ['剧本', '分镜', '图片确认', '视频生成', '配音', '合成导出'];

/** 按工作流名推断能力（返回能力数组；空 = 无法识别，视为通用） */
function inferWfCapability(name: string): string[] {
  const n = String(name || '');
  const caps: string[] = [];
  if (/文生图|文转图|文图生成|txt2img|text2img|文生图/.test(n)) caps.push('text-to-image');
  if (/图生图|编辑|换装|重绘|inpaint|img2img|放大|扩图|去水印/.test(n)) caps.push('image-to-image');
  if (/图生视频|i2v|img2video|image2video/.test(n)) caps.push('image-to-video');
  if (/文生视频|文转视频|t2v|text2video|txt2video/.test(n)) caps.push('text-to-video');
  if (/语音|配音|tts|克隆|audio|音频|sound/.test(n)) caps.push('text-to-speech');
  if (/对口型|数字人|lipsync|talking/.test(n)) caps.push('lipsync');
  return caps;
}
function workflowsForCap(list: Array<{ id: string; name: string }>, cap: string): Array<{ id: string; name: string }> {
  return list.filter(w => { const caps = inferWfCapability(w.name); return caps.includes(cap) || caps.length === 0; });
}

const TTS_VOICES = [
  { value: 'female-tianmei', label: '甜美女声' },
  { value: 'female-shaonv', label: '少女声' },
  { value: 'female-yujie', label: '御姐声' },
  { value: 'female-chengshu', label: '成熟女声' },
  { value: 'male-qn-qingse', label: '青涩男声' },
  { value: 'male-qn-jingying', label: '精英男声' },
  { value: 'male-qn-daxuesheng', label: '青年男声' },
  { value: 'Chinese (Mandarin)_News_Anchor', label: '新闻女声' },
  { value: 'Chinese (Mandarin)_Radio_Host', label: '电台男主播' },
];

type ShotState = { index: number; imageUrl: string; remoteUrl: string; status: 'pending' | 'generating' | 'done' | 'error'; error?: string; confirmed: boolean };
type VideoShotState = { index: number; videoUrl: string; status: 'pending' | 'generating' | 'done' | 'error'; error?: string; confirmed: boolean; prompt?: string; hasAudio?: boolean };
type AudioShotState = { index: number; audioUrl: string; status: 'pending' | 'generating' | 'done' | 'error'; error?: string; confirmed: boolean };

/** 短剧工作室：从剧本到成片的分步向导 */
export const StoryDramaStudio: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const settings = useSettingsStore();
  const [step, setStep] = useState(0);
  // 步骤1 剧本
  const [script, setScript] = useState('');
  const EXAMPLE_SCRIPT = '一个雨夜，女孩林晓在便利店门口遇到一只受伤的小猫。她把小猫带回家照顾，给它取名叫「团子」。一周后小猫康复，林晓发现团子其实会发光——原来它是来自星星的守护精灵。从此一人一猫开始了一段治愈的都市奇幻日常。';
  const [segmentCount, setSegmentCount] = useState(3);
  const [totalDuration, setTotalDuration] = useState(15);
  const [segmentRule, setSegmentRule] = useState('每段 5 秒');
  // 步骤2 分镜
  const [personCount, setPersonCount] = useState(2);
  const [personNotes, setPersonNotes] = useState<Record<string, string>>({});
  const [sceneNotes, setSceneNotes] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [segments, setSegments] = useState<StoryboardSegment[]>([]);
  const [generating, setGenerating] = useState(false);
  const [translating, setTranslating] = useState<Record<string, boolean>>({});
  // 步骤3 图片
  const [imgEngine, setImgEngine] = useState<'paid' | 'comfyui'>('paid');
  const [imgProvider, setImgProvider] = useState('');
  const [imgModel, setImgModel] = useState('');
  const [charModel, setCharModel] = useState(''); // 角色参考图端口模型
  const [sceneModel, setSceneModel] = useState(''); // 场景概念图端口模型
  const [comfyWorkflows, setComfyWorkflows] = useState<Array<{ id: string; name: string }>>([]);
  const [comfyWorkflow, setComfyWorkflow] = useState('');
  const [shots, setShots] = useState<ShotState[]>([]);
  const [generatingImages, setGeneratingImages] = useState(false);
  const [regeneratingIndex, setRegeneratingIndex] = useState<number | null>(null);
  const [charNotes, setCharNotes] = useState('');
  // 步骤4 视频
  const [vidEngine, setVidEngine] = useState<'paid' | 'comfyui'>('paid');
  const [vidProvider, setVidProvider] = useState('');
  const [vidModel, setVidModel] = useState('');
  const [vidComfyWorkflow, setVidComfyWorkflow] = useState('');
  const [videoShots, setVideoShots] = useState<VideoShotState[]>([]);
  const [generatingVideos, setGeneratingVideos] = useState(false);
  const [regeneratingVideoIndex, setRegeneratingVideoIndex] = useState<number | null>(null);
  // 步骤5 配音
  const [audioEngine, setAudioEngine] = useState<'minimax' | 'comfyui'>('minimax');
  const [audioComfyWorkflow, setAudioComfyWorkflow] = useState('');
  const [voiceId, setVoiceId] = useState('female-tianmei');
  const [customVoiceId, setCustomVoiceId] = useState('');
  const [audioShots, setAudioShots] = useState<AudioShotState[]>([]);
  const [generatingAudios, setGeneratingAudios] = useState(false);
  const [regeneratingAudioIndex, setRegeneratingAudioIndex] = useState<number | null>(null);
  // 步骤6 合成
  const [timeline, setTimeline] = useState<Array<{ shotIndex: number; videoUrl: string; audioUrl: string; start?: number; end?: number; hasAudio?: boolean }>>([]);
  const [composing, setComposing] = useState(false);
  // ===== 一键生成状态机 =====
  const [autoStage, setAutoStage] = useState<'idle' | 'sb' | 'img' | 'vid' | 'aud' | 'compose' | 'done'>('idle');
  const startAutoRun = () => {
    if (autoStage !== 'idle') return;
    if (!script.trim() && !segments.length) { message.warning('请先填写剧本'); return; }
    message.info('一键生成开始：分镜 → 图片 → 视频 → 配音 → 合成');
    if (segments.length) { setAutoStage('img'); void generateAllImages(); }
    else { setAutoStage('sb'); void genStoryboard(); }
  };
  React.useEffect(() => {
    if (autoStage === 'sb' && !generating) {
      if (segments.length) { setAutoStage('img'); void generateAllImages(); }
      else if (!generating) { setAutoStage('idle'); message.error('分镜生成失败，一键生成已停止'); }
    }
  }, [autoStage, generating, segments.length]);
  React.useEffect(() => {
    if (autoStage !== 'img') return;
    if (generatingImages) return;
    if (!shots.length) { void generateAllImages(); return; }
    if (shots.every(s => s.status === 'done')) { setShots(prev => prev.map(s => ({ ...s, confirmed: true }))); setAutoStage('vid'); void generateAllVideos(); }
    else if (shots.some(s => s.status === 'error')) { setAutoStage('idle'); message.error('图片生成失败，一键生成已停止'); }
  }, [autoStage, generatingImages, shots]);
  React.useEffect(() => {
    if (autoStage !== 'vid') return;
    if (generatingVideos) return;
    if (!videoShots.length) { void generateAllVideos(); return; }
    if (videoShots.every(s => s.status === 'done')) { setVideoShots(prev => prev.map(s => ({ ...s, confirmed: true }))); setAutoStage('aud'); void generateAllAudios(); }
    else if (videoShots.some(s => s.status === 'error')) { setAutoStage('idle'); message.error('视频生成失败，一键生成已停止'); }
  }, [autoStage, generatingVideos, videoShots]);
  React.useEffect(() => {
    if (autoStage !== 'aud') return;
    if (generatingAudios) return;
    if (!audioShots.length) { void generateAllAudios(); return; }
    if (audioShots.every(s => s.status === 'done')) { setAudioShots(prev => prev.map(s => ({ ...s, confirmed: true }))); setAutoStage('compose'); void composeFinal(); }
    else if (audioShots.some(s => s.status === 'error')) { setAutoStage('idle'); message.error('配音失败，一键生成已停止'); }
  }, [autoStage, generatingAudios, audioShots]);
  React.useEffect(() => {
    if (autoStage !== 'compose') return;
    if (composing) return;
    setAutoStage('done');
    message.success('一键生成完成！成片已就绪，可在合成区查看/导出');
  }, [autoStage, composing]);
  // ===== 导出拍摄表 / 剪辑清单 =====
  const exportShotList = () => {
    if (!segments.length) { message.warning('没有分镜可导出'); return; }
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""').replace(/\n/g, ' ')}"`;
    const rows = [['镜头', '时长(秒)', '图片提示词', '视频提示词', '台词', '角色', '场景'],
      ...segments.map((seg: any, i) => [i + 1, seg.duration, seg.firstFrame?.prompt || '', seg.videoPrompt || '', seg.dialogue || '', seg.characters?.join('|') || '', seg.locations?.join('|') || ''].map(esc))];
    const blob = new Blob(['\ufeff' + rows.map(r => r.join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '分镜拍摄表.csv'; a.click();
    message.success('已导出分镜拍摄表（CSV）');
  };
  const exportEditList = () => {
    if (!videoShots.length) { message.warning('还没有视频可导出'); return; }
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['镜头', '视频文件', '开始(秒)', '时长(秒)', '台词'],
      ...videoShots.map((v, i) => { const t = timeline.find(x => x.shotIndex === i); return [i + 1, v.videoUrl || '', t?.start || 0, t?.end ? (t.end - (t.start || 0)) : (segments[i] as any)?.duration || 5, (segments[i] as any)?.dialogue || ''].map(esc); })];
    const blob = new Blob(['\ufeff' + rows.map(r => r.join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '剪辑清单.csv'; a.click();
    message.success('已导出剪辑清单（CSV）');
  };
  const exportEDL = () => {
    if (!videoShots.length) { message.warning('还没有视频可导出'); return; }
    const FPS = 30;
    const tc = (sec: number) => { const f = Math.max(0, Math.round(sec * FPS)); const hh = Math.floor(f / 3600 / FPS); const mm = Math.floor((f % (3600 * FPS)) / (60 * FPS)); const ss = Math.floor((f % (60 * FPS)) / FPS); const ff = f % FPS; return [hh, mm, ss, ff].map(x => String(x).padStart(2, '0')).join(':'); };
    const events = videoShots.map((v, i) => {
      const t = timeline.find(x => x.shotIndex === i);
      const tStart = t?.start || 0;
      const dur = t?.end ? (t.end - tStart) : ((segments[i] as any)?.duration || 5);
      const inTc = tc(tStart); const outTc = tc(tStart + dur);
      return `001  AX       V     C        ${inTc} ${outTc} ${inTc} ${outTc}\n* FROM CLIP NAME: 镜头${i + 1}\n* VIDEO FILE: ${v.videoUrl || ''}`;
    });
    const edl = `TITLE: JaceCanvas 分镜剪辑工程\nFCM: NON-DROP FRAME\n\n${events.join('\n\n')}`;
    const blob = new Blob([edl], { type: 'application/x-edl' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '剪辑工程.edl'; a.click();
    message.success('已导出剪辑工程（EDL，可用 Premiere/剪映等导入）');
  };
  const [finalVideo, setFinalVideo] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [composeHint, setComposeHint] = useState('');
  const [dramaAiModalOpen, setDramaAiModalOpen] = useState(false);
  const [dramaAiForm] = Form.useForm();
  const [dramaAiFetching, setDramaAiFetching] = useState(false);

  const aiLabel = `${settings.dramaAiModel ? settings.dramaAiProvider : settings.optimizerProvider} · ${settings.dramaAiModel || settings.optimizerModel || '未选模型'}`;
  const imgProviders = getPaidProvidersForCapability('text-to-image').map(item => item.id);
  const imgProviderOptions = getPaidModelsForAdapter(imgProvider || imgProviders[0] || '', 'text-to-image');
  const vidProviders = getPaidProvidersForCapability('image-to-video').map(item => item.id);
  const vidProviderOptions = getPaidModelsForAdapter(vidProvider || vidProviders[0] || '', 'image-to-video');

  const addManualSegment = () => {
    const last = segments[segments.length - 1] as any;
    setSegments(prev => [...prev, { segmentId: `segment_m${Date.now()}`, duration: Number(last?.duration) || 5, firstFrame: { prompt: '', inheritsPreviousLastFrame: false }, lastFrame: { prompt: '' }, videoPrompt: '', characters: [], locations: [], continuity: '', negativePrompt: '', dialogue: '' } as any]);
    message.success('已添加分镜，可填写各提示词');
  };

  const genStoryboard = async () => {
    if (!script.trim()) { message.warning('请先填写剧本'); return; }
    const dramaCfg = settings.dramaAiApiKey ? { provider: settings.dramaAiProvider, baseUrl: settings.dramaAiBaseUrl, apiKey: settings.dramaAiApiKey, model: settings.dramaAiModel } : null;
    const hasAnyCfg = !!dramaCfg || !!settings.optimizerApiKey || settings.optimizerProvider === 'ollama' || !!settings.chatApiKey || settings.chatProvider === 'ollama';
    if (!hasAnyCfg) { message.warning('请先配置分镜 AI（点击上方「分镜 AI 设置」，与聊天 AI 互不影响）'); return; }
    setGenerating(true);
    try {
      const result = await generateStoryboard({
        script, segmentCount, segmentRule, totalDuration,
        characterNotes: Object.entries(personNotes).map(([k, v]) => `${k}:${v}`).filter(([, v]) => v).join('\n'),
        sceneNotes, effects: '', customRequirements: '', inheritPrevious: true,
        systemPrompt: systemPrompt.trim() || undefined,
      }, undefined, dramaCfg || undefined);
      setSegments(result.segments);
      setCharNotes(Object.entries(personNotes).map(([k, v]) => v).filter(Boolean).join('；'));
      // 分镜变化后清空下游（图片/视频/配音/时间线），避免旧结果串台
      setShots([]); setVideoShots([]); setAudioShots([]); setTimeline([]); setFinalVideo('');
      timelineBuilt.current = false;
      message.success(`分镜生成完成 · ${result.segments.length} 镜`);
    } catch (error: any) { message.error(String(error?.message || error)); }
    finally { setGenerating(false); }
  };

  const updateSegment = (index: number, field: 'firstFrame' | 'lastFrame' | 'videoPrompt' | 'dialogue', value: string, english?: string) => {
    setSegments(prev => prev.map((seg, i) => {
      if (i !== index) return seg;
      if (field === 'dialogue') return { ...seg, dialogue: value };
      if (field === 'videoPrompt') return { ...seg, videoPrompt: value, ...(english !== undefined ? { videoPromptEn: english } : {}) };
      return { ...seg, [field]: { ...(seg[field] as any), prompt: value, ...(english !== undefined ? { promptEn: english } : {}) } };
    }));
  };

  const translate = (index: number, field: 'firstFrame' | 'lastFrame' | 'videoPrompt', value: string) => {
    const key = `${index}-${field}`;
    setTranslating(v => ({ ...v, [key]: true }));
    void optimizePrompt({ text: value, action: 'translate', kind: field === 'videoPrompt' ? 'image-to-video' : 'image' })
      .then(en => { if (mountedRef.current) updateSegment(index, field, value, en); })
      .catch(() => message.warning('翻译失败，可手动填写英文'))
      .finally(() => setTranslating(v => ({ ...v, [key]: false })));
  };

  // ===== 步骤3：逐镜生成图片 =====
  const ensureComfyWorkflows = async () => {
    if (comfyWorkflows.length) return;
    try { const list = await fetchWorkflows(); setComfyWorkflows(list.map(w => ({ id: w.id, name: w.name || w.id }))); } catch { /* 忽略 */ }
  };

  const buildComfyInput = async (workflowId: string, prompt: string): Promise<Record<string, unknown>> => {
    const wf = await fetchWorkflowConfig(workflowId).catch(() => null);
    const input: Record<string, unknown> = {};
    if (wf?.api_config?.enabledParams) {
      const keys = Object.keys(wf.api_config.enabledParams).filter(k => wf.api_config?.enabledParams[k]);
      const textKey = keys.find(k => {
        const [nodeId, field] = k.split(':');
        const node = wf.workflow_template?.[nodeId];
        const v = node?.inputs?.[field];
        return typeof v === 'string' || typeof v === 'number';
      }) || keys[0];
      if (textKey) input[textKey] = prompt;
    }
    if (!Object.keys(input).length) input['93:text'] = prompt;
    return input;
  };

  const [imgMode, setImgMode] = useState<'direct' | 'setup'>('direct');
  const [imgStyle, setImgStyle] = useState('none');
  const [generatingRefs, setGeneratingRefs] = useState(false);
  const [generatingScene, setGeneratingScene] = useState(false);
  const generateCharRefs = async () => {
    const descs = Object.entries(personNotes).map(([, v]) => v).filter(Boolean);
    if (!descs.length) { message.warning('请先在剧本页填写角色描述'); return; }
    setGeneratingRefs(true);
    try {
      const urls: string[] = [];
      for (const d of descs.slice(0, 3)) {
        const { url } = await generateOneImage(`角色定妆图，全身像，干净纯色背景：${d}`, charModel || undefined, '角色参考图');
        urls.push(url);
      }
      setCharRefs(urls);
      message.success(`已生成 ${urls.length} 张角色定妆图`);
    } catch (e: any) { message.error(String(e?.message || e)); }
    finally { setGeneratingRefs(false); }
  };
  const generateSceneRefs = async () => {
    if (!sceneNotes.trim()) { message.warning('请先在剧本页填写场景描述'); return; }
    setGeneratingScene(true);
    try {
      const { url } = await generateOneImage(`场景概念图，无人物，电影感：${sceneNotes}`, sceneModel || undefined, '场景概念图');
      setSceneRefs([url]);
      message.success('已生成场景图');
    } catch (e: any) { message.error(String(e?.message || e)); }
    finally { setGeneratingScene(false); }
  };
  const generateOneImage = async (prompt: string, modelOverride?: string, tag = '逐镜图片'): Promise<{ url: string; remoteUrl: string }> => {
    const usedModel = (modelOverride || imgModel || '').trim();
    if (imgEngine === 'paid') {
      const provider = imgProvider || imgProviders[0] || '';
      const profile = settings.paidApiProviders?.[provider as keyof typeof settings.paidApiProviders];
      if (!profile?.apiKey) throw new Error('请先配置该付费厂商的 API Key');
      const model = usedModel || imgProviderOptions[0]?.id || profile.selectedModel || '';
      if (!model) throw new Error('请选择图片模型');
      const refImage = charRefs[0] || undefined;
      const result = await callPaidApi({ provider, apiKey: profile.apiKey, baseUrl: profile.baseUrl, model, region: profile.region, workspaceId: profile.workspaceId, authMode: profile.provider === 'gemini' ? 'query-key' : 'bearer' }, refImage ? { type: 'image-to-image', imageUrl: refImage, prompt } : { type: 'text-to-image', prompt });
      if (!result.url) throw new Error('图片接口未返回地址');
      const url = await cachePaidMedia(result.url, 'image');
      addGenerationHistory({ id: 'studio-img-' + Date.now(), nodeId: 'story-drama-studio', nodeName: '短剧工作室·' + tag, nodeType: 'studioImage', params: { prompt: prompt.slice(0, 120), model }, resultUrl: url, results: [{ type: 'image', url }], status: 'success', timestamp: Date.now() });
      return { url, remoteUrl: result.url };
    }
    if (!comfyWorkflow) throw new Error('请选择 ComfyUI 工作流');
    const inputValues = await buildComfyInput(comfyWorkflow, prompt);
    const resp = await generate({ workflow_id: comfyWorkflow, input_values: inputValues });
    const result = await pollResult(resp.prompt_id, () => undefined, 2000, undefined, undefined);
    const url = result.data?.[0]?.url;
    if (!url) throw new Error('工作流未返回图片');
    const cached = await cachePaidMedia(url, 'image');
    addGenerationHistory({ id: 'studio-img-' + Date.now(), nodeId: 'story-drama-studio', nodeName: '短剧工作室·' + tag, nodeType: 'studioImage', params: { prompt: prompt.slice(0, 120), workflow: comfyWorkflow }, resultUrl: cached, results: [{ type: 'image', url: cached }], status: 'success', timestamp: Date.now() });
    return { url: cached, remoteUrl: url };
  };

  const generateAllImages = async () => {
    if (!segments.length) { message.warning('请先生成分镜'); return; }
    setGeneratingImages(true);
    const list: ShotState[] = segments.map((_, i) => ({ index: i, imageUrl: '', remoteUrl: '', status: 'pending', confirmed: false }));
    setShots(list);
    for (let i = 0; i < list.length; i++) {
      if (!mountedRef.current) return;
      if (!mountedRef.current) return;
      if (!mountedRef.current) return;
      setShots(prev => prev.map((s, j) => j === i ? { ...s, status: 'generating' } : s));
      const seg = segments[i] as any;
      const styleSuffix = getAllStyles().find(x => x.id === imgStyle)?.suffix || '';
      const prompt = (seg?.firstFrame?.promptEn || seg?.firstFrame?.prompt || '') + (charNotes ? `。角色设定：${charNotes}` : '') + (styleSuffix ? `, ${styleSuffix}` : '');
      try {
        const { url, remoteUrl } = await generateOneImage(prompt);
        setShots(prev => prev.map((s, j) => j === i ? { ...s, imageUrl: url, remoteUrl, status: 'done' } : s));
      } catch (error: any) {
        setShots(prev => prev.map((s, j) => j === i ? { ...s, status: 'error', error: String(error?.message || error) } : s));
      }
    }
    setGeneratingImages(false);
  };

  const regenerateOne = async (i: number) => {
    const seg = segments[i] as any;
    const prompt = (seg?.firstFrame?.promptEn || seg?.firstFrame?.prompt || '') + (charNotes ? `。角色设定：${charNotes}` : '');
    setRegeneratingIndex(i);
    setShots(prev => prev.map((s, j) => j === i ? { ...s, status: 'generating', confirmed: false } : s));
    try {
      const { url, remoteUrl } = await generateOneImage(prompt);
      setShots(prev => prev.map((s, j) => j === i ? { ...s, imageUrl: url, remoteUrl, status: 'done' } : s));
    } catch (error: any) {
      setShots(prev => prev.map((s, j) => j === i ? { ...s, status: 'error', error: String(error?.message || error) } : s));
    }
    finally { setRegeneratingIndex(null); }
  };

  // ===== 步骤4：逐镜图生视频 =====
  const generateOneVideo = async (shot: ShotState | undefined, prompt: string, duration: number): Promise<string> => {
    if (vidEngine === 'comfyui') {
      if (!vidComfyWorkflow) throw new Error('请选择图生视频工作流');
      const inputValues = await buildComfyInput(vidComfyWorkflow, prompt);
      const wf = await fetchWorkflowConfig(vidComfyWorkflow).catch(() => null);
      if (wf?.api_config?.enabledParams) {
        const keys = Object.keys(wf.api_config.enabledParams).filter(k => wf.api_config?.enabledParams[k]);
        const imgKey = keys.find(k => {
          const [nodeId, field] = k.split(':');
          const node = wf.workflow_template?.[nodeId];
          const cls = String(node?.class_type || '').toLowerCase();
          return cls.includes('loadimage') || /image|reference|file|path/i.test(field);
        });
        if (imgKey) inputValues[imgKey] = shot?.remoteUrl || shot?.imageUrl || '';
        else throw new Error('未在该工作流中找到图片输入字段，请检查工作流或改用付费引擎');
      }
      const resp = await generate({ workflow_id: vidComfyWorkflow, input_values: inputValues });
      const result = await pollResult(resp.prompt_id, () => undefined, 3000, undefined, undefined);
      const url = result.data?.[0]?.url;
      if (!url) throw new Error('工作流未返回视频');
      const cachedV = await cachePaidMedia(url, 'video');
      addGenerationHistory({ id: 'studio-vid-' + Date.now(), nodeId: 'story-drama-studio', nodeName: '短剧工作室·逐镜视频', nodeType: 'studioVideo', params: { prompt: prompt.slice(0, 120), workflow: vidComfyWorkflow }, resultUrl: cachedV, results: [{ type: 'video', url: cachedV }], status: 'success', timestamp: Date.now() });
      return cachedV;
    }
    const provider = vidProvider || vidProviders[0] || '';
    const profile = settings.paidApiProviders?.[provider as keyof typeof settings.paidApiProviders];
    if (!profile?.apiKey) throw new Error('请先配置该付费厂商的 API Key');
    const model = vidModel || vidProviderOptions[0]?.id || profile.selectedModel || '';
    if (!model) throw new Error('请选择视频模型');
    const imageUrl = shot?.remoteUrl || shot?.imageUrl || '';
    const result = await callPaidApi({ provider, apiKey: profile.apiKey, baseUrl: profile.baseUrl, model, region: profile.region, workspaceId: profile.workspaceId, authMode: profile.provider === 'gemini' ? 'query-key' : 'bearer' }, imageUrl ? { type: 'image-to-video', imageUrl, prompt, duration } : { type: 'text-to-video', prompt, duration });
    if (!result.url) throw new Error('视频接口未返回地址');
    const cachedV2 = await cachePaidMedia(result.url, 'video');
    addGenerationHistory({ id: 'studio-vid-' + Date.now(), nodeId: 'story-drama-studio', nodeName: '短剧工作室·逐镜视频', nodeType: 'studioVideo', params: { prompt: prompt.slice(0, 120), model }, resultUrl: cachedV2, results: [{ type: 'video', url: cachedV2 }], status: 'success', timestamp: Date.now() });
    return cachedV2;
  };

  const addManualVideoShot = () => { setVideoShots(prev => [...prev, { index: prev.length, videoUrl: '', status: 'pending', confirmed: false, prompt: '' }]); message.success('已添加镜头，填写视频提示词后点击「逐镜生成视频」'); };

  const generateAllVideos = async () => {
    if (!videoShots.length && !segments.length) { message.warning('请先添加镜头或生成确认分镜'); return; }
    setGeneratingVideos(true);
    const list: VideoShotState[] = videoShots.length ? videoShots.map(v => ({ ...v, status: v.videoUrl ? 'done' : (v.status === 'error' ? 'error' : 'pending') })) : segments.map((_, i) => ({ index: i, videoUrl: '', status: 'pending', confirmed: false, prompt: (segments[i] as any)?.videoPromptEn || (segments[i] as any)?.videoPrompt || (segments[i] as any)?.firstFrame?.promptEn || (segments[i] as any)?.firstFrame?.prompt || '' }));
    if (!videoShots.length) setVideoShots(list);
    for (let i = 0; i < list.length; i++) {
      if (list[i].videoUrl) continue;
      setVideoShots(prev => prev.map((s, j) => j === i ? { ...s, status: 'generating' } : s));
      const seg = segments[i] as any;
      const prompt = list[i].prompt || '';
      try {
        const url = await generateOneVideo(shots[i], prompt, Number(seg?.duration) || 5);
        setVideoShots(prev => prev.map((s, j) => j === i ? { ...s, videoUrl: url, status: 'done' } : s));
      } catch (error: any) {
        setVideoShots(prev => prev.map((s, j) => j === i ? { ...s, status: 'error', error: String(error?.message || error) } : s));
      }
    }
    setGeneratingVideos(false);
  };

  const regenerateVideoOne = async (i: number) => {
    const seg = segments[i] as any;
    const prompt = videoShots[i]?.prompt || (seg?.videoPromptEn || seg?.videoPrompt || seg?.firstFrame?.promptEn || seg?.firstFrame?.prompt || '');
    setRegeneratingVideoIndex(i);
    setVideoShots(prev => prev.map((s, j) => j === i ? { ...s, status: 'generating', confirmed: false } : s));
    try {
      const url = await generateOneVideo(shots[i], prompt, Number(seg?.duration) || 5);
      setVideoShots(prev => prev.map((s, j) => j === i ? { ...s, videoUrl: url, status: 'done' } : s));
    } catch (error: any) {
      setVideoShots(prev => prev.map((s, j) => j === i ? { ...s, status: 'error', error: String(error?.message || error) } : s));
    }
    finally { setRegeneratingVideoIndex(null); }
  };

  // ===== 步骤5：配音（MiniMax TTS） =====
  const generateOneAudio = async (dialogue: string): Promise<string> => {
    if (audioEngine === 'comfyui') {
      if (!audioComfyWorkflow) throw new Error('请选择语音/配音工作流');
      const inputValues = await buildComfyInput(audioComfyWorkflow, dialogue);
      const resp = await generate({ workflow_id: audioComfyWorkflow, input_values: inputValues });
      const result = await pollResult(resp.prompt_id, () => undefined, 3000, undefined, undefined);
      const url = result.data?.[0]?.url;
      if (!url) throw new Error('工作流未返回音频');
      const cachedA = await cachePaidMedia(url, 'audio');
      addGenerationHistory({ id: 'studio-tts-' + Date.now(), nodeId: 'story-drama-studio', nodeName: '短剧工作室·配音', nodeType: 'studioAudio', params: { text: dialogue.slice(0, 120), workflow: audioComfyWorkflow }, resultUrl: cachedA, results: [{ type: 'audio', url: cachedA }], status: 'success', timestamp: Date.now() });
      return cachedA;
    }
    const profile = settings.paidApiProviders?.minimax;
    if (!profile?.apiKey) throw new Error('配音需要先配置 MiniMax API Key（设置 → 付费 API）');
    const finalVoice = customVoiceId.trim() || voiceId;
    const result = await callPaidApi({ provider: 'minimax', apiKey: profile.apiKey, baseUrl: profile.baseUrl || 'https://api.minimaxi.com', model: 'speech-2.8-turbo', authMode: 'bearer' }, { type: 'text-to-speech', prompt: dialogue, voiceId: finalVoice });
    if (!result.url) throw new Error('配音接口未返回音频');
    const cachedA2 = await cachePaidMedia(result.url, 'audio');
    addGenerationHistory({ id: 'studio-tts-' + Date.now(), nodeId: 'story-drama-studio', nodeName: '短剧工作室·配音', nodeType: 'studioAudio', params: { text: dialogue.slice(0, 120), voice: finalVoice }, resultUrl: cachedA2, results: [{ type: 'audio', url: cachedA2 }], status: 'success', timestamp: Date.now() });
    return cachedA2;
  };

  const generateAllAudios = async () => {
    if (!segments.length) { message.warning('请先生成分镜'); return; }
    setGeneratingAudios(true);
    const list: AudioShotState[] = segments.map((_, i) => ({ index: i, audioUrl: '', status: 'pending', confirmed: false }));
    setAudioShots(list);
    for (let i = 0; i < list.length; i++) {
      const dialogue = String((segments[i] as any).dialogue || '').trim();
      if (videoShots[i]?.hasAudio || !dialogue) { setAudioShots(prev => prev.map((s, j) => j === i ? { ...s, status: 'done', confirmed: true } : s)); continue; }
      setAudioShots(prev => prev.map((s, j) => j === i ? { ...s, status: 'generating' } : s));
      try {
        const url = await generateOneAudio(dialogue);
        setAudioShots(prev => prev.map((s, j) => j === i ? { ...s, audioUrl: url, status: 'done' } : s));
      } catch (error: any) {
        setAudioShots(prev => prev.map((s, j) => j === i ? { ...s, status: 'error', error: String(error?.message || error) } : s));
      }
    }
    setGeneratingAudios(false);
  };

  const regenerateAudioOne = async (i: number) => {
    if (videoShots[i]?.hasAudio) { setAudioShots(prev => prev.map((s, j) => j === i ? { ...s, status: 'done', confirmed: true } : s)); return; }
    const dialogue = String((segments[i] as any).dialogue || '').trim();
    setRegeneratingAudioIndex(i);
    setAudioShots(prev => prev.map((s, j) => j === i ? { ...s, status: 'generating', confirmed: false } : s));
    try {
      const url = await generateOneAudio(dialogue);
      setAudioShots(prev => prev.map((s, j) => j === i ? { ...s, audioUrl: url, status: 'done' } : s));
    } catch (error: any) {
      setAudioShots(prev => prev.map((s, j) => j === i ? { ...s, status: 'error', error: String(error?.message || error) } : s));
    }
    finally { setRegeneratingAudioIndex(null); }
  };

  // 进入视频区且无卡片时，从分镜自动初始化视频卡片（可直接编辑提示词生成，无需先出图）
  React.useEffect(() => {
    if (step === 3 && segments.length && !videoShots.length) {
      setVideoShots(segments.map((_, i) => ({ index: i, videoUrl: '', status: 'pending', confirmed: false, prompt: (segments[i] as any)?.videoPromptEn || (segments[i] as any)?.videoPrompt || (segments[i] as any)?.firstFrame?.promptEn || (segments[i] as any)?.firstFrame?.prompt || '' })));
    }
  }, [step, segments, videoShots.length]);

  // 进入合成步骤时初始化时间线（仅一次，之后不再重建，移除镜头不会复活）
  const timelineBuilt = React.useRef(false);
  React.useEffect(() => {
    if (step === 5 && !timelineBuilt.current) {
      if (videoShots.length) {
        setTimeline(videoShots.map((v, i) => ({ shotIndex: i, videoUrl: v.videoUrl, audioUrl: v.hasAudio ? '' : (audioShots[i]?.audioUrl || ''), hasAudio: !!v.hasAudio })));
        timelineBuilt.current = true;
      }
    }
  }, [step, videoShots, audioShots]);
  // ===== 单页三列分区：可拖拽调整列宽/行高 =====
  const mainRef = React.useRef<HTMLDivElement>(null);
  const dragRef = React.useRef<{ type: 'col' | 'row'; i: number; target: string; start: number; total: number } | null>(null);

  // ===== 图片上传：本地 / 资产 / 画布 / 历史 =====
  const [imgSourceOpen, setImgSourceOpen] = useState(false);
  const [imgSourceTab, setImgSourceTab] = useState<'local' | 'asset' | 'canvas' | 'history'>('asset');
  const [imgSourceItems, setImgSourceItems] = useState<Array<{ id: string; name: string; url?: string; type: string }>>([]);
  const [imgSelectedIds, setImgSelectedIds] = useState<Set<string>>(new Set());
  const [imgTargetIndex, setImgTargetIndex] = useState(0);
  const mountedRef = useRef(true); // 组件卸载后停止所有生成循环（防卸载后继续发请求/轮询）
  React.useEffect(() => () => { mountedRef.current = false; }, []);
  const [aiInput, setAiInput] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMessages, setAiMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const aiSuggestions = [
    ...(step === 0 ? ['帮我扩写这个故事', '把故事改成 3 个镜头', '加强结尾冲突'] : []),
    ...(step === 1 ? ['检查镜头衔接', '统一人物外观', '补全镜头运动'] : []),
    ...(step === 2 ? ['生成 4 个不同构图', '保持人物脸部一致', '改成夜景'] : []),
    ...(step === 3 ? ['增加动作幅度', '让镜头更稳定', '改成缓慢推近'] : []),
    ...(step === 4 ? ['调整为更自然的语气', '给这句台词增加停顿', '压缩台词到 5 秒内'] : []),
    ...(step === 5 ? ['检查是否有缺失素材', '检查字幕时间', '生成导出建议'] : []),
  ];

  const [imgTargetKind, setImgTargetKind] = useState<'shot' | 'char' | 'scene'>('shot');
  const [charRefs, setCharRefs] = useState<string[]>([]);
  const [sceneRefs, setSceneRefs] = useState<string[]>([]);
  const imgFileRef = React.useRef<HTMLInputElement>(null);
  const refreshImgSources = (tab: typeof imgSourceTab) => {
    const items: Array<{ id: string; name: string; url?: string; type: string }> = [];
    if (tab === 'asset') {
      try { const assets = JSON.parse(localStorage.getItem('ai-canvas-assets-v2') || '[]') as Array<{ id: string; name: string; type: string; url: string }>; assets.forEach(a => { const isVid = (a.type || '').startsWith('video'); if (!isVid) items.push({ id: a.id, name: a.name, url: a.url, type: 'image' }); }); } catch { /* ignore */ }
    } else if (tab === 'canvas') {
      const nodes = useCanvasStore.getState().nodes;
      nodes.forEach(node => { (node.data.results || []).forEach((r: any, index: number) => { if (r.type !== 'video' && r.url) items.push({ id: `${node.id}-${index}`, name: r.filename || node.data.label, url: r.url, type: 'image' }); }); const url = String(node.data.resultUrl || ''); if (url && !/(mp4|webm|mov)(\?|$)/i.test(url) && !items.some(x => x.url === url)) items.push({ id: `${node.id}-result`, name: node.data.label, url, type: 'image' }); });
    } else if (tab === 'history') {
      try { const history = JSON.parse(localStorage.getItem('ai-canvas-history') || '[]') as Array<{ id: string; nodeName: string; resultUrl?: string; results?: Array<{ url: string; type: string; filename?: string }> }>; history.forEach(h => (h.results || (h.resultUrl ? [{ url: h.resultUrl, type: 'image' }] : [])).forEach((r, index) => { if (r.type !== 'video' && r.url) items.push({ id: `${h.id}-${index}`, name: r.filename || h.nodeName, url: r.url, type: 'image' }); })); } catch { /* ignore */ }
    }
    setImgSourceItems(items);
  };
  const openImgSources = (i: number, tab: typeof imgSourceTab, kind: 'shot' | 'char' | 'scene' = 'shot') => { setImgTargetIndex(i); setImgTargetKind(kind); setImgSourceTab(tab); setImgSelectedIds(new Set()); refreshImgSources(tab); setImgSourceOpen(true); };
  const handleImgLocal = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []); e.target.value = '';
    if (!files.length) return;
    const read = (f: File) => new Promise<string>(res => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(f); });
    if (imgTargetKind !== 'shot') {
      // 角色/场景参考：全部加入
      const urls: string[] = [];
      for (const f of files) urls.push(await read(f));
      urls.forEach(u => applyShotImage(imgTargetIndex, u, imgTargetKind));
    } else {
      // 镜头图：多选按顺序应用到 imgTargetIndex 起的连续镜头
      let idx = imgTargetIndex;
      for (const f of files) { applyShotImage(idx, await read(f), 'shot'); idx += 1; }
    }
    setImgSourceOpen(false);
  };
  const applyShotImage = (i: number, url: string, kind: 'shot' | 'char' | 'scene' = 'shot') => { if (kind === 'char') { setCharRefs(prev => prev.includes(url) ? prev : [...prev, url]); message.success('已添加角色参考图'); } else if (kind === 'scene') { setSceneRefs(prev => prev.includes(url) ? prev : [...prev, url]); message.success('已添加场景参考图'); } else { setShots(prev => { const list = [...prev]; while (list.length <= i) list.push({ index: list.length, imageUrl: '', remoteUrl: '', status: 'pending', confirmed: false }); list[i] = { ...list[i], imageUrl: url, status: 'done', confirmed: false, error: undefined }; return list; }); message.success(`已为镜头 ${i + 1} 设置图片，请确认`); } };
  const applySelectedImgSources = () => { const picked = imgSourceItems.filter(x => imgSelectedIds.has(x.id)); picked.forEach(p => { if (p.url) applyShotImage(imgTargetIndex, p.url, imgTargetKind); }); setImgSourceOpen(false); };

  const [cols, setCols] = React.useState([0.34, 0.33, 0.33]);
  const [fracs, setFracs] = React.useState<Record<string, number>>({ left: 0.5, mid: 0.5, right: 0.5 });
  const startDrag = (type: 'col' | 'row', i: number, target: string, e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { type, i, target, start: 0, total: 0 };
    document.body.style.cursor = type === 'col' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  };
  React.useEffect(() => {
    // 绝对跟手模式：分隔条位置 = 鼠标在容器内的比例（拖哪跟哪，无累计误差）
    const move = (e: MouseEvent) => {
      const d = dragRef.current; if (!d) return;
      const rect = mainRef.current?.getBoundingClientRect();
      if (!rect || rect.width < 10 || rect.height < 10) return;
      if (d.type === 'col') {
        const ratio = Math.max(0.18, Math.min(0.82, (e.clientX - rect.left) / rect.width));
        setCols(prev => {
          const before = prev.slice(0, d.i).reduce((sum, v) => sum + v, 0);
          const a = Math.max(0.16, ratio - before);
          const next = [...prev];
          next[d.i] = a;
          next[d.i + 1] = Math.max(0.16, prev[d.i + 1] - (a - prev[d.i]));
          return next;
        });
      } else {
        const ratio = Math.max(0.24, Math.min(0.76, (e.clientY - rect.top) / rect.height));
        setFracs(prev => ({ ...prev, [d.target]: ratio }));
      }
    };
    const up = () => { dragRef.current = null; document.body.style.cursor = ''; document.body.style.userSelect = ''; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);

  const activeTimeline = timeline;

  const composeFinal = async () => {
    const items = activeTimeline.map(t => ({ video: t.videoUrl, audio: t.audioUrl || '', hasAudio: !!t.hasAudio, trim: { start: t.start || 0, end: t.end || 0 } }));
    if (!items.length || items.some(i => !i.video)) { message.warning('时间线为空，请先完成视频生成'); return; }
    setComposing(true); setComposeHint('');
    try {
      const result = await (window as any).electronAPI?.ffmpegCompose?.({ items });
      if (!result?.url) throw new Error('合成失败，请确认 FFmpeg 可用');
      setFinalVideo(result.url);
      setComposeHint(`合成完成 · ${items.length} 段 · ${Math.round((result.size || 0) / 1024 / 1024)}MB`);
      message.success('成片合成完成');
    } catch (error: any) {
      message.error(String(error?.message || error));
    } finally { setComposing(false); }
  };

  const allImagesConfirmed = segments.length > 0 && shots.length >= segments.length && shots.every(sh => sh.status === 'done' && sh.confirmed);
  const allVideosConfirmed = segments.length > 0 && videoShots.length >= segments.length && videoShots.every(v => v.status === 'done' && v.confirmed);
  const allAudiosConfirmed = videoShots.length > 0 && videoShots.every((s, i) => s.hasAudio || (audioShots[i]?.status === 'done' && audioShots[i]?.confirmed));

  const segmentRows = useMemo(() => {
    const row = (seg: StoryboardSegment, i: number) => {
      const field = (name: 'firstFrame' | 'lastFrame' | 'videoPrompt', label: string) => {
        const val = String((seg[name] as any)?.prompt || seg[name] || '');
        const en = String((seg[name] as any)?.promptEn || '');
        return <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 9, color: '#93c5fd' }}>{label}（中文）</label>
          <textarea value={val} onChange={e => updateSegment(i, name, e.target.value)} style={{ width: '100%', minHeight: 40, background: 'var(--theme-input)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)', borderRadius: 5, padding: 5, fontSize: 10, resize: 'vertical' }} />
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input value={en} onChange={e => updateSegment(i, name, val, e.target.value)} placeholder="英文（可选，建议填写质量更高）" style={{ flex: 1, background: 'var(--theme-input)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)', borderRadius: 4, padding: 4, fontSize: 10 }} />
            <Button size="small" loading={translating[`${i}-${name}`]} onClick={() => translate(i, name, val)} disabled={!val} style={{ fontSize: 10 }}>翻译</Button>
          </div>
        </div>;
      };
      return <div key={seg.segmentId || i} style={{ border: '1px solid rgba(125,211,252,.25)', borderRadius: 8, padding: 8, marginBottom: 8, background: 'var(--theme-panel)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <b style={{ fontSize: 11, color: '#7dd3fc' }}>镜头 {i + 1} · {seg.duration} 秒</b>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ fontSize: 9, color: 'var(--theme-muted)' }}>{seg.characters?.join('、') || '无角色'} · {seg.locations?.join('、') || ''}</span><Button size="small" icon={<UploadOutlined />} onClick={() => openImgSources(i, 'local', 'shot')} style={{ fontSize: 9 }}>上传图</Button></span>
        </div>
        {field('firstFrame', '首帧画面')}
        {field('lastFrame', '尾帧画面')}
        {field('videoPrompt', '视频动态')}
        <div style={{ marginBottom: 4 }}>
          <label style={{ fontSize: 9, color: '#fcd34d' }}>台词（配音用）</label>
          <input value={String(seg.dialogue || '')} onChange={e => updateSegment(i, 'dialogue', e.target.value)} placeholder="角色说的台词" style={{ width: '100%', background: 'var(--theme-input)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)', borderRadius: 4, padding: 4, fontSize: 10 }} />
        </div>
      </div>;
    };
    return segments.map(row);
  }, [segments, translating]);

  const projectPct = Math.min(100, Math.round((0 + (script.trim() ? 15 : 0) + (segments.length ? 25 : 0) + (shots.filter(sh => sh.imageUrl).length / Math.max(1, segments.length)) * 20 + (videoShots.filter(v => v.videoUrl).length / Math.max(1, segments.length)) * 20 + (audioShots.filter(a => a.audioUrl).length / Math.max(1, segments.length)) * 20) * 0.85));
  const sendAi = async () => {
    const text = aiInput.trim(); if (!text || aiBusy) return;
    setAiInput(''); setAiMessages(m => [...m, { role: 'user', content: text }]); setAiBusy(true);
    try {
      const ctx = `当前步骤：${STEPS[step]}\n剧本：${(script || '').slice(0, 200)}\n分镜数：${segments.length}\n已完成图片：${shots.filter(sh => sh.imageUrl).length}/${segments.length}\n已完成视频：${videoShots.filter(v => v.videoUrl).length}/${segments.length}\n已完成配音：${audioShots.filter(a => a.audioUrl).length}/${segments.length}`;
      const { sendChat } = await import('@/services/chat.service');
      const res = await sendChat(`${text}\n\n【当前项目状态】\n${ctx}`, [], [], undefined, { systemPrompt: '你是短剧工作室的 AI 助手。回答简洁、可执行，针对当前步骤给出具体建议，不要改用户内容，只给建议。' });
      setAiMessages(m => [...m, { role: 'assistant', content: res.text }]);
    } catch (err: any) { setAiMessages(m => [...m, { role: 'assistant', content: '调用失败：' + String(err?.message || err).slice(0, 120) }]); }
    finally { setAiBusy(false); }
  };

  return <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--theme-bg)', display: 'flex', flexDirection: 'column', color: 'var(--theme-text)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid var(--theme-border)', background: 'var(--theme-panel)' }}>
      <span style={{ fontSize: 15, fontWeight: 700 }}>短剧工作室</span>
      <Button size="small" type="primary" icon={<ThunderboltOutlined />} loading={autoStage !== 'idle'} onClick={startAutoRun} disabled={autoStage !== 'idle'} style={{ marginLeft: 12 }}>{autoStage !== 'idle' ? `一键生成中…（${autoStage === 'sb' ? '分镜' : autoStage === 'img' ? '图片' : autoStage === 'vid' ? '视频' : autoStage === 'aud' ? '配音' : '合成'}）` : '一键生成'}</Button>
      <span style={{ fontSize: 10, color: 'var(--theme-muted)' }}>写个剧本，它给你一部短剧</span>
      <div style={{ flex: 1 }} />
      <Button size="small" type="primary" icon={<CloseOutlined />} onClick={onClose}>退出</Button>
    </div>
    <div style={{ display: 'flex', gap: 0, padding: '6px 16px', borderBottom: '1px solid var(--theme-border)', alignItems: 'center' }}>
      {STEPS.map((name, i) => (
        <div key={name} onClick={() => i <= step && setStep(i)} style={{ cursor: i <= step ? 'pointer' : 'default', display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: i === step ? 600 : 400, color: i === step ? 'var(--theme-text)' : i < step ? 'var(--theme-text-2)' : 'var(--theme-text-3)', background: i === step ? 'var(--theme-accent-soft)' : 'transparent', whiteSpace: 'nowrap' }}>
            <span>{i < step ? '✓' : i + 1}</span>{name}
          </div>
          {i < STEPS.length - 1 && <div style={{ flex: 1, height: 2, background: i < step ? 'var(--theme-primary)' : 'var(--theme-border)', borderRadius: 1, margin: '0 4px' }} />}
        </div>
      ))}
    </div>
    
        <div style={{ flex: 1, display: 'flex', minHeight: 0, padding: 10, gap: 10 }}>
      {/* 左侧项目栏 */}
      <div style={{ width: 200, flex: '0 0 200px', display: 'flex', flexDirection: 'column', gap: 8, overflow: 'auto' }}>
        <section style={{ border: '1px solid var(--theme-border)', borderRadius: 10, background: 'var(--theme-panel)', padding: 10, flexShrink: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: 'var(--theme-text)' }}>项目进度</div>
          <div style={{ height: 5, borderRadius: 99, background: 'var(--theme-border)', overflow: 'hidden', marginBottom: 6 }}>
            <div style={{ height: '100%', width: `${projectPct}%`, background: 'var(--theme-primary)', transition: 'width .3s ease' }} />
          </div>
          <div style={{ fontSize: 10, color: 'var(--theme-muted)' }}>已完成 {projectPct}% · 当前：{STEPS[step]}</div>
        </section>
        <section style={{ border: '1px solid var(--theme-border)', borderRadius: 10, background: 'var(--theme-panel)', padding: 10, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: 'var(--theme-text)' }}>分镜列表{segments.length ? `（${segments.length}）` : ''}</div>
          <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {segments.length === 0 ? <div style={{ fontSize: 10, color: 'var(--theme-muted)' }}>还没有分镜，先在「剧本」步骤生成。</div> :
              segments.map((seg, i) => (
                <button key={seg.segmentId || i} onClick={() => { if (step > 1) setStep(1); }} style={{ textAlign: 'left', border: '1px solid var(--theme-border)', borderRadius: 8, background: 'var(--theme-surface)', padding: '6px 8px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--theme-text)' }}>镜头 {String(i + 1).padStart(2, '0')}</span>
                  <span style={{ fontSize: 9, color: 'var(--theme-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(seg.firstFrame?.prompt || seg.firstFrame || '').slice(0, 26) || '未填写画面'}</span>
                  <span style={{ fontSize: 9, color: 'var(--theme-muted)' }}>{seg.duration} 秒 · {seg.characters?.join('、') || '无角色'}</span>
                </button>
              ))}
          </div>
        </section>
      </div>
      {/* 中央当前步骤工作区 */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {step === 0 && <><section style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', border: '1px solid var(--theme-border)', borderRadius: 10, background: 'var(--theme-panel)', overflow: 'hidden' }}><div style={{ fontSize: 10, color: 'var(--theme-muted)', padding: '5px 10px', borderBottom: '1px solid var(--theme-border)', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}><b style={{ color: 'var(--theme-primary)', background: 'rgba(99,102,241,.2)', borderRadius: 4, padding: '0 5px' }}>STEP 1</b><span style={{ fontWeight: 600, color: 'var(--theme-text)' }}>剧本</span><span style={{ color: 'var(--theme-muted)' }}>→ 写剧情 → 生成分镜</span></div><div style={{ flex: 1, overflow: 'auto', padding: 10 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>① 写剧本</h3>
        <p style={{ fontSize: 11, color: 'var(--theme-muted)', margin: '0 0 12px' }}>写一段剧情描述，AI 会拆分成连续镜头。也可以一句话开场（如：一个女孩在雨天捡到一只受伤的小猫，带回家照顾）。</p>
        {!script.trim() && <div style={{ marginBottom: 6 }}><Button size="small" icon={<Sparkles size={14} />} onClick={() => setScript(EXAMPLE_SCRIPT)}>填入示例剧本（3 秒上手）</Button></div>}
        <textarea value={script} onChange={e => setScript(e.target.value)} placeholder="剧情 / 剧本…" style={{ width: '100%', minHeight: 180, background: 'var(--theme-input)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)', borderRadius: 8, padding: 10, fontSize: 13, resize: 'vertical', lineHeight: 1.7 }} />
        <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ fontSize: 11, color: 'var(--theme-text)' }}>分镜数 <InputNumber size="small" min={1} max={30} value={segmentCount} onChange={v => setSegmentCount(Number(v) || 3)} /></label>
          <label style={{ fontSize: 11, color: 'var(--theme-text)' }}>总时长(秒) <InputNumber size="small" min={3} max={600} value={totalDuration} onChange={v => setTotalDuration(Number(v) || 15)} /></label>
          <label style={{ fontSize: 11, color: 'var(--theme-text)' }}>分段规则 <Input size="small" value={segmentRule} onChange={e => setSegmentRule(e.target.value)} style={{ width: 140 }} /></label>
        </div>
        <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: 'var(--theme-border)', fontSize: 11, color: 'var(--theme-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>分镜 AI：<b style={{ color: 'var(--theme-text)' }}>{aiLabel}</b></span>
          {!settings.dramaAiApiKey && !settings.optimizerApiKey && settings.optimizerProvider !== 'ollama' && settings.dramaAiProvider !== 'ollama' && <span style={{ color: 'var(--theme-warning)' }}>（未配置 API Key）</span>}
          <div style={{ flex: 1 }} />
          <a onClick={() => { dramaAiForm.setFieldsValue({ dramaAiProvider: settings.dramaAiProvider || settings.optimizerProvider, dramaAiBaseUrl: settings.dramaAiBaseUrl || settings.optimizerBaseUrl, dramaAiApiKey: settings.dramaAiApiKey || '', dramaAiModel: settings.dramaAiModel || settings.optimizerModel || '' }); setDramaAiModalOpen(true); }} style={{ fontSize: 11 }}>分镜 AI 设置</a>
        </div>
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <Button type="primary" size="large" icon={<ThunderboltOutlined />} loading={generating} onClick={() => void genStoryboard()} disabled={!script.trim()}>生成分镜</Button>
        </div></div></section></>}
        {step === 1 && <><section style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', border: '1px solid var(--theme-border)', borderRadius: 10, background: 'var(--theme-panel)', overflow: 'hidden' }}><div style={{ fontSize: 10, color: 'var(--theme-muted)', padding: '5px 10px', borderBottom: '1px solid var(--theme-border)', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}><b style={{ color: 'var(--theme-primary)', background: 'rgba(99,102,241,.2)', borderRadius: 4, padding: '0 5px' }}>STEP 2</b><span style={{ fontWeight: 600, color: 'var(--theme-text)' }}>分镜</span><span style={{ color: 'var(--theme-muted)' }}>→ 确认镜头列表</span></div><div style={{ flex: 1, overflow: 'auto', padding: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 14 }}>② 分镜（可逐镜修改）</h3>
          <div style={{ flex: 1 }} />
          <Button size="small" icon={<PlusOutlined />} onClick={addManualSegment}>＋ 添加分镜</Button>
        </div>
        <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 280, padding: 10, borderRadius: 8, background: 'rgba(125,211,252,.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <b style={{ fontSize: 11, color: '#7dd3fc' }}>角色设定</b>
              <span style={{ fontSize: 10, color: 'var(--theme-muted)' }}>人物数</span>
              <InputNumber size="small" min={0} max={12} value={personCount} onChange={v => setPersonCount(Number(v) || 0)} style={{ width: 56 }} />
            </div>
            {Array.from({ length: personCount }, (_, i) => (
              <input key={i} value={String(personNotes[`person_${i + 1}`] || '')} onChange={e => setPersonNotes(p => ({ ...p, [`person_${i + 1}`]: e.target.value }))} placeholder={`角色 ${i + 1} 描述（外貌/服装/特征）`} style={{ width: '100%', marginBottom: 4, background: 'var(--theme-input)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)', borderRadius: 4, padding: 5, fontSize: 11 }} />
            ))}
          </div>
          <div style={{ flex: 1, minWidth: 280, padding: 10, borderRadius: 8, background: 'rgba(251,191,36,.05)' }}>
            <b style={{ fontSize: 11, color: '#fcd34d' }}>场景 / 风格要求</b>
            <textarea value={sceneNotes} onChange={e => setSceneNotes(e.target.value)} placeholder="整体风格、时间、地点、光线等（如：民国年代、雨夜、暖黄色路灯、电影感）" style={{ width: '100%', minHeight: 70, marginTop: 6, background: 'var(--theme-input)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)', borderRadius: 4, padding: 5, fontSize: 11, resize: 'vertical' }} />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <a onClick={() => setShowAdvanced(v => !v)} style={{ fontSize: 11, color: 'var(--theme-primary)' }}>{showAdvanced ? '收起' : '展开'}分镜规则（系统提示词，可自定义）</a>
          {showAdvanced && <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} placeholder="自定义分镜 AI 的规则…（留空用默认）" style={{ width: '100%', minHeight: 90, marginTop: 6, background: 'var(--theme-input)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)', borderRadius: 6, padding: 8, fontSize: 11, resize: 'vertical', lineHeight: 1.6 }} />}
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <Button icon={<ReloadOutlined />} loading={generating} onClick={() => void genStoryboard()}>重新生成分镜</Button>
          {segments.length > 0 && <span style={{ fontSize: 11, color: 'var(--theme-muted)', alignSelf: 'center' }}>{segments.length} 镜 · 每镜可改提示词/台词，改完点「翻译」生成英文</span>}
        </div>
        {segments.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: 'var(--theme-muted)', fontSize: 12 }}>还没有分镜，先在①填剧本并生成。</div> : segmentRows}</div></section></>}
        {step === 2 && <><section style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', border: '1px solid var(--theme-border)', borderRadius: 10, background: 'var(--theme-panel)', overflow: 'hidden' }}><div style={{ fontSize: 10, color: 'var(--theme-muted)', padding: '5px 10px', borderBottom: '1px solid var(--theme-border)', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}><b style={{ color: 'var(--theme-primary)', background: 'rgba(99,102,241,.2)', borderRadius: 4, padding: '0 5px' }}>STEP 3</b><span style={{ fontWeight: 600, color: 'var(--theme-text)' }}>图片确认</span><span style={{ color: 'var(--theme-muted)' }}>→ 逐镜生成图片</span></div><div style={{ flex: 1, overflow: 'auto', padding: 10 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>③ 逐镜生成图片（可确认 / 重新生成）</h3>
        <p style={{ fontSize: 11, color: 'var(--theme-muted)', margin: '0 0 12px' }}>依次提交每一镜，返回后显示；满意点「确认」，不满意点「重新生成」单独重跑该镜。也可以直接上传/选择已有图片（本地 / 资产 / 画布 / 历史）。全部确认后才进入视频阶段。</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
          <Segmented size="small" value={imgMode} onChange={v => setImgMode(v as 'direct' | 'setup')} options={[{ label: '直接出分镜图', value: 'direct' }, { label: '先定妆再出图', value: 'setup' }]} />
          <span style={{ fontSize: 10, color: 'var(--theme-muted)' }}>风格</span>
          <select value={imgStyle} onChange={e => setImgStyle(e.target.value)} style={{ background: 'var(--theme-input)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)', borderRadius: 5, padding: 3, fontSize: 11 }}>{getAllStyles().map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        </div>
        {imgMode === 'setup' && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <Button size="small" icon={<UserOutlined />} loading={generatingRefs} onClick={() => void generateCharRefs()}>生成角色定妆图</Button>
            <Button size="small" icon={<EnvironmentOutlined />} loading={generatingScene} onClick={() => void generateSceneRefs()}>生成场景图</Button>
            <span style={{ fontSize: 10, color: 'var(--theme-muted)' }}>用剧本页的角色/场景描述生成，分镜图将以角色图为基础（图生图）</span>
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220, padding: 8, borderRadius: 8, background: 'var(--theme-border)' }}>
            <div style={{ fontSize: 10, color: 'var(--theme-muted)', marginBottom: 6 }}>角色参考图（选填）</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {charRefs.map((u, j) => <img key={j} src={u} alt="" style={{ width: 44, height: 44, borderRadius: 6, objectFit: 'cover', border: '1px solid rgba(255,255,255,.15)' }} />)}
              <Button size="small" icon={<PlusOutlined />} onClick={() => openImgSources(0, 'asset', 'char')}>添加</Button>
              {charRefs.length > 0 && <Button size="small" type="text" onClick={() => setCharRefs([])} style={{ fontSize: 10 }}>清空</Button>}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 220, padding: 8, borderRadius: 8, background: 'var(--theme-border)' }}>
            <div style={{ fontSize: 10, color: 'var(--theme-muted)', marginBottom: 6 }}>场景参考图（选填）</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {sceneRefs.map((u, j) => <img key={j} src={u} alt="" style={{ width: 44, height: 44, borderRadius: 6, objectFit: 'cover', border: '1px solid rgba(255,255,255,.15)' }} />)}
              <Button size="small" icon={<PlusOutlined />} onClick={() => openImgSources(0, 'asset', 'scene')}>添加</Button>
              {sceneRefs.length > 0 && <Button size="small" type="text" onClick={() => setSceneRefs([])} style={{ fontSize: 10 }}>清空</Button>}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 12, padding: 10, borderRadius: 8, background: 'var(--theme-border)', flexWrap: 'wrap', alignItems: 'center' }}>
          <Segmented value={imgEngine} onChange={v => setImgEngine(v as 'paid' | 'comfyui')} options={[{ label: '付费 API', value: 'paid' }, { label: 'ComfyUI 工作流', value: 'comfyui' }]} size="small" />
          {imgEngine === 'paid' ? <>
            <select value={imgProvider || imgProviders[0] || ''} onChange={e => { setImgProvider(e.target.value); setImgModel(''); }} style={{ background: 'var(--theme-input)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)', borderRadius: 5, padding: 4, fontSize: 11 }}>{imgProviders.map(id => <option key={id} value={id}>{PAID_API_ADAPTERS[id].label}</option>)}</select>
            <select value={imgModel || imgProviderOptions[0]?.id || ''} onChange={e => setImgModel(e.target.value)} style={{ background: 'var(--theme-input)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)', borderRadius: 5, padding: 4, fontSize: 11 }}>{imgProviderOptions.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
            <span style={{ fontSize: 10, color: 'var(--theme-muted)' }}>角色图:</span>
            <select value={charModel || ''} onChange={e => setCharModel(e.target.value)} style={{ background: 'var(--theme-input)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)', borderRadius: 5, padding: 4, fontSize: 11 }}><option value="">（跟随上方模型）</option>{imgProviderOptions.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
            <span style={{ fontSize: 10, color: 'var(--theme-muted)' }}>场景图:</span>
            <select value={sceneModel || ''} onChange={e => setSceneModel(e.target.value)} style={{ background: 'var(--theme-input)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)', borderRadius: 5, padding: 4, fontSize: 11 }}><option value="">（跟随上方模型）</option>{imgProviderOptions.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
          </> : <>
            <select value={comfyWorkflow} onChange={e => setComfyWorkflow(e.target.value)} onFocus={() => void ensureComfyWorkflows()} style={{ minWidth: 260, background: 'var(--theme-input)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)', borderRadius: 5, padding: 4, fontSize: 11 }}>{comfyWorkflows.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
            <span style={{ fontSize: 10, color: 'var(--theme-muted)' }}>（提示词自动填入工作流的文本字段）</span>
          </>}
          <div style={{ flex: 1 }} />
          <Button type="primary" icon={<ThunderboltOutlined />} loading={generatingImages} onClick={() => void generateAllImages()} disabled={!segments.length}>逐镜生成图片</Button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 10 }}>
          {shots.length === 0 && <div style={{ gridColumn: '1/-1', padding: 30, textAlign: 'center', color: 'var(--theme-muted)', fontSize: 12 }}>还没有镜头图片，可以直接上传/选择已有图片作为镜头图（无需先生成）。
            <div style={{ marginTop: 10, display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Button size="small" icon={<UploadOutlined />} onClick={() => { setImgTargetIndex(0); setImgTargetKind('shot'); imgFileRef.current?.click(); }}>本地</Button>
              <Button size="small" onClick={() => openImgSources(0, 'asset', 'shot')}>资产</Button>
              <Button size="small" onClick={() => openImgSources(0, 'canvas', 'shot')}>画布</Button>
              <Button size="small" onClick={() => openImgSources(0, 'history', 'shot')}>历史</Button>
            </div>
          </div>}
          {shots.map((shot, i) => {
            const seg = segments[i] as any;
            return <div key={i} style={{ border: '1px solid ' + (shot.confirmed ? 'rgba(52,211,153,.5)' : 'rgba(255,255,255,.12)'), borderRadius: 8, overflow: 'hidden', background: 'var(--theme-panel)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', fontSize: 10, color: 'var(--theme-text)', alignItems: 'center' }}>
                <b>镜头 {i + 1}</b>
                <span style={{ color: shot.status === 'done' ? 'var(--theme-success)' : shot.status === 'error' ? 'var(--theme-error)' : shot.status === 'generating' ? 'var(--theme-warning)' : 'var(--theme-muted)' }}>{shot.status === 'done' ? '✓ 完成' : shot.status === 'generating' ? '生成中…' : shot.status === 'error' ? '失败' : '等待'}</span>
              </div>
              <div style={{ height: 150, background: 'var(--theme-input)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {shot.imageUrl ? <img src={shot.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 9, color: 'var(--theme-border)' }}>{shot.status === 'error' ? shot.error : '暂无图片'}</span>}
              </div>
              <div style={{ padding: 6, fontSize: 9, color: 'var(--theme-muted)', minHeight: 30 }}>{(seg?.firstFrame?.promptEn || seg?.firstFrame?.prompt || '').slice(0, 50)}</div>
              <div style={{ display: 'flex', gap: 6, padding: 6 }}>
                <Button size="small" type={shot.confirmed ? 'default' : 'primary'} icon={<CheckOutlined />} disabled={shot.status !== 'done' || shot.confirmed} onClick={() => setShots(prev => prev.map((s, j) => j === i ? { ...s, confirmed: true } : s))} style={{ flex: 1, fontSize: 10 }}>满意</Button>
                <Button size="small" icon={<ReloadOutlined />} loading={regeneratingIndex === i} disabled={generatingImages || shot.status === 'generating'} onClick={() => void regenerateOne(i)} style={{ flex: 1, fontSize: 10 }}>重生成</Button>
                <Button size="small" icon={<UploadOutlined />} onClick={() => openImgSources(i, 'local')} style={{ flex: 1, fontSize: 10 }}>上传</Button>
              </div>
              <div style={{ display: 'flex', gap: 4, padding: '0 6px 6px', flexWrap: 'wrap' }}>
                <Button size="small" type="text" icon={<UploadOutlined />} onClick={() => { setImgTargetIndex(i); setImgTargetKind('shot'); imgFileRef.current?.click(); }} style={{ fontSize: 10 }}>本地</Button>
                <Button size="small" type="text" onClick={() => openImgSources(i, 'asset')} style={{ fontSize: 10 }}>资产</Button>
                <Button size="small" type="text" onClick={() => openImgSources(i, 'canvas')} style={{ fontSize: 10 }}>画布</Button>
                <Button size="small" type="text" onClick={() => openImgSources(i, 'history')} style={{ fontSize: 10 }}>历史</Button>
              </div>
            </div>;
          })}
        </div></div></section></>}
        {step === 3 && <><section style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', border: '1px solid var(--theme-border)', borderRadius: 10, background: 'var(--theme-panel)', overflow: 'hidden' }}><div style={{ fontSize: 10, color: 'var(--theme-muted)', padding: '5px 10px', borderBottom: '1px solid var(--theme-border)', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}><b style={{ color: 'var(--theme-primary)', background: 'rgba(99,102,241,.2)', borderRadius: 4, padding: '0 5px' }}>STEP 4</b><span style={{ fontWeight: 600, color: 'var(--theme-text)' }}>视频生成</span><span style={{ color: 'var(--theme-muted)' }}>→ 逐镜生成视频</span></div><div style={{ flex: 1, overflow: 'auto', padding: 10 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>④ 逐镜生成视频（确认图片 → 图生视频）</h3>
        <p style={{ fontSize: 11, color: 'var(--theme-muted)', margin: '0 0 12px' }}>每镜可直接填写视频提示词生成视频（有确认图片则自动图生视频，无图则文生视频）。视频较慢（每镜 1-5 分钟），可单镜重生成；勾选「已含音频」的镜头跳过配音。</p>
        <div style={{ display: 'flex', gap: 10, marginBottom: 12, padding: 10, borderRadius: 8, background: 'var(--theme-border)', flexWrap: 'wrap', alignItems: 'center' }}>
          <Segmented value={vidEngine} onChange={v => setVidEngine(v as 'paid' | 'comfyui')} options={[{ label: '付费 API', value: 'paid' }, { label: 'ComfyUI 工作流', value: 'comfyui' }]} size="small" />
          {vidEngine === 'paid' ? <>
            <select value={vidProvider || vidProviders[0] || ''} onChange={e => { setVidProvider(e.target.value); setVidModel(''); }} style={{ background: 'var(--theme-input)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)', borderRadius: 5, padding: 4, fontSize: 11 }}>{vidProviders.map(id => <option key={id} value={id}>{PAID_API_ADAPTERS[id].label}</option>)}</select>
            <select value={vidModel || vidProviderOptions[0]?.id || ''} onChange={e => setVidModel(e.target.value)} style={{ background: 'var(--theme-input)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)', borderRadius: 5, padding: 4, fontSize: 11 }}>{vidProviderOptions.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
          </> : <>
            <select value={vidComfyWorkflow} onChange={e => setVidComfyWorkflow(e.target.value)} onFocus={() => void ensureComfyWorkflows()} style={{ minWidth: 280, background: 'var(--theme-input)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)', borderRadius: 5, padding: 4, fontSize: 11 }}>{workflowsForCap(comfyWorkflows, 'image-to-video').map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
            <span style={{ fontSize: 10, color: 'var(--theme-muted)' }}>已按「图生视频」能力筛选（图片需来自 ComfyUI 或可访问的 URL）</span>
          </>}
          <div style={{ flex: 1 }} />
          <Button type="primary" icon={<ThunderboltOutlined />} loading={generatingVideos} onClick={() => void generateAllVideos()} disabled={!videoShots.length && !segments.length}>逐镜生成视频</Button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
          {videoShots.length === 0 && <div style={{ gridColumn: '1/-1', padding: 30, textAlign: 'center', color: 'var(--theme-muted)', fontSize: 12 }}>{segments.length ? '已就绪：可直接编辑每镜提示词生成视频。' : '无需分镜分析：添加镜头并填写视频提示词，直接生成视频。'}
            <div style={{ marginTop: 10 }}><Button size="small" icon={<PlusOutlined />} onClick={addManualVideoShot}>＋ 添加镜头</Button></div>
          </div>}
          {videoShots.map((shot, i) => (
            <div key={i} style={{ border: '1px solid ' + (shot.confirmed ? 'rgba(52,211,153,.5)' : 'rgba(255,255,255,.12)'), borderRadius: 8, overflow: 'hidden', background: 'var(--theme-panel)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', fontSize: 10, color: 'var(--theme-text)', alignItems: 'center' }}>
                <b>镜头 {i + 1}</b>
                <span style={{ color: shot.status === 'done' ? 'var(--theme-success)' : shot.status === 'error' ? 'var(--theme-error)' : shot.status === 'generating' ? 'var(--theme-warning)' : 'var(--theme-muted)' }}>{shot.status === 'done' ? '✓ 完成' : shot.status === 'generating' ? '生成中…' : shot.status === 'error' ? '失败' : '等待'}</span>
              </div>
              <div style={{ height: 150, background: 'var(--theme-input)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {shot.videoUrl ? <video src={shot.videoUrl} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 9, color: 'var(--theme-border)' }}>{shot.status === 'error' ? shot.error : '暂无视频'}</span>}
              </div>
              <div style={{ padding: '5px 6px' }}>
                <textarea value={shot.prompt || ''} onChange={e => setVideoShots(prev => prev.map((s, j) => j === i ? { ...s, prompt: e.target.value } : s))} placeholder="视频提示词（可留空用分镜描述）" style={{ width: '100%', minHeight: 42, background: 'var(--theme-input)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)', borderRadius: 6, padding: 4, fontSize: 10, resize: 'vertical', lineHeight: 1.5 }} />
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--theme-muted)', marginTop: 4, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!shot.hasAudio} onChange={e => setVideoShots(prev => prev.map((s, j) => j === i ? { ...s, hasAudio: e.target.checked } : s))} /> 视频已含音频（跳过配音）
                </label>
              </div>
              <div style={{ display: 'flex', gap: 6, padding: 6 }}>
                <Button size="small" type={shot.confirmed ? 'default' : 'primary'} icon={<CheckOutlined />} disabled={shot.status !== 'done' || shot.confirmed} onClick={() => setVideoShots(prev => prev.map((s, j) => j === i ? { ...s, confirmed: true } : s))} style={{ flex: 1, fontSize: 10 }}>满意</Button>
                <Button size="small" icon={<ReloadOutlined />} loading={regeneratingVideoIndex === i} disabled={generatingVideos || shot.status === 'generating'} onClick={() => void regenerateVideoOne(i)} style={{ flex: 1, fontSize: 10 }}>重生成</Button>
              </div>
            </div>
          ))}
        </div></div></section></>}
        {step === 4 && <><section style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', border: '1px solid var(--theme-border)', borderRadius: 10, background: 'var(--theme-panel)', overflow: 'hidden' }}><div style={{ fontSize: 10, color: 'var(--theme-muted)', padding: '5px 10px', borderBottom: '1px solid var(--theme-border)', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}><b style={{ color: 'var(--theme-primary)', background: 'rgba(99,102,241,.2)', borderRadius: 4, padding: '0 5px' }}>STEP 5</b><span style={{ fontWeight: 600, color: 'var(--theme-text)' }}>配音</span><span style={{ color: 'var(--theme-muted)' }}>→ 台词 → 语音</span></div><div style={{ flex: 1, overflow: 'auto', padding: 10 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>⑤ 配音（每镜台词 → TTS）</h3>
        <p style={{ fontSize: 11, color: 'var(--theme-muted)', margin: '0 0 12px' }}>用每镜台词生成配音（MiniMax 云端 TTS）。可试听、单镜重生成；没台词的镜头自动跳过。全部确认后进入合成。</p>
        <div style={{ display: 'flex', gap: 10, marginBottom: 12, padding: 10, borderRadius: 8, background: 'var(--theme-border)', flexWrap: 'wrap', alignItems: 'center' }}>
          <Segmented value={audioEngine} onChange={v => setAudioEngine(v as 'minimax' | 'comfyui')} options={[{ label: 'MiniMax TTS', value: 'minimax' }, { label: 'ComfyUI 工作流', value: 'comfyui' }]} size="small" />
          {audioEngine === 'comfyui' ? <select value={audioComfyWorkflow} onChange={e => setAudioComfyWorkflow(e.target.value)} onFocus={() => void ensureComfyWorkflows()} style={{ minWidth: 280, background: 'var(--theme-input)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)', borderRadius: 5, padding: 4, fontSize: 11 }}>{workflowsForCap(comfyWorkflows, 'text-to-speech').map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select> : <>
          <span style={{ fontSize: 11, color: 'var(--theme-text)' }}>音色</span>
          <select value={customVoiceId.trim() ? '__custom' : voiceId} onChange={e => { if (e.target.value === '__custom') setCustomVoiceId(voiceId); else { setCustomVoiceId(''); setVoiceId(e.target.value); } }} style={{ background: 'var(--theme-input)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)', borderRadius: 5, padding: 4, fontSize: 11 }}>
            {TTS_VOICES.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
            <option value="__custom">自定义 voice_id…</option>
          </select>
          <input value={customVoiceId} onChange={e => setCustomVoiceId(e.target.value)} placeholder="自定义 voice_id（留空用上方音色）" style={{ width: 220, background: 'var(--theme-input)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)', borderRadius: 5, padding: 4, fontSize: 11 }} />
          {!settings.paidApiProviders?.minimax?.apiKey && <span style={{ fontSize: 10, color: 'var(--theme-warning)' }}>（需配置 MiniMax API Key）</span>}
          </>}
          <div style={{ flex: 1 }} />
          <Button type="primary" icon={<ThunderboltOutlined />} loading={generatingAudios} onClick={() => void generateAllAudios()} disabled={!segments.length}>逐镜配音</Button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
          {audioShots.length === 0 && <div style={{ gridColumn: '1/-1', padding: 40, textAlign: 'center', color: 'var(--theme-muted)', fontSize: 12 }}>点击「逐镜配音」开始（自动跳过无台词的镜头）。</div>}
          {audioShots.map((shot, i) => (
            <div key={i} style={{ border: '1px solid ' + (shot.confirmed ? 'rgba(52,211,153,.5)' : 'rgba(255,255,255,.12)'), borderRadius: 8, padding: 8, background: 'var(--theme-panel)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--theme-text)', alignItems: 'center', marginBottom: 6 }}>
                <b>镜头 {i + 1}</b>
                <span style={{ color: shot.status === 'done' ? 'var(--theme-success)' : shot.status === 'error' ? 'var(--theme-error)' : shot.status === 'generating' ? 'var(--theme-warning)' : 'var(--theme-muted)' }}>{shot.status === 'done' ? '✓' : shot.status === 'generating' ? '配音中…' : shot.status === 'error' ? '失败' : '等待'}</span>
              </div>
              {videoShots[i]?.hasAudio && <div style={{ fontSize: 10, color: '#60a5fa', marginBottom: 6 }}>✓ 该镜视频已含音频，自动跳过配音</div>}
              <div style={{ fontSize: 9, color: 'var(--theme-muted)', marginBottom: 6, minHeight: 14 }}>「{String((segments[i] as any).dialogue || '')}」</div>
              {shot.audioUrl ? <audio src={shot.audioUrl} controls style={{ width: '100%', height: 30 }} /> : <div style={{ fontSize: 9, color: 'var(--theme-border)', height: 30, display: 'flex', alignItems: 'center' }}>{shot.status === 'error' ? shot.error : '无音频'}</div>}
              {shot.audioUrl && <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <Button size="small" type={shot.confirmed ? 'default' : 'primary'} icon={<CheckOutlined />} disabled={shot.confirmed} onClick={() => setAudioShots(prev => prev.map((s, j) => j === i ? { ...s, confirmed: true } : s))} style={{ flex: 1, fontSize: 10 }}>满意</Button>
                <Button size="small" icon={<ReloadOutlined />} loading={regeneratingAudioIndex === i} disabled={generatingAudios || shot.status === 'generating'} onClick={() => void regenerateAudioOne(i)} style={{ flex: 1, fontSize: 10 }}>重生成</Button>
              </div>}
            </div>
          ))}
        </div></div></section></>}
        {step === 5 && <><section style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', border: '1px solid var(--theme-border)', borderRadius: 10, background: 'var(--theme-panel)', overflow: 'hidden' }}><div style={{ fontSize: 10, color: 'var(--theme-muted)', padding: '5px 10px', borderBottom: '1px solid var(--theme-border)', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}><b style={{ color: 'var(--theme-primary)', background: 'rgba(99,102,241,.2)', borderRadius: 4, padding: '0 5px' }}>STEP 6</b><span style={{ fontWeight: 600, color: 'var(--theme-text)' }}>合成导出</span><span style={{ color: 'var(--theme-muted)' }}>→ 时间线 → 成片</span></div><div style={{ flex: 1, overflow: 'auto', padding: 10 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>⑥ 时间线合成导出（可拖动排序、每镜裁剪）</h3>
        <p style={{ fontSize: 11, color: 'var(--theme-muted)', margin: '0 0 12px' }}>拖动镜头卡片调整顺序（⠿ 手柄）；每镜可设开始/结束秒裁剪，配音自动跟随。确认后合成成片并下载。</p>
        <div style={{ marginBottom: 10 }}><Button size="small" icon={<span>📋</span>} onClick={exportShotList} disabled={!segments.length}>导出分镜拍摄表（CSV）</Button></div>
        {activeTimeline.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: 'var(--theme-muted)', fontSize: 12 }}>还没有可合成的镜头——请先完成视频生成（④）。</div> : <>
          <div style={{ marginBottom: 12 }}>
            {activeTimeline.map((t, i) => (
              <div key={i} draggable onDragStart={() => setDragIndex(i)} onDragOver={e => e.preventDefault()} onDrop={() => { if (dragIndex !== null && dragIndex !== i) { const arr = [...activeTimeline]; const [m] = arr.splice(dragIndex, 1); arr.splice(i, 0, m); setTimeline(arr); setDragIndex(null); } }} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 8, border: '1px solid ' + (dragIndex === i ? 'rgba(99,102,241,.7)' : 'rgba(255,255,255,.1)'), borderRadius: 8, marginBottom: 6, background: 'var(--theme-panel)' }}>
                <span style={{ cursor: 'grab', fontSize: 16, color: 'var(--theme-muted)', userSelect: 'none' }}>⠿</span>
                <span style={{ fontSize: 11, color: '#7dd3fc', width: 40 }}>#{i + 1}</span>
                <video src={t.videoUrl} muted playsInline style={{ width: 130, height: 72, objectFit: 'contain', background: 'var(--theme-input)', borderRadius: 4 }} />
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 10, color: 'var(--theme-text)', marginBottom: 4 }}>镜头 {t.shotIndex + 1}{t.audioUrl ? ' · 有配音' : ' · 无配音'}</div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 10, color: 'var(--theme-muted)' }}>
                    开始 <input type="number" min="0" step="0.1" value={t.start ?? ''} placeholder="0" onChange={e => { const n = Number(e.target.value); const val = e.target.value === '' ? undefined : (Number.isFinite(n) && n >= 0 ? n : undefined); setTimeline(activeTimeline.map((x, j) => j === i ? { ...x, start: val } : x)); }} style={{ width: 52, background: 'var(--theme-input)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)', borderRadius: 4, padding: 3 }} /> 秒
                    结束 <input type="number" min="0" step="0.1" value={t.end ?? ''} placeholder="全部" onChange={e => { const n = Number(e.target.value); const val = e.target.value === '' ? undefined : (Number.isFinite(n) && n >= 0 ? n : undefined); setTimeline(activeTimeline.map((x, j) => j === i ? { ...x, end: val } : x)); }} style={{ width: 52, background: 'var(--theme-input)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)', borderRadius: 4, padding: 3 }} /> 秒
                  </div>
                </div>
                {t.audioUrl && <audio src={t.audioUrl} controls style={{ width: 150, height: 30 }} />}
                <Button size="small" danger onClick={() => setTimeline(activeTimeline.filter((_, j) => j !== i))}>移除</Button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
            <Button type="primary" icon={<ThunderboltOutlined />} loading={composing} onClick={() => void composeFinal()} disabled={!activeTimeline.length}>合成成片</Button>
            <Button icon={<span>🎞</span>} onClick={exportEditList} disabled={!videoShots.length}>导出剪辑清单</Button>
            <Button icon={<Video size={14} />} onClick={exportEDL} disabled={!videoShots.length}>导出剪辑工程(EDL)</Button>
            <span style={{ fontSize: 10, color: 'var(--theme-muted)' }}>ffmpeg 逐段重编码 + 拼接，配音自动合入；裁剪精确到帧。</span>
          </div>
          {finalVideo && <div style={{ border: '1px solid rgba(52,211,153,.4)', borderRadius: 10, padding: 12, background: 'var(--theme-panel)' }}>
            <div style={{ fontSize: 11, color: 'var(--theme-success)', marginBottom: 8 }}>成片已生成{composeHint ? `（${composeHint}）` : ''}</div>
            <video src={finalVideo} controls style={{ width: '100%', maxHeight: 320, background: '#000', borderRadius: 8 }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <Button type="primary" icon={<RightOutlined />} onClick={() => void downloadMedia(finalVideo, '短剧成片.mp4', 'video').then(() => message.success('已开始下载')).catch(() => message.error('下载失败'))}>下载成片</Button>
              <Button onClick={() => { navigator.clipboard.writeText(finalVideo).then(() => message.success('路径已复制')).catch(() => message.warning('复制失败')); }}>复制路径</Button>
            </div>
          </div>}
        </>}</div></section></>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, flexShrink: 0 }}>
          <Button icon={<LeftOutlined />} disabled={step === 0} onClick={() => setStep(s => Math.max(0, s - 1))}>上一步</Button>
          <Button type="primary" disabled={step >= STEPS.length - 1 || (step === 2 && !allImagesConfirmed) || (step === 3 && !allVideosConfirmed) || (step === 4 && !allAudiosConfirmed) || (step === 1 && !segments.length)} onClick={() => setStep(s => Math.min(STEPS.length - 1, s + 1))}>下一步 <RightOutlined /></Button>
        </div>
      </div>
      {/* 右侧 AI 助手 */}
      <div style={{ width: 280, flex: '0 0 280px', display: 'flex', flexDirection: 'column', border: '1px solid var(--theme-border)', borderRadius: 10, background: 'var(--theme-panel)', overflow: 'hidden', minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderBottom: '1px solid var(--theme-border)', flexShrink: 0 }}>
          <b style={{ fontSize: 12, color: 'var(--theme-text)' }}>AI 助手</b>
          <span style={{ fontSize: 9, color: 'var(--theme-muted)' }}>· {STEPS[step]}</span>
          <div style={{ flex: 1 }} />
          <Button size="small" type="text" icon={<CloseOutlined />} onClick={() => setAiMessages([])} title="清空对话" style={{ fontSize: 10 }} />
        </div>
        <div style={{ display: 'flex', gap: 4, padding: '6px 10px', flexWrap: 'wrap', borderBottom: '1px solid var(--theme-border)', flexShrink: 0 }}>
          {aiSuggestions.map(sg => <Button key={sg} size="small" onClick={() => setAiInput(sg)} style={{ fontSize: 10, borderRadius: 12, color: 'var(--theme-text-2)', background: 'var(--theme-surface-2)' }}>{sg}</Button>)}
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {aiMessages.length === 0 && <div style={{ fontSize: 10, color: 'var(--theme-muted)', textAlign: 'center', padding: 16 }}>当前步骤：{STEPS[step]}。问 AI 任何问题，或点上方快捷建议。</div>}
          {aiMessages.map((m, i) => (
            <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%', padding: '6px 9px', borderRadius: 8, fontSize: 11, lineHeight: 1.5, whiteSpace: 'pre-wrap', background: m.role === 'user' ? 'var(--theme-accent-soft)' : 'var(--theme-surface-2)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)' }}>{m.content}</div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, padding: 8, borderTop: '1px solid var(--theme-border)', flexShrink: 0 }}>
          <input value={aiInput} onChange={e => setAiInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void sendAi(); }} placeholder="问 AI…" style={{ flex: 1, background: 'var(--theme-input)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)', borderRadius: 8, padding: '6px 9px', fontSize: 11, outline: 'none' }} />
          <Button size="small" type="primary" loading={aiBusy} onClick={() => void sendAi()}>发送</Button>
        </div>
      </div>
    </div>
      {/* 分镜 AI 独立设置（与聊天 AI / 提示词 AI 互不影响） */}
      <Modal title="分镜 AI 设置" open={dramaAiModalOpen} onCancel={() => setDramaAiModalOpen(false)} onOk={() => dramaAiForm.validateFields().then(v => { useSettingsStore.getState().setDramaAi({ dramaAiProvider: v.dramaAiProvider, dramaAiBaseUrl: String(v.dramaAiBaseUrl || '').replace(/\/+$/, ''), dramaAiApiKey: v.dramaAiApiKey || '', dramaAiModel: v.dramaAiModel || '' }); message.success('分镜 AI 已保存（不影响聊天 AI）'); setDramaAiModalOpen(false); })} okText="保存" cancelText="取消" width={480} destroyOnClose>
        <p style={{ fontSize: 11, color: 'var(--theme-muted)', marginBottom: 8 }}>短剧工作室分镜生成使用的独立 AI 配置，与聊天 AI 完全隔离。留空则自动回退「设置 → 提示词 AI」，再回退聊天 AI。</p>
        <Form form={dramaAiForm} layout="vertical">
          <Form.Item name="dramaAiProvider" label="提供商"><Select options={[{ label: 'OpenAI 兼容接口', value: 'openai' }, { label: 'Google Gemini', value: 'gemini' }, { label: 'Anthropic Claude', value: 'anthropic' }, { label: 'Ollama 本地', value: 'ollama' }]} /></Form.Item>
          <Form.Item name="dramaAiBaseUrl" label="API 地址"><Input placeholder="https://api.openai.com/v1" /></Form.Item>
          <Form.Item name="dramaAiApiKey" label="API 密钥"><Input.Password placeholder="留空则使用提示词 AI / 聊天 AI 配置" /></Form.Item>
          <Form.Item name="dramaAiModel" label="模型">
            <Select showSearch allowClear placeholder="选择或输入模型" options={(settings.dramaAiModels.length ? settings.dramaAiModels : []).map(m => ({ label: m, value: m }))} />
          </Form.Item>
          <Button size="small" loading={dramaAiFetching} onClick={() => { const v = dramaAiForm.getFieldsValue(); if (!v.dramaAiBaseUrl || !v.dramaAiApiKey) { message.warning('请先填 API 地址和密钥'); return; } setDramaAiFetching(true); void fetchModelsFromApi(v.dramaAiProvider || 'openai', v.dramaAiBaseUrl, v.dramaAiApiKey).then(models => { useSettingsStore.getState().setDramaAi({ dramaAiModels: models }); dramaAiForm.setFieldsValue({ dramaAiModel: models[0] || '' }); message.success(models.length ? `拉到 ${models.length} 个模型` : '未拉到模型，可手动输入'); }).catch(e => message.error('拉取失败：' + String(e?.message || e).slice(0, 80))).finally(() => setDramaAiFetching(false)); }}>拉取模型</Button>
        </Form>
      </Modal>

    <input ref={imgFileRef} type="file" accept="image/*" multiple hidden onChange={handleImgLocal} />
    <Modal title={imgTargetKind === 'char' ? '选择角色参考图' : imgTargetKind === 'scene' ? '选择场景参考图' : `选择图片 · 镜头 ${imgTargetIndex + 1}`} open={imgSourceOpen} onCancel={() => setImgSourceOpen(false)} onOk={applySelectedImgSources} okText="添加所选图片" width={640}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
        {([['asset', '资产'], ['canvas', '画布'], ['history', '历史']] as const).map(([t, label]) => (
          <Button key={t} size="small" type={imgSourceTab === t ? 'primary' : 'default'} onClick={() => { setImgSourceTab(t); setImgSelectedIds(new Set()); refreshImgSources(t); }}>{label}</Button>
        ))}
        <Button size="small" type={imgSourceTab === 'local' ? 'primary' : 'default'} onClick={() => { setImgSourceTab('local'); setImgSelectedIds(new Set()); }}>本地</Button>
      </div>
      {imgSourceTab === 'local' ? (
        <div style={{ padding: 30, textAlign: 'center', fontSize: 12 }}>
          <Button type="primary" icon={<UploadOutlined />} onClick={() => imgFileRef.current?.click()}>选择本地图片（可多选）</Button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8, maxHeight: 420, overflow: 'auto' }}>
          {imgSourceItems.map(item => (
            <button key={item.id} onClick={() => setImgSelectedIds(cur => { const next = new Set<string>(cur); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next; })} style={{ border: imgSelectedIds.has(item.id) ? '2px solid var(--theme-primary)' : '1px solid rgba(128,138,160,.35)', borderRadius: 8, overflow: 'hidden', padding: 0, background: 'rgba(128,138,160,.08)', cursor: 'pointer' }}>
              <img src={item.url} alt="" style={{ width: '100%', height: 80, objectFit: 'cover' }} />
              <span style={{ display: 'block', fontSize: 9, color: 'var(--theme-muted)', padding: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</span>
            </button>
          ))}
        </div>
      )}
      {imgSourceTab !== 'local' && !imgSourceItems.length && <div style={{ padding: 30, textAlign: 'center', fontSize: 12 }}>该来源暂无图片，试试其他来源或本地上传</div>}
    </Modal>
  </div>;
};

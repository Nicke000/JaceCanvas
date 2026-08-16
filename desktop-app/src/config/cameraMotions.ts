// 相机运镜预设：结构化运镜参数，生成视频时作为英文运镜描述追加到提示词
export interface CameraMotion { value: string; label: string; prompt: string; }

export const CAMERA_MOTIONS: CameraMotion[] = [
  { value: '', label: '无（自由）', prompt: '' },
  { value: 'zoom_in', label: '推近 Zoom In', prompt: 'slow zoom in, camera pushes toward subject' },
  { value: 'zoom_out', label: '拉远 Zoom Out', prompt: 'slow zoom out, camera pulls away from subject' },
  { value: 'pan_left', label: '左摇 Pan Left', prompt: 'camera pans left' },
  { value: 'pan_right', label: '右摇 Pan Right', prompt: 'camera pans right' },
  { value: 'tilt_up', label: '上摇 Tilt Up', prompt: 'camera tilts up' },
  { value: 'tilt_down', label: '下摇 Tilt Down', prompt: 'camera tilts down' },
  { value: 'orbit', label: '环绕 Orbit', prompt: 'camera orbits around subject' },
  { value: 'handheld', label: '手持 Handheld', prompt: 'handheld camera, slight natural shake' },
  { value: 'tracking', label: '跟拍 Tracking', prompt: 'tracking shot, camera follows subject' },
  { value: 'static', label: '固定镜头 Static', prompt: 'static camera, locked-off shot, no movement' },
  { value: 'crane_up', label: '升镜 Crane Up', prompt: 'camera cranes upward, rising above the scene' },
];

/** 取运镜英文描述（用于追加到视频提示词） */
export function cameraMotionPrompt(value: string): string {
  return CAMERA_MOTIONS.find(m => m.value === value)?.prompt || '';
}

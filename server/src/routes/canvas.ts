import { Router, type Request, type Response } from 'express';
import { canvasService } from '../services/canvasService.js';

const router = Router();
const routeId = (req: Request): string => String(req.params.id);

/** GET /api/projects - 获取所有项目 */
router.get('/projects', (_req: Request, res: Response) => {
  try {
    const projects = canvasService.getAllProjects();
    const parsed = projects.map((p) => ({
      ...p,
      canvasData: JSON.parse(p.canvas_data),
    }));
    res.json({ success: true, data: parsed });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

/** GET /api/projects/:id - 获取单个项目 */
router.get('/projects/:id', (req: Request, res: Response) => {
  try {
    const project = canvasService.getProjectById(routeId(req));
    if (!project) {
      res.status(404).json({ success: false, error: '项目不存在' });
      return;
    }
    res.json({
      success: true,
      data: { ...project, canvasData: JSON.parse(project.canvas_data) },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

/** POST /api/projects - 保存项目 */
router.post('/projects', (req: Request, res: Response) => {
  try {
    const { id, name, canvasData } = req.body;
    if (!id || !name) {
      res.status(400).json({ success: false, error: '缺少必要字段' });
      return;
    }
    const project = canvasService.saveProject({ id, name, canvasData });
    res.json({
      success: true,
      data: { ...project, canvasData: JSON.parse(project.canvas_data) },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

/** DELETE /api/projects/:id - 删除项目 */
router.delete('/projects/:id', (req: Request, res: Response) => {
  try {
    const deleted = canvasService.deleteProject(routeId(req));
    if (!deleted) {
      res.status(404).json({ success: false, error: '项目不存在' });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

/** GET /api/projects/:id/chat - 获取聊天消息 */
router.get('/projects/:id/chat', (req: Request, res: Response) => {
  try {
    const messages = canvasService.getChatMessages(routeId(req));
    res.json({ success: true, data: messages });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

/** POST /api/chat - 保存聊天消息 */
router.post('/chat', (req: Request, res: Response) => {
  try {
    const msg = canvasService.saveChatMessage(req.body);
    res.json({ success: true, data: msg });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

export default router;

import express from 'express';
import cors from 'cors';
import canvasRoutes from './routes/canvas.js';
import { initDatabase } from './db/index.js';

const app = express();
const PORT = process.env.PORT || 3001;

// 中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 路由
app.use('/api', canvasRoutes);

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// 初始化数据库后启动服务
async function start() {
  await initDatabase();
  console.log('📦 SQLite 数据库已就绪');

  app.listen(PORT, () => {
    console.log(`🚀 后端服务已启动: http://localhost:${PORT}`);
    console.log(`📡 API 地址: http://localhost:${PORT}/api`);
  });
}

start().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});


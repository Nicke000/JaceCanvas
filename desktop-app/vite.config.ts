import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'react-is': path.resolve(__dirname, './src/shims/react-is.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    include: ['dayjs', 'classnames', 'rc-util', 'rc-motion', 'rc-picker', 'rc-field-form'],
    exclude: [],
  },
  build: {
    // 将体积较大的稳定依赖拆分，避免所有功能打进一个入口文件。
    // 这些 chunk 会被 Electron/Vite 按需缓存，二次启动和增量更新更快。
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (/node_modules[\\/](?:react|react-dom|scheduler|use-sync-external-store)[\\/]/.test(id)) return 'vendor-react';
            if (/node_modules[\\/](@ant-design|antd|rc-)/.test(id)) return 'vendor-antd';
            if (/node_modules[\\/]@xyflow[\\/]/.test(id)) return 'vendor-flow';
            if (/node_modules[\\/]@react-three[\\/]/.test(id)) return 'vendor-react-three';
            if (/node_modules[\\/]three-stdlib[\\/]/.test(id)) return 'vendor-three-stdlib';
            if (/node_modules[\\/](three|camera-controls)[\\/]/.test(id)) return 'vendor-three-core';
            if (/node_modules[\\/]lucide-react[\\/]/.test(id)) return 'vendor-icons';
            // 其余依赖交给 Rollup 自动归类，避免公共依赖在手动 chunk 之间形成循环。
            return undefined;
          }
          if (id.includes(`${path.sep}src${path.sep}director-desk${path.sep}`)) return 'director-desk';
          return undefined;
        },
      },
    },
    // vendor-antd 和 vendor-3d 属于刻意拆出的稳定大块，不再把它们误报为入口过大。
    chunkSizeWarningLimit: 900,
  },
});

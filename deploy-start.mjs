// 部署用启动脚本：在 Node 进程内读取 PORT 环境变量（避免 shell 中 $PORT 未展开的问题），
// 先构建再启动 vite preview，绑定 0.0.0.0 与注入的端口，供沙箱单端口反向代理访问。
import { build, preview } from 'vite';

const port = Number(process.env.PORT) || 3000;

async function main() {
  console.log('[deploy] building project...');
  await build();
  console.log(`[deploy] starting preview on 0.0.0.0:${port}`);
  const server = await preview({
    preview: {
      host: '0.0.0.0',
      port,
      strictPort: false,
      allowedHosts: true,
    },
  });
  server.printUrls();
}

main().catch((err) => {
  console.error('[deploy] failed to start:', err);
  process.exit(1);
});

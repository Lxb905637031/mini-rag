import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // 说明：监听地址由 dev 脚本的 --host 0.0.0.0 控制（见 package.json），
    // 局域网设备才能访问；这里不重复配置。
    // 开发代理：浏览器请求 /api/xxx 时，由 Vite 转发到本机 3001 端口的 API。
    // 这样做的好处：
    //   1. 前端代码不用写死后端 IP，换个网络环境也不用改代码；
    //   2. 对浏览器而言请求始终是同源的（都是 5173），不会触发跨域限制；
    //   3. 手机访问时，/api 会自动指向「手机所连的这台电脑」，不会再误指到手机自己。
    proxy: {
      '/api': {
        // 目标：本机运行的 NestJS API 服务。
        target: 'http://127.0.0.1:3001',
        // 把请求头里的 Host 改成目标地址，避免后端按 Host 做校验时拒绝。
        changeOrigin: true,
        // 去掉 /api 前缀：后端路由本身没有这个前缀（如 /auth/login、/knowledge-bases）。
        rewrite: path => path.replace(/^\/api/, ''),
      },
    },
  },
})

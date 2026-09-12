import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installCopyrightGuard } from './lib/copyright'
import { AdminProvider } from './context/AdminContext'

// 版权保护：禁用右键菜单 / 图片拖拽 / Ctrl+S（需在 React 挂载前装好，覆盖整页）
installCopyrightGuard()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* 作者 / 访客模式：全站唯一来源，工作室 + 木马 + Green OS 共用同一开关 */}
    <AdminProvider>
      <App />
    </AdminProvider>
  </StrictMode>,
)

import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import TarotShowcase from './pages/TarotShowcase'
import './index.css'

// 管理端独立 chunk:普通用户不加载
const AdminApp = lazy(() => import('./pages/admin/AdminApp'))
// 洗牌预览页(/lab/shuffle):本地改动画时用,文件不进 git。
// 走 glob 而不是直接 import —— 线上没有这个文件时 glob 返回空对象,构建照常过。
const labModules = import.meta.glob('./pages/ShuffleLab.tsx')
const labEntry = labModules['./pages/ShuffleLab.tsx'] as
  | (() => Promise<{ default: React.ComponentType }>)
  | undefined
const ShuffleLab = labEntry ? lazy(labEntry) : null

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/showcase" element={<TarotShowcase />} />
          {ShuffleLab && (
            <Route
              path="/lab/shuffle"
              element={
                <Suspense fallback={<div style={{ color: '#888', padding: '2rem' }}>加载中…</div>}>
                  <ShuffleLab />
                </Suspense>
              }
            />
          )}
          <Route
            path="/admin"
            element={
              <Suspense fallback={<div style={{ color: '#888', padding: '2rem' }}>加载中…</div>}>
                <AdminApp />
              </Suspense>
            }
          />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)

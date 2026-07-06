import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App'
import TarotShowcase from './pages/TarotShowcase'
import './index.css'

// 管理端独立 chunk:普通用户不加载
const AdminApp = lazy(() => import('./pages/admin/AdminApp'))

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/showcase" element={<TarotShowcase />} />
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
  </React.StrictMode>,
)

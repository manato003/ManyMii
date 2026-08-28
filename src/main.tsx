import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'

// App の外側に置く。App 自身が保存データの読み込みで落ちるため、
// 内側に置くと捕まえられない
const locale = localStorage.getItem('locale') === 'en' ? 'en' : 'ja'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary locale={locale}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

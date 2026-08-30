import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'
import { readEventLog, formatEventLog, clearEventLog } from './utils/eventLog'

// App の外側に置く。App 自身が保存データの読み込みで落ちるため、
// 内側に置くと捕まえられない
const locale = localStorage.getItem('locale') === 'en' ? 'en' : 'ja'

// 観測ログの取り出し口。devtools で manymiiLog() と打つと読める。
// 「配信が続いているのに終了表示になる」原因を特定したら、
// utils/eventLog.ts ごと削除する（docs/SPEC.md「観測ログ」を参照）
declare global {
  interface Window {
    manymiiLog: () => string
    manymiiLogClear: () => void
  }
}
window.manymiiLog = () => formatEventLog(readEventLog())
window.manymiiLogClear = clearEventLog

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary locale={locale}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

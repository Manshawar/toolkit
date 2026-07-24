import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Shell } from '@web/components/shell'
import { BenchPage } from '@web/pages/bench'
import { HomePage } from '@web/pages/home'
import { ReportGeneratePage } from '@web/pages/report/generate'
import { ReportHistoryEditPage } from '@web/pages/report/history-edit'
import { ReportHistoryListPage } from '@web/pages/report/history-list'
import { ReportOverviewPage } from '@web/pages/report/overview'
import { ReportPrefsPage } from '@web/pages/report/prefs'
import { ReportRosterPage } from '@web/pages/report/roster'
import { SettingPage } from '@web/pages/setting'
import { UsagePage } from '@web/pages/usage'

export function App() {
  return (
    <BrowserRouter>
      <Shell>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/report" element={<ReportOverviewPage />} />
          <Route path="/report/generate" element={<ReportGeneratePage />} />
          <Route path="/report/history" element={<ReportHistoryListPage />} />
          <Route path="/report/history/:date" element={<ReportHistoryEditPage />} />
          <Route path="/report/roster" element={<ReportRosterPage />} />
          <Route path="/report/prefs" element={<ReportPrefsPage />} />
          <Route path="/usage" element={<UsagePage />} />
          <Route path="/bench" element={<BenchPage />} />
          <Route path="/setting" element={<SettingPage />} />
          <Route path="*" element={<HomePage />} />
        </Routes>
      </Shell>
    </BrowserRouter>
  )
}

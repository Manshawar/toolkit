import Router from 'preact-router'
import { useState } from 'preact/hooks'
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
  const [path, setPath] = useState(typeof location !== 'undefined' ? location.pathname : '/')

  return (
    <Shell path={path}>
      <Router onChange={(e) => setPath(e.url.split('?')[0] || '/')}>
        <HomePage path="/" />
        <ReportOverviewPage path="/report" />
        <ReportGeneratePage path="/report/generate" />
        <ReportHistoryListPage path="/report/history" />
        <ReportHistoryEditPage path="/report/history/:date" />
        <ReportRosterPage path="/report/roster" />
        <ReportPrefsPage path="/report/prefs" />
        <UsagePage path="/usage" />
        <BenchPage path="/bench" />
        <SettingPage path="/setting" />
      </Router>
    </Shell>
  )
}

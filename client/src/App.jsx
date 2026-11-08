import { AlertTriangle } from 'lucide-react';
import { AppProvider, useApp } from './state.jsx';
import { Sidebar, MobileNav, TopBar, Toast } from './components/Layout.jsx';
import ConfirmModal from './components/ConfirmModal.jsx';
import { Dashboard, Assistant, Accounts, Transactions, Forecast, Scenarios } from './pages/pages.jsx';

const PAGES = { dashboard: Dashboard, assistant: Assistant, accounts: Accounts, transactions: Transactions, forecast: Forecast, scenarios: Scenarios };

function Shell() {
  const { page, overview, loadError, refresh } = useApp();
  const Page = PAGES[page] || Dashboard;
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="min-w-0 flex-1 px-4 pb-24 pt-6 sm:px-6 lg:px-8 lg:pb-10">
        <div className="mx-auto max-w-[1400px] space-y-6">
          <TopBar />
          {loadError && !overview ? (
            <div className="card card-pad flex items-start gap-3">
              <AlertTriangle className="text-clay-deep" />
              <div>
                <p className="font-semibold">Can't reach the MoneyCall server.</p>
                <p className="text-sm text-forest/70">{loadError}. Start it with <code className="rounded bg-cream-200 px-1">cd server &amp;&amp; npm run dev</code>.</p>
                <button onClick={refresh} className="btn-primary mt-3">Try again</button>
              </div>
            </div>
          ) : !overview ? (
            <div className="grid gap-5 lg:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="card h-48 animate-pulse" />)}</div>
          ) : (
            <Page />
          )}
        </div>
      </main>
      <MobileNav />
      <ConfirmModal />
      <Toast />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}

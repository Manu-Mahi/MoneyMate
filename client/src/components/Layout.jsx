import { useEffect } from 'react';
import { LayoutDashboard, Wallet, ReceiptText, MessageCircle, LineChart, Bookmark, RotateCcw, Phone, CheckCircle2, Mic } from 'lucide-react';
import { useApp } from '../state.jsx';

export const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'accounts', label: 'Accounts', icon: Wallet },
  { id: 'transactions', label: 'Transactions', icon: ReceiptText },
  { id: 'assistant', label: 'AI Banking Assistant', icon: MessageCircle },
  { id: 'forecast', label: 'Forecast & What-If', icon: LineChart },
  { id: 'scenarios', label: 'Saved Scenarios', icon: Bookmark },
];

function Dot({ on, label, detail }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="flex items-center gap-1.5 text-cream/70"><span className={`h-1.5 w-1.5 rounded-full ${on ? 'bg-sage' : 'bg-cream/30'}`} />{label}</span>
      <span className="text-cream/45">{detail}</span>
    </div>
  );
}

export function Sidebar() {
  const { page, setPage, status, overview } = useApp();
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-forest px-4 py-6 text-cream lg:flex">
      <div className="flex items-center gap-2.5 px-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-gold text-forest"><Phone size={17} /></span>
        <div>
          <div className="font-display text-xl font-semibold leading-none">MoneyCall</div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-gold/80">Thinks before you spend</div>
        </div>
      </div>
      <nav className="mt-8 space-y-1" aria-label="Main">
        {NAV.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setPage(id)} aria-current={page === id ? 'page' : undefined}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${page === id ? 'bg-cream text-forest' : 'text-cream/75 hover:bg-forest-700 hover:text-cream'}`}>
            <Icon size={17} />{label}
          </button>
        ))}
      </nav>
      <div className="mt-auto space-y-3">
        <div className="rounded-xl bg-forest-700 p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-gold/80">Connected services</div>
          <div className="space-y-1.5">
            <Dot on={status?.gemini} label="Gemini AI" detail={status?.gemini ? 'live' : 'local engine'} />
            <Dot on={overview?.source === 'nessie'} label="Capital One Nessie" detail={overview?.source === 'nessie' ? 'live' : 'synthetic'} />
            <Dot on={status?.store === 'mongo'} label="MongoDB Atlas" detail={status?.store === 'mongo' ? 'live' : 'memory'} />
            <Dot on={status?.photon} label="Photon texts & calls" detail={status?.photon ? (status?.photonWebhook ? 'live' : 'no webhook') : 'off'} />
            <Dot on label="Voice" detail="browser" />
          </div>
        </div>
        <span className="chip bg-gold text-forest">Demo Banking · synthetic data</span>
      </div>
    </aside>
  );
}

export function MobileNav() {
  const { page, setPage } = useApp();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-cream-300 bg-cream/95 px-2 py-1.5 backdrop-blur lg:hidden" aria-label="Main">
      {NAV.map(({ id, label, icon: Icon }) => (
        <button key={id} onClick={() => setPage(id)} className={`flex flex-col items-center gap-0.5 rounded-lg px-2 py-1 text-[10px] ${page === id ? 'text-sage' : 'text-forest/60'}`} aria-label={label}>
          <Icon size={19} />{label.split(' ')[0]}
        </button>
      ))}
    </nav>
  );
}

export function TopBar() {
  const { overview, resetDemo, setPage, speech, page } = useApp();
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-xs text-forest/55">{overview?.user?.id} · {overview?.user?.email}</p>
        <h1 className="font-display text-2xl font-semibold sm:text-3xl">{greet}, {overview?.user?.name?.split(' ')[0] || 'there'}</h1>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={resetDemo} className="btn-ghost text-xs" title="Restore demo balances"><RotateCcw size={14} />Reset demo</button>
        {speech.supported && page !== 'assistant' && (
          <button onClick={() => { setPage('assistant'); setTimeout(speech.start, 150); }} className="btn-primary"><Mic size={16} />Talk to MoneyCall</button>
        )}
      </div>
    </header>
  );
}

export function Toast() {
  const { toast, setToast } = useApp();
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast, setToast]);
  if (!toast) return null;
  return (
    <div className="rise fixed bottom-20 right-4 z-50 flex max-w-sm items-start gap-2 rounded-2xl bg-forest px-4 py-3 text-sm text-cream shadow-2xl lg:bottom-6" role="status">
      <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-gold" />{toast.text}
    </div>
  );
}

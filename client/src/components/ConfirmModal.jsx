import { useEffect, useState } from 'react';
import { ShieldCheck, ArrowRight, Clock, AlertTriangle, Mic } from 'lucide-react';
import { useApp } from '../state.jsx';
import { money, shortDate, RISK } from '../lib/format.js';

export default function ConfirmModal() {
  const { pending, confirmPending, cancelPending, busy, speech } = useApp();
  const [left, setLeft] = useState(0);

  useEffect(() => {
    if (!pending) return undefined;
    const tick = () => setLeft(Math.max(0, Math.round((new Date(pending.expiresAt) - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [pending]);

  useEffect(() => {
    if (!pending) return undefined;
    const onKey = (e) => e.key === 'Escape' && cancelPending();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, cancelPending]);

  if (!pending) return null;
  const s = pending.summary || {};
  const risk = RISK[s.riskLevel || 'low'];
  const expired = left === 0;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-forest/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="rise w-full max-w-md rounded-3xl bg-cream p-6 shadow-2xl">
        <div className="flex items-center gap-2 text-sage"><ShieldCheck size={18} /><span className="eyebrow !text-sage">Confirm simulated transfer</span></div>
        <h2 id="confirm-title" className="mt-2 font-display text-3xl font-semibold num">{money(pending.amount)}</h2>

        <div className="mt-4 flex items-center gap-3 rounded-2xl bg-white p-4">
          <div className="min-w-0 flex-1">
            <div className="eyebrow">From</div>
            <div className="truncate font-semibold">{s.from?.nickname}</div>
            <div className="text-xs text-forest/60">•••• {s.from?.mask} · after: <span className="num font-medium">{money(s.impacts?.fromAfter)}</span></div>
          </div>
          <ArrowRight className="shrink-0 text-sage" size={18} />
          <div className="min-w-0 flex-1 text-right">
            <div className="eyebrow">To</div>
            <div className="truncate font-semibold">{s.to?.nickname}</div>
            <div className="text-xs text-forest/60">•••• {s.to?.mask} · after: <span className="num font-medium">{money(s.impacts?.toAfter)}</span></div>
          </div>
        </div>

        <div className={`mt-3 rounded-2xl px-4 py-3 text-sm ${s.riskLevel === 'high' ? 'bg-clay-soft' : s.riskLevel === 'medium' ? 'bg-gold-soft' : 'bg-sage-soft'}`}>
          <div className="flex items-center justify-between">
            <span className="font-semibold">Projected impact</span>
            <span className={`chip ${risk.cls}`}>{risk.label}</span>
          </div>
          <p className="mt-1 text-forest/80">
            Lowest checking balance: <span className="num font-semibold">{money(s.lowest?.balance)}</span> on {shortDate(s.lowest?.date)}.
          </p>
          {s.riskLevel !== 'low' && <p className="mt-1 flex items-start gap-1.5 text-clay-deep"><AlertTriangle size={14} className="mt-0.5" />{s.headline}</p>}
        </div>

        <div className="mt-3 flex items-center gap-1.5 text-xs text-forest/55">
          <Clock size={13} /> {expired ? 'This confirmation expired.' : `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`} · Synthetic demo funds only
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button onClick={cancelPending} className="btn-outline" disabled={busy}>Cancel</button>
          <button onClick={confirmPending} className="btn-primary" disabled={busy || expired} autoFocus>
            {busy ? 'Moving…' : `Confirm ${money(pending.amount)}`}
          </button>
        </div>
        {speech.supported ? (
          <button onClick={speech.listening ? speech.stop : speech.start} className={`btn-ghost mx-auto mt-3 flex text-xs ${speech.listening ? 'text-clay-deep' : ''}`}>
            <Mic size={14} />{speech.listening ? 'Listening… say “confirm” or “cancel”' : 'Or say “confirm” / “cancel”'}
          </button>
        ) : (
          <p className="mt-3 text-center text-[11px] text-forest/50">You can also type “confirm” or “cancel”.</p>
        )}
      </div>
    </div>
  );
}

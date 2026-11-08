import { useEffect, useRef, useState } from 'react';
import { MessageSquareText, PhoneCall, Send, Smartphone } from 'lucide-react';
import { useApp } from '../state.jsx';
import { api } from '../lib/api.js';
import { money } from '../lib/format.js';

// Text & phone banking. The same backend endpoint Photon's webhook feeds
// (POST /api/channels/message) is exposed here as a demo phone, so the
// iMessage/SMS flow (preview → "YES" → executed) can be shown without a
// provisioned line. Replies on this channel ask for YES/NO instead of a button.

const DEMO_HANDLE = '+1 555 010 0199';

function Bubble({ m }) {
  const mine = m.role === 'user';
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-snug ${mine ? 'rounded-br-md bg-sage text-cream' : m.executed ? 'rounded-bl-md bg-gold-soft text-forest' : 'rounded-bl-md bg-white text-forest shadow-sm'}`}>
        {m.text}
      </div>
    </div>
  );
}

export default function ChannelCard({ compact = false }) {
  const { status, refresh, notify } = useApp();
  const [thread, setThread] = useState([{ role: 'assistant', text: 'Text MoneyCall like you would from your phone. Try "balance" or "move $300 to savings". Transfers are confirmed with your PIN (or YES when no PIN is set).' }]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState([]);
  const listRef = useRef(null);

  useEffect(() => {
    api.channelActivity().then((r) => setActivity(r.events || [])).catch(() => {});
  }, [thread.length]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [thread, busy]);

  const send = async (e) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setText('');
    setThread((m) => [...m, { role: 'user', text: t }]);
    setBusy(true);
    try {
      const r = await api.channelMessage({ channel: 'sms-demo', handle: DEMO_HANDLE, text: t });
      let reply = r.reply;
      if (r.confirmInstruction && r.engine !== 'confirm') reply += ` ${r.confirmInstruction}`;
      setThread((m) => [...m, { role: 'assistant', text: reply, executed: r.executed }]);
      if (r.executed) {
        await refresh();
        notify(`Confirmed by text: ${money(r.pending?.amount)} moved`);
      }
    } catch (err) {
      setThread((m) => [...m, { role: 'assistant', text: `Error: ${err.message}` }]);
    } finally {
      setBusy(false);
    }
  };

  const live = status?.photon;
  return (
    <section className="card card-pad" aria-label="Text and phone banking">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Smartphone size={16} className="text-sage" />
            <h2 className="font-display text-lg font-semibold">Text & phone banking</h2>
          </div>
          <p className="text-xs text-forest/60">iMessage, SMS and calls through Photon. Same brain, same two-step confirm: reply YES.</p>
        </div>
        <span className={`chip ${live ? 'bg-sage-soft text-sage' : 'bg-cream-200 text-forest/60'}`}>
          <MessageSquareText size={12} />Photon {live ? (status?.photonWebhook ? 'live' : 'key set · no webhook') : 'not connected'}
        </span>
      </div>

      <div className="mt-3 rounded-2xl border border-cream-300 bg-cream-200/60 p-3">
        <div className="mb-2 flex items-center justify-between text-[11px] text-forest/55">
          <span className="flex items-center gap-1"><Smartphone size={12} />Demo phone · {DEMO_HANDLE}</span>
          <span>{live ? 'Real texts to your Photon line land in the audit trail below' : 'Simulates an incoming text'}</span>
        </div>
        <div ref={listRef} className="scrollbar-thin space-y-2 overflow-y-auto pr-1" style={{ maxHeight: compact ? 180 : 240 }}>
          {thread.map((m, i) => <Bubble key={i} m={m} />)}
          {busy && <div className="text-[11px] text-forest/50">MoneyCall is typing…</div>}
        </div>
        <form onSubmit={send} className="mt-2 flex items-center gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} className="input !rounded-full !py-2 text-sm" placeholder="Text MoneyCall…" aria-label="Text message" />
          <button type="submit" disabled={busy || !text.trim()} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-forest text-gold disabled:opacity-40" aria-label="Send text"><Send size={15} /></button>
        </form>
      </div>

      {!compact && (
        <div className="mt-3">
          <div className="eyebrow">Recent texts & calls</div>
          {activity.length === 0 ? (
            <p className="mt-1 text-xs text-forest/55">
              {live ? 'Nothing yet. Text your Photon number to start.' : 'Connect Photon (PHOTON_PROJECT_ID, PHOTON_API_KEY, then `npm run photon:setup`) to see real texts and calls here.'}
            </p>
          ) : (
            <ul className="mt-1 divide-y divide-cream-200">
              {activity.slice(0, 6).map((e) => (
                <li key={e._id} className="flex items-start gap-2 py-2 text-xs">
                  <span className="mt-0.5 text-forest/50">{e.channel === 'voice' ? <PhoneCall size={13} /> : <MessageSquareText size={13} />}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate"><span className="font-semibold">{e.handle || e.channel}</span> <span className="text-forest/60">· {e.channel}</span></div>
                    <div className="truncate text-forest/75">{e.text}</div>
                    {e.reply && <div className="truncate text-forest/55">↳ {e.reply}</div>}
                  </div>
                  <span className={`chip !py-0 text-[10px] ${e.status === 'replied' || e.status === 'logged' ? 'bg-sage-soft text-sage' : e.status === 'failed' ? 'bg-clay-soft text-clay-deep' : 'bg-cream-200 text-forest/60'}`}>{e.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

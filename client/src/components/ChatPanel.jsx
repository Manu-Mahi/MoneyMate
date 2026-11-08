import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Send, Volume2, VolumeX, Sparkles, ArrowRightLeft, Cpu } from 'lucide-react';
import { useApp } from '../state.jsx';
import { RISK, money } from '../lib/format.js';

const SUGGESTIONS = [
  'How much money do I have?',
  'Transfer $1,000 to my savings',
  'What if I transfer only $300?',
  'How much can I safely spend before payday?',
  'How healthy are my finances?',
  'Can I afford a $600 laptop?',
  'What bills are coming up?',
];

function Bubble({ m, onShow }) {
  const mine = m.role === 'user';
  return (
    <div className={`rise flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${mine ? 'rounded-br-md bg-forest text-cream' : m.error ? 'rounded-bl-md bg-clay-soft text-forest' : m.executed ? 'rounded-bl-md bg-sage-soft text-forest' : 'rounded-bl-md bg-cream-200 text-forest'}`}>
        {m.text}
        {m.scenarios?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {m.scenarios.map((s) => (
              <button key={s.id} onClick={() => onShow(m.scenarios)} className={`chip ${RISK[s.riskLevel].cls} hover:ring-1 hover:ring-forest/20`}>
                <ArrowRightLeft size={12} />{money(s.amount)} · {RISK[s.riskLevel].label}
              </button>
            ))}
          </div>
        )}
        {m.engine && (
          <div className="mt-1.5 flex items-center gap-1 text-[10px] uppercase tracking-wider text-forest/45">
            {m.engine === 'gemini' ? <Sparkles size={10} /> : <Cpu size={10} />}
            {m.engine === 'gemini' ? 'Gemini' : 'Local engine'}{m.tools?.length ? ` · ${[...new Set(m.tools)].join(', ')}` : ''}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChatPanel({ tall = false }) {
  const { messages, send, busy, speech, voiceReplies, setVoiceReplies, showScenarios, pending } = useApp();
  const [text, setText] = useState('');
  const listRef = useRef(null);

  // Scroll only the message list, never the page.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, busy, speech.interim]);

  const submit = (e) => {
    e?.preventDefault();
    if (!text.trim() || busy) return;
    send(text);
    setText('');
  };

  return (
    <section className="card flex flex-col overflow-hidden" style={{ height: tall ? 'calc(100vh - 150px)' : 560 }} aria-label="AI banking assistant">
      <header className="flex items-center justify-between border-b border-cream-200 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-forest text-gold"><Sparkles size={15} /></span>
          <div>
            <h2 className="font-display text-base font-semibold leading-tight">AI Banking Conversation</h2>
            <p className="text-[11px] text-forest/55">Voice or text · previews before anything moves</p>
          </div>
        </div>
        <button onClick={() => setVoiceReplies(!voiceReplies)} className="btn-ghost !p-2" title={voiceReplies ? 'Mute spoken replies' : 'Speak replies aloud'} aria-label="Toggle spoken replies">
          {voiceReplies ? <Volume2 size={17} /> : <VolumeX size={17} />}
        </button>
      </header>

      <div ref={listRef} className="scrollbar-thin flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
        {messages.map((m, i) => <Bubble key={i} m={m} onShow={(list) => showScenarios(list)} />)}
        {busy && (
          <div className="flex items-center gap-1.5 px-1 text-xs text-forest/50">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sage" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sage [animation-delay:120ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sage [animation-delay:240ms]" />
            <span className="ml-1">Checking your accounts and running the numbers…</span>
          </div>
        )}
        {speech.interim && <div className="text-right text-sm italic text-forest/50">“{speech.interim}”</div>}
      </div>

      <div className="border-t border-cream-200 px-4 pb-4 pt-3">
        <div className="scrollbar-thin -mx-1 mb-2.5 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => send(s)} disabled={busy} className="chip shrink-0 border border-cream-300 bg-white text-forest/75 hover:border-sage hover:text-forest">{s}</button>
          ))}
        </div>
        {pending && <p className="mb-2 text-xs font-medium text-clay-deep">A transfer is waiting. Say “confirm” or “cancel”.</p>}
        {speech.error && <p className="mb-2 text-xs text-clay-deep">{speech.error}</p>}
        <form onSubmit={submit} className="flex items-center gap-2">
          {speech.supported && (
            <button type="button" onClick={speech.listening ? speech.stop : speech.start}
              className={`grid h-11 w-11 shrink-0 place-items-center rounded-full transition ${speech.listening ? 'listening bg-clay text-white' : 'bg-forest text-gold hover:bg-forest-700'}`}
              aria-label={speech.listening ? 'Stop listening' : 'Speak to Chatter Bank'} title={speech.listening ? 'Listening… tap to stop' : 'Tap and speak'}>
              {speech.listening ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
          )}
          <input value={text} onChange={(e) => setText(e.target.value)} className="input !rounded-full !py-3"
            placeholder={speech.listening ? 'Listening…' : 'Ask or tell Chatter Bank what you want to do'} aria-label="Message" />
          <button type="submit" disabled={busy || !text.trim()} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-sage text-cream hover:bg-forest disabled:opacity-40" aria-label="Send">
            <Send size={17} />
          </button>
        </form>
        {!speech.supported && <p className="mt-2 text-[11px] text-forest/50">Voice input needs Chrome or Edge. Typing works everywhere.</p>}
      </div>
    </section>
  );
}

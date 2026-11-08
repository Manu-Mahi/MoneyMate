import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './lib/api.js';
import { useSpeech } from './hooks/useSpeech.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

const YES = /^(yes|yeah|yep|confirm|confirmed|do it|go ahead|approve|okay confirm|ok confirm)\b/i;
const NO = /^(no|nope|cancel|stop|don't|do not|never mind|nevermind)\b/i;

const WELCOME = {
  role: 'assistant',
  text: "Hi Alex, I'm MoneyCall. Ask me anything about your money, or tell me what you want to do and I'll show you what happens next, before it happens.",
};

export function AppProvider({ children }) {
  const [page, setPage] = useState('dashboard');
  const [overview, setOverview] = useState(null);
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [messages, setMessages] = useState([WELCOME]);
  const [conversationId, setConversationId] = useState(null);
  const [scenarios, setScenarios] = useState([]);
  const [compared, setCompared] = useState(false);
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [voiceReplies, setVoiceReplies] = useState(true);
  const [toast, setToast] = useState(null);
  const pendingRef = useRef(null);
  pendingRef.current = pending;

  const notify = useCallback((text, tone = 'good') => {
    setToast({ text, tone, id: Date.now() });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [o, s] = await Promise.all([api.overview(), api.status()]);
      setOverview(o);
      setStatus(s);
      setLoadError(null);
    } catch (e) {
      setLoadError(e.message);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const speechRef = useRef(null);
  const say = useCallback((text) => {
    if (voiceReplies) speechRef.current?.speak(text);
  }, [voiceReplies]);

  const pushAssistant = useCallback((msg) => {
    setMessages((m) => [...m, { role: 'assistant', ...msg }]);
    say(msg.text);
  }, [say]);

  const confirmPending = useCallback(async () => {
    const p = pendingRef.current;
    if (!p) return;
    setBusy(true);
    try {
      const r = await api.confirm(p._id);
      setOverview(r.overview);
      setPending(null);
      setScenarios([]); // the chart now shows the real, updated forecast
      pushAssistant({ text: r.message, executed: true });
      notify(r.message);
    } catch (e) {
      setPending(null);
      pushAssistant({ text: e.message, error: true });
    } finally {
      setBusy(false);
    }
  }, [pushAssistant, notify]);

  const cancelPending = useCallback(async () => {
    const p = pendingRef.current;
    if (!p) return;
    setPending(null);
    try { await api.cancel(p._id); } catch { /* already gone */ }
    pushAssistant({ text: 'Cancelled. Nothing was moved.' });
  }, [pushAssistant]);

  const send = useCallback(async (raw) => {
    const text = String(raw || '').trim();
    if (!text) return;
    // Voice or typed confirmation while a transfer is waiting.
    if (pendingRef.current) {
      if (YES.test(text)) {
        setMessages((m) => [...m, { role: 'user', text }]);
        return confirmPending();
      }
      if (NO.test(text)) {
        setMessages((m) => [...m, { role: 'user', text }]);
        return cancelPending();
      }
    }
    setMessages((m) => [...m, { role: 'user', text }]);
    setBusy(true);
    try {
      const r = await api.chat(text, conversationId);
      setConversationId(r.conversationId);
      if (r.ui?.scenarios?.length) {
        setScenarios(r.ui.scenarios);
        setCompared(Boolean(r.ui.compared));
      }
      if (r.ui?.pending) setPending(r.ui.pending);
      pushAssistant({ text: r.reply, scenarios: r.ui?.scenarios || [], pending: r.ui?.pending, engine: r.engine, note: r.note, tools: r.tools });
    } catch (e) {
      pushAssistant({ text: `Sorry, something went wrong: ${e.message}`, error: true });
    } finally {
      setBusy(false);
    }
  }, [conversationId, confirmPending, cancelPending, pushAssistant]);

  const speech = useSpeech({ onFinal: (t) => send(t) });
  speechRef.current = speech;

  const showScenarios = useCallback((list, isCompare = list.length > 1) => {
    setScenarios(list);
    setCompared(isCompare);
  }, []);

  const resetDemo = useCallback(async () => {
    const o = await api.reset();
    setOverview(o);
    setMessages([WELCOME]);
    setConversationId(null);
    setScenarios([]);
    setPending(null);
    notify('Demo data restored');
  }, [notify]);

  const value = useMemo(() => ({
    page, setPage, overview, status, loadError, refresh,
    messages, send, busy, scenarios, compared, showScenarios, setScenarios,
    pending, setPending, confirmPending, cancelPending,
    speech, voiceReplies, setVoiceReplies, toast, setToast, notify, resetDemo,
  }), [page, overview, status, loadError, refresh, messages, send, busy, scenarios, compared, showScenarios,
    pending, confirmPending, cancelPending, speech, voiceReplies, toast, notify, resetDemo]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

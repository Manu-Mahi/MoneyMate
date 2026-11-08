import { useCallback, useEffect, useRef, useState } from 'react';

// Browser Web Speech API: microphone input + spoken replies.
export function useSpeech({ onFinal } = {}) {
  const Recognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  const supported = Boolean(Recognition);
  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState(null);
  const recRef = useRef(null);
  const finalRef = useRef(onFinal);
  finalRef.current = onFinal;

  useEffect(() => {
    if (!supported) return undefined;
    const rec = new Recognition();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      let text = '';
      let isFinal = false;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
        if (e.results[i].isFinal) isFinal = true;
      }
      setInterim(text);
      if (isFinal) {
        setInterim('');
        finalRef.current?.(text.trim());
      }
    };
    rec.onerror = (e) => {
      setError(e.error === 'not-allowed' ? 'Microphone permission was blocked.' : e.error === 'no-speech' ? null : `Voice error: ${e.error}`);
      setListening(false);
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    return () => rec.abort();
  }, [supported, Recognition]);

  const start = useCallback(() => {
    if (!recRef.current) return;
    setError(null);
    if (ttsSupported) window.speechSynthesis.cancel();
    try {
      recRef.current.start();
      setListening(true);
    } catch {
      /* already started */
    }
  }, [ttsSupported]);

  const stop = useCallback(() => {
    recRef.current?.stop();
    setListening(false);
  }, []);

  const speak = useCallback((text) => {
    if (!ttsSupported || !text) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/−/g, 'minus ').replace(/→/g, 'to'));
    u.rate = 1.04;
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find((v) => /en-US/.test(v.lang) && /Samantha|Google US|Jenny|Aria/i.test(v.name)) || voices.find((v) => /en-US/.test(v.lang));
    if (preferred) u.voice = preferred;
    window.speechSynthesis.speak(u);
  }, [ttsSupported]);

  return { supported, ttsSupported, listening, interim, error, start, stop, speak };
}

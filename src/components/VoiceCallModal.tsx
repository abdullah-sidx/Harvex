import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Language, UserFarmProfile, SensorData } from '../types';

// ── Environment Configuration ────────────────────────────────────────────────
const SARVAM_API_KEY = (import.meta as any).env?.VITE_SARVAM_API_KEY ?? '';
const BACKEND_URL = ((import.meta as any).env?.VITE_BACKEND_URL ?? 'http://localhost:8000').replace(/\/$/, '');

interface VoiceCallModalProps {
  language: Language;
  isOpen: boolean;
  onClose: () => void;
  farmProfile: UserFarmProfile;
  sensorData: SensorData;
}

// ── Strict 3-State Machine ────────────────────────────────────────────────────
type VoiceState = 'IDLE' | 'RECORDING' | 'SENDING';

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  audioBase64?: string;
  timestamp: string;
}

export const VoiceCallModal: React.FC<VoiceCallModalProps> = ({
  language: initialLanguage,
  isOpen,
  onClose,
}) => {
  const [currentLanguage, setCurrentLanguage] = useState<Language>(initialLanguage);
  const isHi = currentLanguage === 'hi';

  const [state, setState] = useState<VoiceState>('IDLE');
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: 'welcome',
      sender: 'assistant',
      text: initialLanguage === 'hi'
        ? 'नमस्ते किसान साथी! बोलने के लिए माइक बटन दबाकर रखें, बोलते ही छोड़ दें।'
        : 'Hello! Hold the mic button below to speak your question, release to send.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);

  // ── References ─────────────────────────────────────────────────────────────
  const mediaRecorderRef     = useRef<MediaRecorder | null>(null);
  const micStreamRef         = useRef<MediaStream | null>(null);
  const audioChunksRef       = useRef<Blob[]>([]);
  const recordingTimerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartRef    = useRef<number>(0);
  const isPointerDownRef     = useRef<boolean>(false);
  const activeAudioRef       = useRef<HTMLAudioElement | null>(null);
  const messagesEndRef       = useRef<HTMLDivElement | null>(null);

  // Sync language with prop when modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentLanguage(initialLanguage);
    }
  }, [isOpen, initialLanguage]);

  // Auto-scroll chat to latest message
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, state, isOpen]);

  // ── Exact Audio Playback Implementation as Requested ───────────────────────
  const playAudioBase64 = useCallback((base64: string) => {
    if (!base64 || base64.trim().length < 50) return;

    try {
      if (activeAudioRef.current) {
        activeAudioRef.current.pause();
        activeAudioRef.current = null;
      }

      const audioBytes = Uint8Array.from(atob(base64.trim()), (c) => c.charCodeAt(0));
      const blob = new Blob([audioBytes], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      activeAudioRef.current = audio;

      audio.play().catch((err) => {
        console.warn('[Audio] play() blocked or failed:', err);
      });

      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (activeAudioRef.current === audio) {
          activeAudioRef.current = null;
        }
      };
    } catch (err) {
      console.error('[Audio] Decoding error:', err);
    }
  }, []);

  // ── Send Audio Blob to Sarvam STT & Backend ────────────────────────────────
  const processAndSendRecording = async (audioBlob: Blob) => {
    setState('SENDING');
    const langCode = currentLanguage === 'hi' ? 'hi-IN' : 'en-IN';

    try {
      // 1. Transcribe via Sarvam AI STT
      const cleanBlob = new Blob([audioBlob], { type: 'audio/webm' });
      const formData = new FormData();
      formData.append('file', cleanBlob, 'voice_note.webm');
      formData.append('language_code', langCode);

      console.log(`[STT] Sending ${(cleanBlob.size / 1024).toFixed(1)} KB to Sarvam STT...`);
      const sttRes = await fetch('https://api.sarvam.ai/speech-to-text', {
        method: 'POST',
        headers: {
          'api-subscription-key': SARVAM_API_KEY,
        },
        body: formData,
      });

      if (!sttRes.ok) {
        const errText = await sttRes.text().catch(() => '');
        throw new Error(`Sarvam STT ${sttRes.status}: ${errText}`);
      }

      const sttData = await sttRes.json();
      const transcript = (sttData.transcript || '').trim();
      console.log('[STT] Transcript:', transcript);

      if (!transcript || transcript.length < 2) {
        setMessages((prev) => [
          ...prev.slice(-9),
          {
            id: `err-${Date.now()}`,
            sender: 'assistant',
            text: currentLanguage === 'hi'
              ? 'आवाज़ स्पष्ट नहीं थी, कृपया बटन दबाकर दोबारा बोलें।'
              : 'Could not understand clearly. Please hold the mic to try again.',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          },
        ]);
        setState('IDLE');
        return;
      }

      // 2. Add Farmer's Message to Chat (RIGHT)
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        sender: 'user',
        text: transcript,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev.slice(-9), userMsg]);

      // 3. Query Backend POST /api/voice-query
      let replyText = '';
      let replyAudioBase64: string | undefined = undefined;

      try {
        const backendRes = await fetch(`${BACKEND_URL}/api/voice-query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            device_id: 'harvex-node-1',
            transcript: transcript,
            language: langCode,
          }),
        });

        if (backendRes.ok) {
          const backendData = await backendRes.json();
          replyText = (backendData.response_text || '').trim();
          replyAudioBase64 = backendData.response_audio_base64 || undefined;
        } else {
          throw new Error(`Backend returned HTTP ${backendRes.status}`);
        }
      } catch (backendErr) {
        console.warn('[Backend] /api/voice-query error:', backendErr);
        replyText = currentLanguage === 'hi'
          ? 'सर्वर से उत्तर प्राप्त नहीं हो सका। कृपया पुनः प्रयास करें।'
          : 'Could not connect to server. Please try again.';
      }

      // 4. Add Assistant's Reply to Chat (LEFT)
      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        sender: 'assistant',
        text: replyText || (currentLanguage === 'hi' ? 'उत्तर प्राप्त हो गया।' : 'Response received.'),
        audioBase64: replyAudioBase64,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev.slice(-9), assistantMsg]);

      // 5. Play Reply Audio ONCE Automatically
      if (replyAudioBase64) {
        playAudioBase64(replyAudioBase64);
      }
    } catch (err: any) {
      console.error('[VoiceNote] Error:', err);
      setMessages((prev) => [
        ...prev.slice(-9),
        {
          id: `err-${Date.now()}`,
          sender: 'assistant',
          text: currentLanguage === 'hi'
            ? 'त्रुटि हुई। कृपया बटन दबाकर पुनः बोलें।'
            : 'Error processing voice note. Please try again.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      // 6. Return to IDLE state. Nothing happens automatically.
      setState('IDLE');
    }
  };

  // ── Start Recording (on Pointer Down) ──────────────────────────────────────
  const startRecording = async () => {
    try {
      // Pause any ongoing playback so user records in quiet
      if (activeAudioRef.current) {
        activeAudioRef.current.pause();
        activeAudioRef.current = null;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      let mimeType = 'audio/webm';
      if (typeof MediaRecorder !== 'undefined') {
        if (MediaRecorder.isTypeSupported('audio/webm')) mimeType = 'audio/webm';
        else if (MediaRecorder.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4';
        else if (MediaRecorder.isTypeSupported('audio/ogg')) mimeType = 'audio/ogg';
      }

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.start(100);
      recordingStartRef.current = Date.now();
      setState('RECORDING');
      setRecordingSeconds(0);

      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('[Mic] Failed to access microphone:', err);
      setState('IDLE');
      alert(isHi ? 'माइक्रोफ़ोन की अनुमति दें।' : 'Please allow microphone access.');
    }
  };

  // ── Stop Recording (on Pointer Up / Cancel) ────────────────────────────────
  const stopRecording = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    const duration = Date.now() - recordingStartRef.current;
    const recorder = mediaRecorderRef.current;

    if (!recorder || recorder.state === 'inactive') {
      setState('IDLE');
      return;
    }

    recorder.onstop = () => {
      // Release microphone tracks
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
      }
      mediaRecorderRef.current = null;

      // Ignore accidental taps under 500ms
      if (duration < 500) {
        console.log('[Mic] Hold was too short, ignored');
        setState('IDLE');
        return;
      }

      const chunks = audioChunksRef.current;
      if (chunks.length === 0) {
        setState('IDLE');
        return;
      }

      const audioBlob = new Blob(chunks, { type: 'audio/webm' });
      processAndSendRecording(audioBlob);
    };

    try {
      recorder.stop();
    } catch {
      setState('IDLE');
    }
  };

  // ── Pointer Handlers (Works for both Touch & Mouse) ────────────────────────
  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    if (state !== 'IDLE') return;
    isPointerDownRef.current = true;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    startRecording();
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    e.preventDefault();
    if (!isPointerDownRef.current) return;
    isPointerDownRef.current = false;
    try {
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {}
    stopRecording();
  };

  const handlePointerCancel = (e: React.PointerEvent) => {
    if (!isPointerDownRef.current) return;
    isPointerDownRef.current = false;
    try {
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {}
    stopRecording();
  };

  // ── Session Teardown on Modal Close ────────────────────────────────────────
  const cleanup = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current = null;
    }
    isPointerDownRef.current = false;
    setState('IDLE');
  }, []);

  useEffect(() => {
    if (!isOpen) {
      cleanup();
    }
    return () => {
      cleanup();
    };
  }, [isOpen, cleanup]);

  // ── Language Toggle Handler ────────────────────────────────────────────────
  const toggleLanguage = (lang: Language) => {
    if (currentLanguage === lang) return;
    setCurrentLanguage(lang);
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current = null;
    }
    setMessages((prev) => [
      ...prev.slice(-9),
      {
        id: `lang-${Date.now()}`,
        sender: 'assistant',
        text: lang === 'hi'
          ? 'भाषा हिंदी में बदली गई। बोलने के लिए माइक बटन दबाकर रखें।'
          : 'Language changed to English. Hold the mic button to speak.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
      <div className="w-full max-w-md bg-[#002114] border border-[#1b4332] text-white rounded-3xl flex flex-col h-[640px] max-h-[92vh] shadow-2xl relative overflow-hidden">

        {/* ── Top Bar ────────────────────────────────────────────────────── */}
        <div className="w-full flex items-center justify-between p-4 bg-[#00170d] border-b border-emerald-950 z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-emerald-700/60 border border-emerald-400/40 flex items-center justify-center shadow-md">
              <span className="material-symbols-outlined text-xl text-emerald-300">smart_toy</span>
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-wide">
                {isHi ? 'हार्वेक्स वॉयस चैट' : 'Harvex Voice Chat'}
              </h3>
              <p className="text-[11px] text-emerald-400 font-medium">
                {isHi ? 'व्हाट्सएप वॉयस नोट स्टाइल' : 'WhatsApp Voice Note Style'}
              </p>
            </div>
          </div>

          {/* Language Toggle & Close Button */}
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-white/10 p-0.5 rounded-full border border-emerald-500/30 text-xs">
              <button
                onClick={() => toggleLanguage('hi')}
                className={`px-2 py-0.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
                  isHi ? 'bg-emerald-500 text-[#002114]' : 'text-white/70 hover:text-white'
                }`}
              >
                हिंदी
              </button>
              <button
                onClick={() => toggleLanguage('en')}
                className={`px-2 py-0.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
                  !isHi ? 'bg-emerald-500 text-[#002114]' : 'text-white/70 hover:text-white'
                }`}
              >
                EN
              </button>
            </div>

            <button
              onClick={() => {
                cleanup();
                onClose();
              }}
              className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/80 hover:text-white transition-colors cursor-pointer"
              title="Close"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>
        </div>

        {/* ── Scrollable Chat Messages Area ──────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-gradient-to-b from-[#00170d] to-[#002114]">
          {messages.map((msg) => {
            const isUser = msg.sender === 'user';
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[82%] px-4 py-3 rounded-2xl shadow-md text-sm leading-relaxed ${
                    isUser
                      ? 'bg-emerald-600 text-white rounded-br-xs'
                      : 'bg-[#1b4332]/90 border border-emerald-500/20 text-emerald-50 rounded-bl-xs'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.text}</p>

                  {/* Replay Button for Assistant Audio */}
                  {!isUser && msg.audioBase64 && (
                    <button
                      onClick={() => playAudioBase64(msg.audioBase64!)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-300 hover:text-emerald-100 mt-2 bg-emerald-950/60 hover:bg-emerald-900 px-2.5 py-1 rounded-full border border-emerald-400/30 cursor-pointer transition-all"
                      title="Replay Audio"
                    >
                      <span className="material-symbols-outlined text-sm">replay</span>
                      <span>{isHi ? 'पुनः सुनें' : 'Play Audio'}</span>
                    </button>
                  )}
                </div>

                <span className="text-[10px] text-emerald-400/60 mt-1 px-1">
                  {msg.timestamp}
                </span>
              </div>
            );
          })}

          {/* Assistant Typing / Sending Indicator */}
          {state === 'SENDING' && (
            <div className="flex items-start">
              <div className="bg-[#1b4332]/80 border border-emerald-500/20 px-4 py-2.5 rounded-2xl rounded-bl-xs flex items-center gap-2 text-xs text-emerald-300">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-bounce"></span>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-bounce [animation-delay:0.2s]"></span>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-bounce [animation-delay:0.4s]"></span>
                <span className="ml-1 text-[11px] font-medium">
                  {isHi ? 'हार्वेक्स उत्तर तैयार कर रहा है...' : 'Harvex is thinking...'}
                </span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* ── Bottom Bar: Hold-to-Record Button ───────────────────────────── */}
        <div className="p-4 bg-[#00170d] border-t border-emerald-950 flex flex-col items-center justify-center gap-2 select-none">
          {/* Status Instructions & Recording Timer */}
          <div className="text-center h-6 flex items-center justify-center">
            {state === 'IDLE' && (
              <span className="text-xs font-semibold text-emerald-300/80 tracking-wide">
                {isHi ? 'बोलने के लिए माइक दबाकर रखें' : 'Hold mic to speak, release to send'}
              </span>
            )}
            {state === 'RECORDING' && (
              <span className="text-xs font-bold text-red-400 flex items-center gap-1.5 animate-pulse">
                <span className="w-2 h-2 rounded-full bg-red-500"></span>
                <span>
                  {isHi ? 'रिकॉर्डिंग जारी है...' : 'Recording...'} (
                  {Math.floor(recordingSeconds / 60)}:
                  {(recordingSeconds % 60).toString().padStart(2, '0')})
                </span>
              </span>
            )}
            {state === 'SENDING' && (
              <span className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-sm animate-spin">sync</span>
                <span>{isHi ? 'ऑडियो भेजा जा रहा है...' : 'Processing audio...'}</span>
              </span>
            )}
          </div>

          {/* Main Action Button */}
          <div className="relative flex items-center justify-center">
            {/* Ripple Pulse Rings while Recording */}
            {state === 'RECORDING' && (
              <>
                <div className="absolute w-24 h-24 rounded-full bg-red-500/25 animate-ping pointer-events-none" />
                <div className="absolute w-20 h-20 rounded-full bg-red-500/40 animate-pulse pointer-events-none" />
              </>
            )}

            <button
              onPointerDown={handlePointerDown}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              disabled={state === 'SENDING'}
              className={`w-16 h-16 rounded-full flex items-center justify-center shadow-2xl transition-all select-none touch-none ${
                state === 'RECORDING'
                  ? 'bg-red-600 scale-110 shadow-red-500/60 cursor-grabbing'
                  : state === 'SENDING'
                  ? 'bg-emerald-950 text-emerald-600 cursor-not-allowed opacity-70'
                  : 'bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white shadow-emerald-900/60 cursor-pointer'
              }`}
              title={
                state === 'RECORDING'
                  ? 'Release to send'
                  : state === 'SENDING'
                  ? 'Sending...'
                  : 'Hold to speak'
              }
            >
              <span className="material-symbols-outlined text-3xl select-none">
                {state === 'RECORDING' ? 'mic' : state === 'SENDING' ? 'sync' : 'mic'}
              </span>
            </button>
          </div>

          <span className="text-[10px] text-white/40 font-medium">
            {state === 'RECORDING'
              ? isHi
                ? 'भेजने के लिए बटन छोड़ें'
                : 'Release to send'
              : isHi
              ? 'टैप न करें, दबाकर रखें'
              : 'Hold down while speaking'}
          </span>
        </div>

      </div>
    </div>
  );
};

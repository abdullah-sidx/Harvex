import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Language, UserFarmProfile, SensorData } from '../types';

// ── Environment Configuration ────────────────────────────────────────────────
const BACKEND_URL = ((import.meta as any).env?.VITE_BACKEND_URL ?? 'http://localhost:8000').replace(/\/$/, '');

interface VoiceCallModalProps {
  language: Language;
  isOpen: boolean;
  onClose: () => void;
  farmProfile: UserFarmProfile;
  sensorData: SensorData;
}

type ModalState = 'IDLE' | 'LISTENING' | 'PROCESSING' | 'SPEAKING';

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

  const [modalState, setModalState] = useState<ModalState>('IDLE');
  const [isListening, setIsListening] = useState<boolean>(false);
  const [currentTranscript, setCurrentTranscript] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: 'welcome',
      sender: 'assistant',
      text: initialLanguage === 'hi'
        ? 'नमस्ते किसान साथी! बोलने के लिए माइक बटन दबाएं, बोलने के बाद दोबारा दबाकर उत्तर प्राप्त करें।'
        : 'Hello! Tap the mic button to speak, tap again when done to get your answer.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);

  // ── References ─────────────────────────────────────────────────────────────
  const isStoppingRef             = useRef<boolean>(false);
  const abortControllerRef        = useRef<AbortController | null>(null);
  const recognitionRef            = useRef<any>(null);
  const mediaRecorderRef          = useRef<MediaRecorder | null>(null);
  const audioChunksRef            = useRef<Blob[]>([]);
  const transcriptRef             = useRef<string>('');
  const micStreamRef              = useRef<MediaStream | null>(null);
  const activeAudioRef            = useRef<HTMLAudioElement | null>(null);
  const networkErrorOccurredRef   = useRef<boolean>(false);
  const messagesEndRef            = useRef<HTMLDivElement | null>(null);

  // Sync language with prop when modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentLanguage(initialLanguage);
      setErrorMessage(null);
    }
  }, [isOpen, initialLanguage]);

  // Auto-scroll chat to latest message
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, modalState, isOpen]);

  // Auto-dismiss error message after 6 seconds
  useEffect(() => {
    if (errorMessage) {
      const timer = setTimeout(() => setErrorMessage(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [errorMessage]);

  // ── Audio Playback Helper ──────────────────────────────────────────────────
  const playAudioBase64 = useCallback((base64: string) => {
    if (!base64 || base64.trim().length < 50) {
      setModalState('IDLE');
      return;
    }

    try {
      if (activeAudioRef.current) {
        activeAudioRef.current.pause();
        activeAudioRef.current.currentTime = 0;
        activeAudioRef.current = null;
      }

      const audioBytes = Uint8Array.from(atob(base64.trim()), (c) => c.charCodeAt(0));
      const blob = new Blob([audioBytes], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      activeAudioRef.current = audio;
      setModalState('SPEAKING');

      audio.play().catch((err) => {
        console.warn('[Audio] play() blocked or failed:', err);
        setModalState('IDLE');
      });

      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (activeAudioRef.current === audio) {
          activeAudioRef.current = null;
        }
        setModalState('IDLE');
      };
    } catch (err) {
      console.error('[Audio] Decoding error:', err);
      setModalState('IDLE');
    }
  }, []);

  // ── Release Microphone Stream Tracks Helper ───────────────────────────────
  const releaseMicStream = useCallback(() => {
    if (micStreamRef.current) {
      try {
        micStreamRef.current.getTracks().forEach((track) => track.stop());
      } catch (err) {
        console.warn('[Mic] stream stop error:', err);
      }
      micStreamRef.current = null;
    }
  }, []);

  // ── Send Captured Transcript Text to Backend Voice Query ──────────────────
  const handleSendToSarvam = useCallback(async (transcriptText: string) => {
    const textToSend = transcriptText.trim();
    if (!textToSend || isStoppingRef.current) {
      setModalState('IDLE');
      return;
    }

    setModalState('PROCESSING');
    setCurrentTranscript('');
    const langCode = currentLanguage === 'hi' ? 'hi-IN' : 'en-IN';

    // 1. Add Farmer's Message to Chat (RIGHT)
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages((prev) => [...prev.slice(-9), userMsg]);

    // 2. Query Backend POST /api/voice-query
    const controller = new AbortController();
    abortControllerRef.current = controller;

    let replyText = '';
    let replyAudioBase64: string | undefined = undefined;

    try {
      let backendRes: Response;
      try {
        backendRes = await fetch(`${BACKEND_URL}/api/voice-query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            device_id: 'harvex-node-1',
            transcript: textToSend,
            language: langCode,
          }),
          signal: controller.signal,
        });
      } catch {
        backendRes = await fetch('/api/voice-query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            device_id: 'harvex-node-1',
            transcript: textToSend,
            language: langCode,
          }),
          signal: controller.signal,
        });
      }

      if (isStoppingRef.current) return;

      if (backendRes.ok) {
        const backendData = await backendRes.json();
        replyText = (backendData.response_text || '').trim();
        replyAudioBase64 = backendData.response_audio_base64 || undefined;
      } else {
        throw new Error(`Backend returned HTTP ${backendRes.status}`);
      }
    } catch (backendErr: any) {
      if (backendErr?.name === 'AbortError' || isStoppingRef.current) return;
      console.warn('[Backend] /api/voice-query error:', backendErr);
      replyText = currentLanguage === 'hi'
        ? 'सर्वर से उत्तर प्राप्त नहीं हो सका। कृपया पुनः प्रयास करें।'
        : 'Could not connect to server. Please try again.';
    }

    if (isStoppingRef.current) return;

    // 3. Add Assistant's Reply to Chat (LEFT)
    const assistantMsg: ChatMessage = {
      id: `assistant-${Date.now()}`,
      sender: 'assistant',
      text: replyText || (currentLanguage === 'hi' ? 'उत्तर प्राप्त हो गया।' : 'Response received.'),
      audioBase64: replyAudioBase64,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages((prev) => [...prev.slice(-9), assistantMsg]);

    // 4. Play Reply Audio ONCE Automatically
    if (replyAudioBase64 && !isStoppingRef.current) {
      playAudioBase64(replyAudioBase64);
    } else {
      setModalState('IDLE');
    }
  }, [currentLanguage, playAudioBase64]);

  // ── Send Audio Blob to Sarvam AI STT Backend Fallback ─────────────────────
  const handleSendAudioToSarvam = useCallback(async (audioBlob: Blob) => {
    if (isStoppingRef.current) return;
    setModalState('PROCESSING');
    const langCode = currentLanguage === 'hi' ? 'hi-IN' : 'en-IN';

    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Clean Blob guaranteed to have audio/webm content-type
    const cleanBlob = new Blob([audioBlob], { type: 'audio/webm' });

    try {
      // ── Tier 1: Direct Backend Sarvam Voice Endpoint ──
      const formData = new FormData();
      formData.append('file', cleanBlob, 'user_voice.webm');
      formData.append('language', langCode);
      formData.append('device_id', 'harvex-node-1');

      let voiceRes: Response | null = null;
      try {
        voiceRes = await fetch(`${BACKEND_URL}/api/sarvam/voice`, {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        });
      } catch {
        try {
          voiceRes = await fetch('/api/sarvam/voice', {
            method: 'POST',
            body: formData,
            signal: controller.signal,
          });
        } catch {
          voiceRes = null;
        }
      }

      if (isStoppingRef.current) return;

      if (voiceRes && voiceRes.ok) {
        const data = await voiceRes.json();
        const transcript = (data.transcript || '').trim();
        const replyText = (data.response_text || '').trim();
        const replyAudioBase64 = data.response_audio_base64 || undefined;

        if (transcript || replyText) {
          // Add user chat bubble
          if (transcript) {
            setMessages((prev) => [
              ...prev.slice(-9),
              {
                id: `user-${Date.now()}`,
                sender: 'user',
                text: transcript,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              },
            ]);
          }

          // Add assistant reply bubble
          if (replyText) {
            setMessages((prev) => [
              ...prev.slice(-9),
              {
                id: `assistant-${Date.now()}`,
                sender: 'assistant',
                text: replyText,
                audioBase64: replyAudioBase64,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              },
            ]);
          }

          if (replyAudioBase64 && !isStoppingRef.current) {
            playAudioBase64(replyAudioBase64);
          } else {
            setModalState('IDLE');
          }
          return;
        }
      }

      // ── Tier 2: Backend /api/sarvam/stt Endpoint with Auto-Language ('unknown') ──
      const sttFormData = new FormData();
      sttFormData.append('file', cleanBlob, 'user_voice.webm');
      sttFormData.append('language', 'unknown');

      let sttRes: Response | null = null;
      try {
        sttRes = await fetch(`${BACKEND_URL}/api/sarvam/stt`, {
          method: 'POST',
          body: sttFormData,
          signal: controller.signal,
        });
      } catch {
        try {
          sttRes = await fetch('/api/sarvam/stt', {
            method: 'POST',
            body: sttFormData,
            signal: controller.signal,
          });
        } catch {
          sttRes = null;
        }
      }

      if (isStoppingRef.current) return;

      if (sttRes && sttRes.ok) {
        const sttData = await sttRes.json();
        const transcript = (sttData.transcript || '').trim();
        if (transcript) {
          await handleSendToSarvam(transcript);
          return;
        }
      }

      // ── Tier 3: Direct Browser-to-Sarvam AI STT API with Auto-Detection ──
      const sarvamKey =
        (import.meta as any).env?.VITE_SARVAM_API_KEY ||
        'sk_r62icrot_JRmaNbLKKuGbzseNG0IycixQ';

      if (sarvamKey) {
        try {
          const directForm = new FormData();
          directForm.append('file', cleanBlob, 'user_voice.webm');
          directForm.append('language_code', 'unknown');
          directForm.append('model', 'saarika:v2.5');

          const directRes = await fetch('https://api.sarvam.ai/speech-to-text', {
            method: 'POST',
            headers: {
              'api-subscription-key': sarvamKey,
            },
            body: directForm,
            signal: controller.signal,
          });

          if (directRes.ok) {
            const directData = await directRes.json();
            const transcript = (directData.transcript || '').trim();
            if (transcript) {
              await handleSendToSarvam(transcript);
              return;
            }
          }
        } catch (directErr) {
          console.warn('[DirectSarvam] Fallback attempt failed:', directErr);
        }
      }

      throw new Error('Sarvam voice transcription returned no speech content');
    } catch (err: any) {
      if (err?.name === 'AbortError' || isStoppingRef.current) return;
      console.error('[VoiceFallback] Error processing audio with Sarvam AI:', err);
      setErrorMessage(
        isHi
          ? 'कोई आवाज़ सुनाई नहीं दी। कृपया माइक के पास बोलें।'
          : 'Could not transcribe speech. Please speak closer to the microphone and try again.'
      );
      setModalState('IDLE');
    }
  }, [currentLanguage, handleSendToSarvam, playAudioBase64, isHi]);


  // ── TAP 1: Start Listening (Web Speech + MediaRecorder Concurrent) ─────────
  const startListening = useCallback(async () => {
    setErrorMessage(null);

    // Stop any existing audio playback
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current.currentTime = 0;
      activeAudioRef.current = null;
    }

    // 1. Acquire microphone stream for hardware MediaRecorder
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
    } catch (micErr: any) {
      console.error('[Mic] Microphone permission denied or not available:', micErr);
      setErrorMessage(
        isHi
          ? 'माइक्रोफ़ोन की अनुमति अस्वीकृत। कृपया ब्राउज़र सेटिंग्स में माइक की अनुमति दें।'
          : 'Microphone permission denied. Please allow microphone access in your browser.'
      );
      setIsListening(false);
      setModalState('IDLE');
      return;
    }

    // 2. Start MediaRecorder to capture raw audio chunks
    audioChunksRef.current = [];
    try {
      let mimeType = '';
      if (typeof MediaRecorder !== 'undefined') {
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mimeType = 'audio/webm;codecs=opus';
        else if (MediaRecorder.isTypeSupported('audio/webm')) mimeType = 'audio/webm';
        else if (MediaRecorder.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4';
        else if (MediaRecorder.isTypeSupported('audio/ogg')) mimeType = 'audio/ogg';
        else if (MediaRecorder.isTypeSupported('audio/wav')) mimeType = 'audio/wav';
      }

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };
      recorder.start(100);
      mediaRecorderRef.current = recorder;
    } catch (recErr) {
      console.warn('[MediaRecorder] Could not start MediaRecorder:', recErr);
    }

    // 3. Reset transcript buffer and flags
    transcriptRef.current = '';
    setCurrentTranscript('');
    isStoppingRef.current = false;
    networkErrorOccurredRef.current = false;

    // 4. Start Web Speech recognition for live visualizer
    try {
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = isHi ? 'hi-IN' : 'en-IN';

        // Accumulate live transcript in transcriptRef.current
        recognition.onresult = (event: any) => {
          let accumulated = '';
          for (let i = 0; i < event.results.length; i++) {
            accumulated += event.results[i][0].transcript + ' ';
          }
          const clean = accumulated.trim();
          transcriptRef.current = clean;
          setCurrentTranscript(clean);
        };

        // Catch onerror: network or onerror: no-speech and prevent infinite retry loops
        recognition.onerror = (event: any) => {
          const errType = event?.error;
          console.warn('[Recognition] onerror event:', errType);

          if (errType === 'network') {
            // Stop automatic retries when a network error is detected
            networkErrorOccurredRef.current = true;
            console.warn('[Recognition] Web Speech network error detected. MediaRecorder will provide direct audio fallback.');
            try {
              recognition.abort();
            } catch {}
          } else if (errType === 'no-speech') {
            console.log('[Recognition] No speech detected in segment.');
          } else if (errType === 'not-allowed') {
            setErrorMessage(
              isHi
                ? 'आवाज़ पहचान की अनुमति अस्वीकृत।'
                : 'Speech recognition access not allowed.'
            );
          }
        };

        // Prevent recognition.onend from automatically finalizing the turn or restarting listening on silence timeouts
        recognition.onend = () => {
          console.log('[Recognition] onend event (auto-stop disabled)');
        };

        recognitionRef.current = recognition;
        try {
          recognition.start();
        } catch (startErr) {
          console.warn('[Recognition] SpeechRecognition start warning:', startErr);
        }
      }
    } catch (e) {
      console.warn('[Recognition] Not supported or failed to initialize, relying on MediaRecorder:', e);
    }

    setIsListening(true);
    setModalState('LISTENING');
  }, [isHi]);

  // ── TAP 2: Stop Listening & Respond Immediately ───────────────────────────
  const stopListeningAndRespond = useCallback(async () => {
    setIsListening(false);
    setModalState('PROCESSING');

    // 1. Stop Web Speech recognition
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }

    // 2. Stop MediaRecorder and combine audio chunks into Blob
    const getRecordedAudioBlob = (): Promise<Blob | null> => {
      return new Promise((resolve) => {
        const recorder = mediaRecorderRef.current;
        if (!recorder || recorder.state === 'inactive') {
          const chunks = audioChunksRef.current;
          if (chunks.length > 0) {
            resolve(new Blob(chunks, { type: 'audio/webm' }));
          } else {
            resolve(null);
          }
          return;
        }

        recorder.onstop = () => {
          const chunks = audioChunksRef.current;
          if (chunks.length > 0) {
            resolve(new Blob(chunks, { type: 'audio/webm' }));
          } else {
            resolve(null);
          }
        };

        try {
          recorder.stop();
        } catch {
          const chunks = audioChunksRef.current;
          if (chunks.length > 0) {
            resolve(new Blob(chunks, { type: 'audio/webm' }));
          } else {
            resolve(null);
          }
        }
      });
    };

    const audioBlob = await getRecordedAudioBlob();

    // 3. Release hardware microphone stream tracks
    releaseMicStream();

    // 4. Check transcript buffer vs recorded audio fallback
    const textTranscript = transcriptRef.current.trim();

    if (textTranscript) {
      // Live transcript captured successfully -> pass text to Sarvam AI
      await handleSendToSarvam(textTranscript);
    } else if (audioBlob && audioBlob.size > 1000) {
      // Transcript is empty (due to network error or silence) -> send audio Blob directly to Sarvam AI STT API
      console.log(`[Voice] Web Speech transcript empty. Sending ${(audioBlob.size / 1024).toFixed(1)} KB audio Blob to Sarvam STT fallback...`);
      await handleSendAudioToSarvam(audioBlob);
    } else {
      setErrorMessage(
        isHi
          ? 'कोई आवाज़ सुनाई नहीं दी। कृपया बटन दबाकर दोबारा बोलें।'
          : 'No speech was detected. Please tap the button and try again.'
      );
      setModalState('IDLE');
    }
  }, [releaseMicStream, handleSendToSarvam, handleSendAudioToSarvam, isHi]);

  // ── Single Button Toggle Handler ──────────────────────────────────────────
  const handleToggleListening = useCallback(() => {
    if (isListening || modalState === 'LISTENING') {
      // TAP 2: Mic Active -> Stop & Respond
      stopListeningAndRespond();
    } else if (modalState === 'SPEAKING') {
      // Pause AI speech and return to idle
      if (activeAudioRef.current) {
        activeAudioRef.current.pause();
        activeAudioRef.current.currentTime = 0;
        activeAudioRef.current = null;
      }
      setModalState('IDLE');
    } else if (modalState === 'IDLE') {
      // TAP 1: Mic Idle -> Start
      startListening();
    }
  }, [isListening, modalState, stopListeningAndRespond, startListening]);

  // ── Clean Teardown on Modal Close ─────────────────────────────────────────
  const handleCloseModal = useCallback(() => {
    isStoppingRef.current = true;
    setIsListening(false);

    // Mid-speech abort
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {}
      recognitionRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
    }
    mediaRecorderRef.current = null;

    // Release all hardware media tracks
    releaseMicStream();

    // Abort in-flight network requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Pause and reset playing audio
    if (activeAudioRef.current) {
      try {
        activeAudioRef.current.pause();
        activeAudioRef.current.currentTime = 0;
      } catch {}
      activeAudioRef.current = null;
    }

    transcriptRef.current = '';
    setCurrentTranscript('');
    setErrorMessage(null);
    setModalState('IDLE');

    setTimeout(() => {
      isStoppingRef.current = false;
    }, 50);
  }, [releaseMicStream]);

  useEffect(() => {
    if (!isOpen) {
      handleCloseModal();
    }
    return () => {
      handleCloseModal();
    };
  }, [isOpen, handleCloseModal]);

  // ── Language Switcher Handler ─────────────────────────────────────────────
  const toggleLanguage = (lang: Language) => {
    if (currentLanguage === lang) return;
    if (isListening || modalState === 'LISTENING') {
      stopListeningAndRespond();
    }
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current.currentTime = 0;
      activeAudioRef.current = null;
    }
    setCurrentLanguage(lang);
    setErrorMessage(null);
    setModalState('IDLE');
    setMessages((prev) => [
      ...prev.slice(-9),
      {
        id: `lang-${Date.now()}`,
        sender: 'assistant',
        text: lang === 'hi'
          ? 'भाषा हिंदी में बदली गई। बोलने के लिए माइक बटन दबाएं।'
          : 'Language changed to English. Tap mic to speak.',
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
                handleCloseModal();
                onClose();
              }}
              className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/80 hover:text-white transition-colors cursor-pointer"
              title="Close"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>
        </div>

        {/* ── Error Banner UI ────────────────────────────────────────────── */}
        {errorMessage && (
          <div className="mx-4 mt-2 p-2.5 rounded-xl bg-red-950/90 border border-red-500/60 text-red-200 text-xs flex items-center justify-between shadow-md animate-fadeIn z-20">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-base text-red-400 shrink-0">error</span>
              <span className="leading-tight">{errorMessage}</span>
            </div>
            <button
              onClick={() => setErrorMessage(null)}
              className="text-red-400 hover:text-white ml-2 shrink-0 cursor-pointer"
              title="Dismiss"
            >
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          </div>
        )}

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

          {/* Assistant Typing / Processing Indicator */}
          {modalState === 'PROCESSING' && (
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

        {/* ── Bottom Bar: Single-Button Tap-to-Toggle Input ────────────────── */}
        <div className="p-4 bg-[#00170d] border-t border-emerald-950 flex flex-col items-center justify-center gap-2 select-none">
          {/* Status Instructions */}
          <div className="text-center min-h-[36px] flex flex-col items-center justify-center">
            {modalState === 'IDLE' && (
              <span className="text-xs font-semibold text-emerald-300/80 tracking-wide">
                {isHi ? 'बोलने के लिए माइक बटन दबाएं' : 'Tap mic to speak'}
              </span>
            )}
            {modalState === 'LISTENING' && (
              <div className="flex flex-col items-center animate-fadeIn">
                <span className="text-xs font-bold text-red-400 flex items-center gap-1.5 animate-pulse">
                  <span className="w-2 h-2 rounded-full bg-red-500"></span>
                  <span>
                    {isHi ? 'सुन रहे हैं... (रोकने और उत्तर के लिए दोबारा दबाएं)' : 'Listening... (Tap again to stop & respond)'}
                  </span>
                </span>
                {currentTranscript && (
                  <span className="text-[11px] text-emerald-200/90 italic truncate max-w-xs mt-0.5">
                    "{currentTranscript}"
                  </span>
                )}
              </div>
            )}
            {modalState === 'PROCESSING' && (
              <span className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-sm animate-spin">sync</span>
                <span>{isHi ? 'सर्वम एआई द्वारा उत्तर तैयार हो रहा है...' : 'Processing with Sarvam AI...'}</span>
              </span>
            )}
            {modalState === 'SPEAKING' && (
              <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5 animate-pulse">
                <span className="material-symbols-outlined text-sm">volume_up</span>
                <span>{isHi ? 'हार्वेक्स उत्तर दे रहा है...' : 'AI Speaking...'}</span>
              </span>
            )}
          </div>

          {/* Main Action Button - Single Tap-to-Toggle */}
          <div className="relative flex items-center justify-center my-1">
            {/* Visual pulse indicator while listening */}
            {modalState === 'LISTENING' && (
              <>
                <div className="absolute w-24 h-24 rounded-full bg-red-500/25 animate-ping pointer-events-none" />
                <div className="absolute w-20 h-20 rounded-full bg-red-500/40 animate-pulse pointer-events-none" />
              </>
            )}

            {modalState === 'SPEAKING' && (
              <div className="absolute w-20 h-20 rounded-full bg-emerald-500/30 animate-pulse pointer-events-none" />
            )}

            <button
              type="button"
              onClick={handleToggleListening}
              disabled={modalState === 'PROCESSING'}
              className={`w-16 h-16 rounded-full flex items-center justify-center shadow-2xl transition-all select-none cursor-pointer ${
                modalState === 'LISTENING'
                  ? 'bg-red-600 hover:bg-red-700 scale-105 shadow-red-500/60 text-white'
                  : modalState === 'PROCESSING'
                  ? 'bg-emerald-950 text-emerald-600 cursor-not-allowed opacity-75'
                  : modalState === 'SPEAKING'
                  ? 'bg-emerald-700 hover:bg-emerald-600 text-white shadow-emerald-700/50'
                  : 'bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white shadow-emerald-900/60'
              }`}
              title={
                modalState === 'LISTENING'
                  ? 'Tap to stop & respond'
                  : modalState === 'PROCESSING'
                  ? 'Processing...'
                  : modalState === 'SPEAKING'
                  ? 'Tap to pause'
                  : 'Tap to speak'
              }
            >
              <span className="material-symbols-outlined text-3xl select-none">
                {modalState === 'LISTENING'
                  ? 'stop'
                  : modalState === 'PROCESSING'
                  ? 'sync'
                  : modalState === 'SPEAKING'
                  ? 'volume_up'
                  : 'mic'}
              </span>
            </button>
          </div>

          <span className="text-[10px] text-white/40 font-medium">
            {modalState === 'LISTENING'
              ? isHi
                ? 'रोकने और उत्तर पाने के लिए बटन दोबारा दबाएं'
                : 'Tap again to stop & respond'
              : modalState === 'PROCESSING'
              ? isHi
                ? 'कृपया प्रतीक्षा करें...'
                : 'Please wait...'
              : modalState === 'SPEAKING'
              ? isHi
                ? 'रोकने के लिए दबाएं'
                : 'Tap to pause'
              : isHi
              ? 'एक बार दबाएं और बोलें'
              : 'Tap once to speak'}
          </span>
        </div>

      </div>
    </div>
  );
};

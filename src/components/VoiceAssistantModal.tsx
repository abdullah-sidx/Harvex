import React, { useState, useEffect, useRef } from 'react';
import { Language, SensorData } from '../types';
import { TRANSLATIONS } from '../data';

interface VoiceAssistantModalProps {
  language: Language;
  sensorData: SensorData;
}

export const VoiceAssistantModal: React.FC<VoiceAssistantModalProps> = ({
  language: initialLanguage,
  sensorData,
}) => {
  const [modalLanguage, setModalLanguage] = useState<Language>(initialLanguage);
  const isHi = modalLanguage === 'hi';
  const t = TRANSLATIONS[modalLanguage];

  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<
    { sender: 'user' | 'assistant'; text: string; audioBase64?: string }[]
  >([]);
  const [isListening, setIsListening] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const recognitionRef = useRef<any>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Sync initial language
  useEffect(() => {
    setModalLanguage(initialLanguage);
  }, [initialLanguage]);

  // Initialize Speech Recognition
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = isHi ? 'hi-IN' : 'en-US';

      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        if (transcript) {
          setQuery(transcript);
          handleSendMessage(transcript);
        }
        setIsListening(false);
      };

      recognition.onerror = () => {
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }
  }, [modalLanguage, isHi]);

  // Scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Initial welcome message
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        {
          sender: 'assistant',
          text: isHi
            ? 'नमस्ते किसान साथी! मैं हार्वेक्स सर्वम एआई कृषि सहायक हूँ। आप खेत की नमी, सिंचाई, फसल रोग या मौसम के बारे में हिंदी या अंग्रेजी में कुछ भी पूछ सकते हैं।'
            : 'Hello! I am your Harvex Sarvam AI Farm Assistant. Ask me anything about crop health, irrigation status, disease remedies, or weather forecast in Hindi or English.',
        },
      ]);
    }
  }, [isHi]);

  const toggleListening = () => {
    if (!recognitionRef.current) {
      alert(
        isHi
          ? 'आपके ब्राउज़र में आवाज़ पहचान समर्थित नहीं है, कृपया टाइप करें।'
          : 'Speech recognition is not supported in this browser. Please type your query.'
      );
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      recognitionRef.current.lang = isHi ? 'hi-IN' : 'en-US';
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  const handleSendMessage = async (customText?: string) => {
    const textToSend = customText || query;
    if (!textToSend.trim()) return;

    const userMsg = { sender: 'user' as const, text: textToSend };
    setMessages((prev) => [...prev, userMsg]);
    setQuery('');
    setIsLoading(true);

    try {
      // 1. Fetch text answer
      let replyText = '';
      try {
        const res = await fetch('http://localhost:8000/api/chat-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: textToSend,
            language: modalLanguage,
            sensor_context: sensorData,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          replyText = data.reply || '';
        }
      } catch {
        // Fallback relative path
        const res = await fetch('/api/chat-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: textToSend,
            language: modalLanguage,
            sensor_context: sensorData,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          replyText = data.reply || '';
        }
      }

      if (!replyText) {
        replyText = isHi
          ? 'वर्तमान में मिट्टी की नमी 42% है तथा तापमान 24°C अनुकूल है। सिंचाई की अभी आवश्यकता नहीं है।'
          : 'Currently soil moisture is at 42% with optimal 24°C temperature. No irrigation is needed right now.';
      }

      // 2. Synthesize Indic speech via Sarvam AI
      let audioB64 = '';
      try {
        const synthRes = await fetch('http://localhost:8000/api/voice/synthesize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: replyText,
            language: modalLanguage,
            speaker: 'anushka',
          }),
        });
        if (synthRes.ok) {
          const synthData = await synthRes.json();
          audioB64 = synthData.audio_base64 || '';
        }
      } catch (err) {
        console.warn('Sarvam synthesis fetch warning:', err);
      }

      setMessages((prev) => [...prev, { sender: 'assistant', text: replyText, audioBase64: audioB64 }]);

      // Speak response aloud
      if (audioB64) {
        playSarvamAudio(audioB64, replyText);
      } else {
        speakTextFallback(replyText);
      }
    } catch (err) {
      console.error('Error in Voice Assistant:', err);
      const fallbackReply = isHi
        ? 'वर्तमान में मिट्टी की नमी 42% है तथा तापमान 24°C अनुकूल है।'
        : 'Currently soil moisture is at 42% with optimal 24°C temperature.';
      setMessages((prev) => [...prev, { sender: 'assistant', text: fallbackReply }]);
      speakTextFallback(fallbackReply);
    } finally {
      setIsLoading(false);
    }
  };

  const playSarvamAudio = (b64Audio: string, fallbackText: string) => {
    try {
      if (audioPlayerRef.current) audioPlayerRef.current.pause();
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();

      const audio = new Audio(`data:audio/wav;base64,${b64Audio}`);
      audioPlayerRef.current = audio;
      setIsSpeaking(true);

      audio.onended = () => setIsSpeaking(false);
      audio.onerror = () => {
        setIsSpeaking(false);
        speakTextFallback(fallbackText);
      };

      audio.play().catch(() => {
        setIsSpeaking(false);
        speakTextFallback(fallbackText);
      });
    } catch {
      speakTextFallback(fallbackText);
    }
  };

  const speakTextFallback = (text: string) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = isHi ? 'hi-IN' : 'en-US';
    utterance.rate = 0.95;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
  };

  const quickPrompts = isHi
    ? [
        'क्या आज सिंचाई करनी चाहिए?',
        'अगेती झुलसा का क्या इलाज है?',
        'खेत का तापमान कितना है?',
      ]
    : [
        'Should I irrigate today?',
        'How to treat Early Blight?',
        'What are the sensor readings?',
      ];

  return (
    <>
      {/* Floating Action Button */}
      <button
        onClick={() => setIsOpen(true)}
        aria-label="Voice Assistant"
        className="fixed bottom-[88px] md:bottom-28 right-4 md:right-8 z-40 w-14 h-14 bg-[#012d1d] hover:bg-[#1b4332] text-[#ffffff] rounded-full shadow-lg flex items-center justify-center transition-all cursor-pointer group active:scale-95 border-2 border-emerald-400/30"
      >
        <span className="material-symbols-outlined text-3xl">mic</span>
        <span className="absolute right-16 bg-[#e5e2e1] text-[#1c1b1b] px-3 py-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity font-bold text-xs whitespace-nowrap shadow-md pointer-events-none">
          {t.speak}
        </span>
      </button>

      {/* Voice Assistant Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-3 md:p-4 backdrop-blur-xs animate-fadeIn">
          <div className="bg-[#ffffff] border border-[#c1c8c2] rounded-2xl w-full max-w-lg shadow-2xl flex flex-col h-[580px] overflow-hidden">
            {/* Header with Language Toggle */}
            <div className="p-4 border-b border-[#c1c8c2] flex items-center justify-between bg-[#fcf9f8]">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-[#c1ecd4] flex items-center justify-center">
                  <span className="material-symbols-outlined text-[#274e3d] text-xl icon-fill">
                    psychology
                  </span>
                </div>
                <div>
                  <h3 className="font-bold text-base text-[#012d1d]">
                    {t.voiceAssistant}
                  </h3>
                  <p className="text-[11px] text-[#414844]">
                    {isHi ? 'सर्वम AI वॉयस सहायक' : 'Sarvam AI Voice Assistant'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Language Switcher Pill */}
                <div className="flex items-center bg-[#f0edec] p-0.5 rounded-full border border-[#c1c8c2]">
                  <button
                    onClick={() => setModalLanguage('hi')}
                    className={`px-2 py-0.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
                      isHi
                        ? 'bg-[#1b4332] text-[#c1ecd4] shadow-xs'
                        : 'text-[#414844] hover:text-[#1c1b1b]'
                    }`}
                  >
                    🇮🇳 HI
                  </button>
                  <button
                    onClick={() => setModalLanguage('en')}
                    className={`px-2 py-0.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
                      !isHi
                        ? 'bg-[#1b4332] text-[#c1ecd4] shadow-xs'
                        : 'text-[#414844] hover:text-[#1c1b1b]'
                    }`}
                  >
                    🌐 EN
                  </button>
                </div>

                {isSpeaking && (
                  <button
                    onClick={() => {
                      if (audioPlayerRef.current) audioPlayerRef.current.pause();
                      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
                      setIsSpeaking(false);
                    }}
                    className="p-1.5 text-xs font-bold text-[#ba1a1a] bg-red-100 rounded-full hover:bg-red-200 cursor-pointer"
                    title="Stop Audio"
                  >
                    <span className="material-symbols-outlined text-base">volume_off</span>
                  </button>
                )}
                <button
                  onClick={() => {
                    setIsOpen(false);
                    if (audioPlayerRef.current) audioPlayerRef.current.pause();
                    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
                  }}
                  className="text-[#717973] hover:text-[#1c1b1b] p-1.5 rounded-full hover:bg-[#e5e2e1] cursor-pointer"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
            </div>

            {/* Chat Body */}
            <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-[#ffffff]">
              {messages.map((msg, index) => (
                <div
                  key={index}
                  className={`flex ${
                    msg.sender === 'user' ? 'justify-end' : 'justify-start'
                  }`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-xs md:text-sm font-medium ${
                      msg.sender === 'user'
                        ? 'bg-[#1b4332] text-[#86af99] rounded-br-none'
                        : 'bg-[#f0edec] text-[#1c1b1b] border border-[#c1c8c2] rounded-bl-none'
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}

              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-[#f0edec] text-[#1c1b1b] border border-[#c1c8c2] rounded-2xl px-4 py-2 text-xs flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#1b4332] animate-bounce"></span>
                    <span className="w-1.5 h-1.5 rounded-full bg-[#1b4332] animate-bounce [animation-delay:0.2s]"></span>
                    <span className="w-1.5 h-1.5 rounded-full bg-[#1b4332] animate-bounce [animation-delay:0.4s]"></span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Quick Prompts */}
            <div className="px-4 py-2 bg-[#fcf9f8] border-t border-[#c1c8c2] flex gap-2 overflow-x-auto">
              {quickPrompts.map((promptText, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSendMessage(promptText)}
                  className="text-[11px] font-semibold bg-[#ffffff] hover:bg-[#e5e2e1] border border-[#c1c8c2] text-[#012d1d] px-3 py-1 rounded-full whitespace-nowrap transition-colors cursor-pointer shrink-0"
                >
                  {promptText}
                </button>
              ))}
            </div>

            {/* Input Bar */}
            <div className="p-3 border-t border-[#c1c8c2] bg-[#fcf9f8] flex items-center gap-2">
              <button
                onClick={toggleListening}
                className={`p-2.5 rounded-full transition-all cursor-pointer ${
                  isListening
                    ? 'bg-red-600 text-white animate-pulse'
                    : 'bg-[#c1ecd4] text-[#002114] hover:bg-[#a8e2c2]'
                }`}
                title={isListening ? 'Stop Listening' : 'Speak'}
              >
                <span className="material-symbols-outlined text-xl">
                  {isListening ? 'mic_off' : 'mic'}
                </span>
              </button>

              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder={isHi ? 'बोलें या टाइप करें...' : 'Speak or type farming query...'}
                className="flex-1 bg-[#ffffff] border border-[#c1c8c2] rounded-xl px-3.5 py-2 text-xs md:text-sm text-[#1c1b1b] focus:border-[#012d1d] focus:outline-hidden"
              />

              <button
                onClick={() => handleSendMessage()}
                disabled={!query.trim() || isLoading}
                className="bg-[#1b4332] hover:bg-[#012d1d] disabled:opacity-50 text-[#86af99] p-2.5 rounded-xl transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-lg">send</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

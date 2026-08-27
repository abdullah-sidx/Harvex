import React, { useState, useEffect, useRef } from 'react';
import { Language, UserFarmProfile, SensorData } from '../types';
import { TRANSLATIONS } from '../data';

interface ChatViewProps {
  language: Language;
  farmProfile: UserFarmProfile;
  sensorData: SensorData;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

export const ChatView: React.FC<ChatViewProps> = ({
  language,
  farmProfile,
  sensorData,
}) => {
  const isHi = language === 'hi';
  const t = TRANSLATIONS[language];

  const [inputMessage, setInputMessage] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Initialize welcome message
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        {
          id: 'welcome-1',
          sender: 'assistant',
          text: isHi
            ? `नमस्ते! मैं हार्वेक्स एआई कृषि सलाहकार हूँ। आपके क्षेत्र (${farmProfile.district || 'खेत'}, ${farmProfile.state || 'भारत'}) और ${farmProfile.soil_type || 'मिट्टी'} के अनुसार आप फसल सुरक्षा, खाद प्रबंधन, सिंचाई और रोग नियंत्रण से जुड़ा कोई भी सवाल पूछ सकते हैं।`
            : `Hello! I am your Harvex AI Agronomist. Based on your region (${farmProfile.district || 'Farm'}, ${farmProfile.state || 'India'}) and ${farmProfile.soil_type || 'soil'}, ask me anything about crop planning, disease remedies, fertilizer schedules, or irrigation advice.`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    }
  }, [isHi, farmProfile]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Browser-Native Speech Synthesis (TTS) - Does not call Sarvam API
  const handleNativeSpeak = (msgId: string, text: string) => {
    if (!('speechSynthesis' in window)) return;

    if (speakingMessageId === msgId) {
      window.speechSynthesis.cancel();
      setSpeakingMessageId(null);
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = isHi ? 'hi-IN' : 'en-US';
    utterance.rate = 0.95;

    utterance.onend = () => setSpeakingMessageId(null);
    utterance.onerror = () => setSpeakingMessageId(null);

    setSpeakingMessageId(msgId);
    window.speechSynthesis.speak(utterance);
  };

  // Send message to backend
  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputMessage).trim();
    if (!text || isLoading) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputMessage('');
    setIsLoading(true);

    try {
      const endpoint = 'http://localhost:8000/api/chat';
      let res: Response;

      const payload = {
        message: text,
        language: isHi ? 'hi' : 'en',
        farm_profile: farmProfile,
        sensor_context: sensorData,
      };

      try {
        res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch {
        try {
          res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        } catch {
          res = await fetch('/api/chat-text', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        }
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const assistantMsg: ChatMessage = {
        id: `ast-${Date.now()}`,
        sender: 'assistant',
        text: data.reply || (isHi ? 'कोई उत्तर नहीं मिला।' : 'No response received.'),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      console.error('Chat error:', err);
      const errorMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        sender: 'assistant',
        text: isHi
          ? 'सर्वर से जुड़ने में समस्या हुई। कृपया सुनिश्चित करें कि बैकएंड चालू है।'
          : 'Failed to connect to the backend assistant. Please ensure the server is running.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const quickPrompts = isHi
    ? [
        'मेरी मिट्टी के लिए सबसे अच्छी फसल कौन सी है?',
        'पत्ती के झुलसा रोग का उपचार क्या है?',
        'क्या आज खेत में सिंचाई की आवश्यकता है?',
        'जैविक खाद और उर्वरक का सही अनुपात क्या है?',
      ]
    : [
        'Which crops are best for my soil type?',
        'How do I treat Early Blight in crops?',
        'Is irrigation recommended today based on soil moisture?',
        'What is the ideal NPK fertilizer schedule?',
      ];

  return (
    <div className="w-full max-w-4xl mx-auto pb-24 md:pb-8 pt-4 flex flex-col h-[calc(100vh-100px)]">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold text-[#012d1d] tracking-tight flex items-center gap-2">
            <span className="material-symbols-outlined text-3xl md:text-4xl icon-fill text-[#1b4332]">
              chat
            </span>
            <span>{isHi ? 'कृषि एआई चैट' : 'Agronomy AI Chat'}</span>
          </h1>
          <p className="text-xs md:text-sm text-[#414844] mt-0.5">
            {isHi
              ? `${farmProfile.district || 'खेत'}, ${farmProfile.state || 'भारत'} • ${farmProfile.soil_type}`
              : `${farmProfile.district || 'Farm'}, ${farmProfile.state || 'India'} • ${farmProfile.soil_type}`}
          </p>
        </div>
      </div>

      {/* Messages Scroll Container */}
      <div className="flex-1 bg-[#ffffff] border border-[#c1c8c2] rounded-2xl p-4 md:p-6 overflow-y-auto space-y-4 shadow-xs">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${
              msg.sender === 'user' ? 'items-end' : 'items-start'
            } animate-fadeIn`}
          >
            <div
              className={`max-w-[85%] md:max-w-[75%] rounded-2xl p-4 shadow-xs text-sm md:text-base ${
                msg.sender === 'user'
                  ? 'bg-[#1b4332] text-[#c1ecd4] rounded-br-xs'
                  : 'bg-[#f0edec] text-[#1c1b1b] border border-[#c1c8c2] rounded-bl-xs'
              }`}
            >
              <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>

              {/* Footer with Timestamp and Native TTS speaker icon */}
              <div
                className={`flex items-center justify-between mt-2 pt-1 border-t text-[11px] font-semibold ${
                  msg.sender === 'user'
                    ? 'border-[#c1ecd4]/20 text-[#c1ecd4]/70'
                    : 'border-[#c1c8c2] text-[#414844]'
                }`}
              >
                <span>{msg.timestamp}</span>

                {msg.sender === 'assistant' && (
                  <button
                    onClick={() => handleNativeSpeak(msg.id, msg.text)}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-full hover:bg-[#e5e2e1] text-[#012d1d] transition-colors cursor-pointer"
                    title={speakingMessageId === msg.id ? 'Stop Speech' : 'Listen with Browser TTS'}
                  >
                    <span className="material-symbols-outlined text-[16px]">
                      {speakingMessageId === msg.id ? 'volume_off' : 'volume_up'}
                    </span>
                    <span>
                      {speakingMessageId === msg.id
                        ? isHi ? 'रोकें' : 'Stop'
                        : isHi ? 'सुनें' : 'Listen'}
                    </span>
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex items-center gap-2 text-xs font-bold text-[#012d1d] bg-[#f0edec] px-4 py-2 rounded-full w-max animate-pulse">
            <span className="material-symbols-outlined text-base animate-spin">sync</span>
            <span>{isHi ? 'हार्वेक्स उत्तर तैयार कर रहा है...' : 'Harvex is thinking...'}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggested Quick Prompts */}
      <div className="flex items-center gap-2 overflow-x-auto py-2 px-1">
        {quickPrompts.map((prompt, idx) => (
          <button
            key={idx}
            onClick={() => handleSendMessage(prompt)}
            className="shrink-0 text-xs font-semibold px-3 py-1.5 bg-[#f0edec] hover:bg-[#e5e2e1] border border-[#c1c8c2] text-[#012d1d] rounded-full transition-all cursor-pointer shadow-xs whitespace-nowrap"
          >
            💡 {prompt}
          </button>
        ))}
      </div>

      {/* Input Bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSendMessage();
        }}
        className="flex items-center gap-2 pt-1"
      >
        <input
          type="text"
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          placeholder={
            isHi
              ? 'फसल, बीमारी, खाद या मौसम के बारे में पूछें...'
              : 'Ask about crops, diseases, irrigation, fertilizers...'
          }
          className="flex-1 h-12 px-4 bg-[#ffffff] border border-[#c1c8c2] rounded-xl text-sm font-semibold text-[#1c1b1b] focus:border-[#012d1d] focus:outline-hidden transition-all shadow-xs"
        />

        <button
          type="submit"
          disabled={!inputMessage.trim() || isLoading}
          className="h-12 px-5 bg-[#1b4332] hover:bg-[#012d1d] disabled:opacity-50 disabled:cursor-not-allowed text-[#c1ecd4] font-bold text-sm rounded-xl transition-all flex items-center justify-center gap-1 cursor-pointer shadow-xs"
        >
          <span className="material-symbols-outlined text-lg">send</span>
          <span className="hidden sm:inline">{isHi ? 'भेजें' : 'Send'}</span>
        </button>
      </form>
    </div>
  );
};

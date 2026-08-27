import React, { useState, useEffect } from 'react';
import { Language, AppTab, SensorData, HistoryItem, LeafCheckDiagnosis, UserFarmProfile } from './types';
import { DEFAULT_SENSOR_DATA, INITIAL_HISTORY } from './data';
import { TopAppBar } from './components/TopAppBar';
import { BottomNavBar } from './components/BottomNavBar';
import { DashboardView } from './components/DashboardView';
import { LeafCheckView } from './components/LeafCheckView';
import { ChatView } from './components/ChatView';
import { HistoryView } from './components/HistoryView';
import { OnboardingModal } from './components/OnboardingModal';
import { SettingsModal } from './components/SettingsModal';
import { VoiceCallModal } from './components/VoiceCallModal';
import { WeatherModal } from './components/WeatherModal';

const DEFAULT_FARM_PROFILE: UserFarmProfile = {
  state: 'Maharashtra',
  district: 'Pune',
  soil_type: 'Black Soil (Regur)',
  irrigation: 'Drip Irrigation',
};

export default function App() {
  const [language, setLanguage] = useState<Language>('en');
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');
  const [sensorData, setSensorData] = useState<SensorData>(DEFAULT_SENSOR_DATA);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>(INITIAL_HISTORY);

  // Farm Profile State & Modals
  const [farmProfile, setFarmProfile] = useState<UserFarmProfile>(DEFAULT_FARM_PROFILE);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isVoiceCallOpen, setIsVoiceCallOpen] = useState(false);
  const [isWeatherOpen, setIsWeatherOpen] = useState(false);

  // Initialize Farm Profile from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('user_farm_profile');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.state && parsed.district && parsed.soil_type) {
          setFarmProfile(parsed);
          setIsOnboardingOpen(false);
          return;
        }
      }
      // If absent or incomplete, trigger mandatory onboarding
      setIsOnboardingOpen(true);
    } catch {
      setIsOnboardingOpen(true);
    }
  }, []);

  // Toggle Language between English and Hindi
  const handleLanguageToggle = () => {
    setLanguage((prev) => (prev === 'en' ? 'hi' : 'en'));
  };

  // Toggle Irrigation Pump
  const handleToggleWatering = () => {
    setSensorData((prev) => {
      const newWateringState = !prev.isWatering;
      const updatedMoisture = newWateringState ? Math.min(100, prev.soilMoisture + 8) : prev.soilMoisture;

      if (newWateringState) {
        const newHistoryItem: HistoryItem = {
          id: `h-${Date.now()}`,
          title: 'Manual Irrigation Started',
          titleHi: 'मैन्युअल सिंचाई प्रारंभ',
          category: 'irrigation',
          subtitle: 'Pump active • Sector 4 drip valve',
          subtitleHi: 'पंप चालू • सेक्टर 4 ड्रिप वाल्व',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          dateGroup: 'today',
          icon: 'water_drop',
          iconBgClass: 'bg-[#1b4332] text-[#86af99]',
          iconColorClass: 'text-[#86af99]',
          trendText: 'Moisture +8%',
          trendTextHi: 'नमी +8%',
          trendIcon: 'trending_up',
          trendType: 'positive',
        };

        setHistoryItems((prevHistory) => [newHistoryItem, ...prevHistory]);
      }

      return {
        ...prev,
        isWatering: newWateringState,
        soilMoisture: updatedMoisture,
        lastWateredTime: newWateringState ? 'Just now' : prev.lastWateredTime,
        lastWateredTimeHi: newWateringState ? 'अभी-अभी' : prev.lastWateredTimeHi,
      };
    });
  };

  // Add Leaf Diagnosis to history
  const handleSaveLeafCheckToHistory = (diagnosis: LeafCheckDiagnosis) => {
    const newHistoryItem: HistoryItem = {
      id: `h-${Date.now()}`,
      title: `${diagnosis.cropName} Disease Check`,
      titleHi: `${diagnosis.cropNameHi} रोग जाँच`,
      category: 'disease_check',
      subtitle: `${diagnosis.diagnosis} • Result: ${diagnosis.statusText}`,
      subtitleHi: `${diagnosis.diagnosisHi} • परिणाम: ${diagnosis.statusText}`,
      time: diagnosis.timestamp,
      dateGroup: 'today',
      icon: 'photo_camera',
      iconBgClass: diagnosis.isHealthy ? 'bg-[#1b4332] text-[#86af99]' : 'bg-[#ffdad6] text-[#ba1a1a]',
      iconColorClass: diagnosis.isHealthy ? 'text-[#86af99]' : 'text-[#ba1a1a]',
      trendText: `${diagnosis.confidence}% Confidence`,
      trendTextHi: `${diagnosis.confidence}% विश्वास`,
      trendType: diagnosis.isHealthy ? 'positive' : 'negative',
      leafDiagnosis: diagnosis,
    };

    setHistoryItems((prevHistory) => [newHistoryItem, ...prevHistory]);
  };

  const handleOnboardingComplete = (profile: UserFarmProfile) => {
    setFarmProfile(profile);
    setIsOnboardingOpen(false);
  };

  const handleProfileUpdate = (profile: UserFarmProfile) => {
    setFarmProfile(profile);
  };

  return (
    <div className="min-h-screen bg-[#fcf9f8] text-[#1c1b1b] flex flex-col font-sans selection:bg-[#c1ecd4] selection:text-[#002114]">
      {/* Top App Bar Header */}
      <TopAppBar
        language={language}
        onLanguageToggle={handleLanguageToggle}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onOpenWeather={() => setIsWeatherOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {/* Main Content Area */}
      <main className="flex-1 w-full px-4 md:px-8 pt-[80px]">
        {activeTab === 'dashboard' && (
          <DashboardView
            language={language}
            sensorData={sensorData}
            farmProfile={farmProfile}
            onToggleWatering={handleToggleWatering}
            onTabChange={setActiveTab}
            onOpenSettings={() => setIsSettingsOpen(true)}
          />
        )}

        {activeTab === 'leaf-check' && (
          <LeafCheckView
            language={language}
            onSaveToHistory={handleSaveLeafCheckToHistory}
          />
        )}

        {activeTab === 'chat' && (
          <ChatView
            language={language}
            farmProfile={farmProfile}
            sensorData={sensorData}
          />
        )}

        {activeTab === 'history' && (
          <HistoryView
            language={language}
            historyItems={historyItems}
          />
        )}
      </main>

      {/* Hands-Free Sarvam Voice Call Floating Action Button 📞 */}
      <div className="fixed bottom-20 md:bottom-8 right-5 md:right-8 z-40">
        <button
          onClick={() => setIsVoiceCallOpen(true)}
          aria-label="Hands-free Voice Call"
          title={language === 'hi' ? 'हैंड्स-फ्री वॉयस कॉल शुरू करें' : 'Start Hands-Free Voice Call'}
          className="group relative flex items-center justify-center w-16 h-16 rounded-full bg-[#1b4332] hover:bg-[#012d1d] active:scale-95 text-[#c1ecd4] shadow-2xl transition-all cursor-pointer border-2 border-emerald-400/40 hover:border-emerald-300"
        >
          {/* Animated Pulsing Ring */}
          <span className="absolute -inset-1 rounded-full bg-emerald-500/25 animate-ping group-hover:bg-emerald-500/40"></span>

          <span className="material-symbols-outlined text-3xl icon-fill relative z-10">
            call
          </span>

          {/* Tooltip on desktop hover */}
          <span className="hidden md:group-hover:inline-block absolute right-20 whitespace-nowrap bg-[#002114] text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-lg border border-emerald-500/30 animate-fadeIn">
            📞 {language === 'hi' ? 'हैंड्स-फ्री वॉयस कॉल' : 'Hands-Free Call'}
          </span>
        </button>
      </div>

      {/* Mandatory Onboarding Modal */}
      <OnboardingModal
        language={language}
        isOpen={isOnboardingOpen}
        onComplete={handleOnboardingComplete}
      />

      {/* Settings Modal (Region, Soil, Irrigation) */}
      <SettingsModal
        language={language}
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        currentProfile={farmProfile}
        onSaveProfile={handleProfileUpdate}
      />

      {/* Hands-Free Sarvam Voice Call Modal */}
      <VoiceCallModal
        language={language}
        isOpen={isVoiceCallOpen}
        onClose={() => setIsVoiceCallOpen(false)}
        farmProfile={farmProfile}
        sensorData={sensorData}
      />

      {/* Weather Forecast Modal */}
      <WeatherModal
        language={language}
        isOpen={isWeatherOpen}
        onClose={() => setIsWeatherOpen(false)}
      />

      {/* Bottom Navigation Bar (Mobile only) */}
      <BottomNavBar
        language={language}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
    </div>
  );
}

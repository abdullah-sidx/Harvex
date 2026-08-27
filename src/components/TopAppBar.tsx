import React from 'react';
import { Language, AppTab } from '../types';
import { TRANSLATIONS } from '../data';

interface TopAppBarProps {
  language: Language;
  onLanguageToggle: () => void;
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  onOpenWeather: () => void;
  onOpenSettings: () => void;
}

export const TopAppBar: React.FC<TopAppBarProps> = ({
  language,
  onLanguageToggle,
  activeTab,
  onTabChange,
  onOpenWeather,
  onOpenSettings,
}) => {
  const t = TRANSLATIONS[language];

  return (
    <header className="fixed top-0 left-0 w-full z-40 flex items-center justify-between px-4 md:px-8 h-[72px] bg-[#fcf9f8] border-b border-[#c1c8c2]">
      {/* Brand & Tractor Icon */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onTabChange('dashboard')}
          aria-label="Home"
          className="flex items-center justify-center p-2 rounded-full hover:bg-[#ebe7e7] transition-colors cursor-pointer text-[#012d1d]"
        >
          <span className="material-symbols-outlined text-2xl icon-fill">agriculture</span>
        </button>
        <span
          onClick={() => onTabChange('dashboard')}
          className="text-2xl font-bold text-[#012d1d] cursor-pointer select-none tracking-tight"
        >
          {t.appName}
        </span>
      </div>

      {/* Desktop Navigation */}
      <nav className="hidden md:flex items-center gap-2 lg:gap-3">
        <button
          onClick={() => onTabChange('dashboard')}
          className={`px-4 py-2 rounded-full text-sm font-semibold transition-all duration-150 cursor-pointer ${
            activeTab === 'dashboard'
              ? 'bg-[#1b4332] text-[#86af99]'
              : 'text-[#414844] hover:bg-[#ebe7e7]'
          }`}
        >
          {t.dashboard}
        </button>
        <button
          onClick={() => onTabChange('leaf-check')}
          className={`px-4 py-2 rounded-full text-sm font-semibold transition-all duration-150 cursor-pointer ${
            activeTab === 'leaf-check'
              ? 'bg-[#1b4332] text-[#86af99]'
              : 'text-[#414844] hover:bg-[#ebe7e7]'
          }`}
        >
          {t.leafCheck}
        </button>
        <button
          onClick={() => onTabChange('chat')}
          className={`px-4 py-2 rounded-full text-sm font-semibold transition-all duration-150 cursor-pointer ${
            activeTab === 'chat'
              ? 'bg-[#1b4332] text-[#86af99]'
              : 'text-[#414844] hover:bg-[#ebe7e7]'
          }`}
        >
          {t.chat}
        </button>
        <button
          onClick={() => onTabChange('history')}
          className={`px-4 py-2 rounded-full text-sm font-semibold transition-all duration-150 cursor-pointer ${
            activeTab === 'history'
              ? 'bg-[#1b4332] text-[#86af99]'
              : 'text-[#414844] hover:bg-[#ebe7e7]'
          }`}
        >
          {t.history}
        </button>
      </nav>

      {/* Language Switcher, Weather & Settings Trigger */}
      <div className="flex items-center gap-1.5 md:gap-2.5">
        <button
          onClick={onLanguageToggle}
          title={language === 'en' ? 'Switch to Hindi' : 'Switch to English'}
          className="flex items-center gap-1 px-3 py-1.5 bg-[#f0edec] hover:bg-[#ebe7e7] border border-[#c1c8c2] rounded-full text-xs font-bold text-[#1c1b1b] transition-all cursor-pointer shadow-xs active:scale-95"
        >
          <span className="material-symbols-outlined text-[16px] text-[#012d1d]">language</span>
          <span className="uppercase tracking-wider">{language === 'en' ? 'EN' : 'HI'}</span>
        </button>

        <button
          onClick={onOpenWeather}
          aria-label="Weather Forecast"
          title={t.weatherForecast}
          className="flex items-center justify-center p-2 rounded-full hover:bg-[#ebe7e7] transition-colors cursor-pointer text-[#012d1d]"
        >
          <span className="material-symbols-outlined text-2xl">cloud</span>
        </button>

        {/* Gear Icon for Settings */}
        <button
          onClick={onOpenSettings}
          aria-label="Farm Settings"
          title={t.settings}
          className="flex items-center justify-center p-2 rounded-full hover:bg-[#ebe7e7] transition-colors cursor-pointer text-[#012d1d]"
        >
          <span className="material-symbols-outlined text-2xl">settings</span>
        </button>
      </div>
    </header>
  );
};

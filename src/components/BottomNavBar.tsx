import React from 'react';
import { Language, AppTab } from '../types';
import { TRANSLATIONS } from '../data';

interface BottomNavBarProps {
  language: Language;
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
}

export const BottomNavBar: React.FC<BottomNavBarProps> = ({
  language,
  activeTab,
  onTabChange,
}) => {
  const t = TRANSLATIONS[language];

  return (
    <nav className="fixed bottom-0 left-0 w-full z-40 flex justify-around items-center px-2 py-2 bg-[#ffffff] border-t border-[#c1c8c2] md:hidden shadow-xs">
      {/* Dashboard Tab */}
      <button
        onClick={() => onTabChange('dashboard')}
        className={`flex flex-col items-center justify-center transition-all duration-150 ease-in-out cursor-pointer ${
          activeTab === 'dashboard'
            ? 'bg-[#1b4332] text-[#86af99] rounded-full px-4 py-1.5 opacity-90 scale-95 shadow-xs'
            : 'text-[#414844] p-1.5 hover:bg-[#ebe7e7] rounded-xl w-16'
        }`}
      >
        <span
          className={`material-symbols-outlined text-[22px] ${
            activeTab === 'dashboard' ? 'icon-fill' : ''
          }`}
        >
          home
        </span>
        <span className="font-bold text-[10px] mt-0.5 tracking-tight whitespace-nowrap">
          {t.dashboard}
        </span>
      </button>

      {/* Leaf Check Tab */}
      <button
        onClick={() => onTabChange('leaf-check')}
        className={`flex flex-col items-center justify-center transition-all duration-150 ease-in-out cursor-pointer ${
          activeTab === 'leaf-check'
            ? 'bg-[#1b4332] text-[#86af99] rounded-full px-4 py-1.5 opacity-90 scale-95 shadow-xs'
            : 'text-[#414844] p-1.5 hover:bg-[#ebe7e7] rounded-xl w-16'
        }`}
      >
        <span
          className={`material-symbols-outlined text-[22px] ${
            activeTab === 'leaf-check' ? 'icon-fill' : ''
          }`}
        >
          photo_camera
        </span>
        <span className="font-bold text-[10px] mt-0.5 tracking-tight text-center leading-tight whitespace-nowrap">
          {t.leafCheck}
        </span>
      </button>

      {/* Chat Tab */}
      <button
        onClick={() => onTabChange('chat')}
        className={`flex flex-col items-center justify-center transition-all duration-150 ease-in-out cursor-pointer ${
          activeTab === 'chat'
            ? 'bg-[#1b4332] text-[#86af99] rounded-full px-4 py-1.5 opacity-90 scale-95 shadow-xs'
            : 'text-[#414844] p-1.5 hover:bg-[#ebe7e7] rounded-xl w-16'
        }`}
      >
        <span
          className={`material-symbols-outlined text-[22px] ${
            activeTab === 'chat' ? 'icon-fill' : ''
          }`}
        >
          chat
        </span>
        <span className="font-bold text-[10px] mt-0.5 tracking-tight text-center leading-tight whitespace-nowrap">
          {t.chat}
        </span>
      </button>

      {/* History Tab */}
      <button
        onClick={() => onTabChange('history')}
        className={`flex flex-col items-center justify-center transition-all duration-150 ease-in-out cursor-pointer ${
          activeTab === 'history'
            ? 'bg-[#1b4332] text-[#86af99] rounded-full px-4 py-1.5 opacity-90 scale-95 shadow-xs'
            : 'text-[#414844] p-1.5 hover:bg-[#ebe7e7] rounded-xl w-16'
        }`}
      >
        <span
          className={`material-symbols-outlined text-[22px] ${
            activeTab === 'history' ? 'icon-fill' : ''
          }`}
        >
          history
        </span>
        <span className="font-bold text-[10px] mt-0.5 tracking-tight whitespace-nowrap">
          {t.history}
        </span>
      </button>
    </nav>
  );
};

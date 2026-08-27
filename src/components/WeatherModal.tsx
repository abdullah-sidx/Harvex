import React from 'react';
import { Language } from '../types';
import { TRANSLATIONS } from '../data';

interface WeatherModalProps {
  language: Language;
  isOpen: boolean;
  onClose: () => void;
}

export const WeatherModal: React.FC<WeatherModalProps> = ({
  language,
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  const isHi = language === 'hi';
  const t = TRANSLATIONS[language];

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 backdrop-blur-xs animate-fadeIn">
      <div className="bg-[#ffffff] border border-[#c1c8c2] rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#ffca98] text-[#7a532a] flex items-center justify-center">
              <span className="material-symbols-outlined text-2xl icon-fill">
                thunderstorm
              </span>
            </div>
            <div>
              <h3 className="font-bold text-lg text-[#1c1b1b]">
                {isHi ? 'खेत मौसम पूर्वानुमान' : 'Farm Weather Forecast'}
              </h3>
              <p className="text-xs text-[#414844]">
                {isHi ? 'सेक्टर 4 • स्थानीय स्टेशन' : 'Sector 4 • Microclimate Station'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-[#717973] hover:text-[#1c1b1b] p-1.5 rounded-full hover:bg-[#f0edec]"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Current Weather Card */}
        <div className="bg-[#f6f3f2] border border-[#c1c8c2] rounded-xl p-4 flex items-center justify-between">
          <div>
            <span className="text-3xl font-extrabold text-[#012d1d]">24°C</span>
            <p className="text-xs font-bold text-[#ba1a1a] mt-0.5 flex items-center gap-1">
              <span className="material-symbols-outlined text-sm icon-fill">thunderstorm</span>
              {isHi ? 'बारिश की 85% संभावना' : 'Rain Expected (85%)'}
            </p>
          </div>
          <div className="text-right text-xs space-y-1 text-[#414844]">
            <p>{isHi ? 'नमी: 68%' : 'Humidity: 68%'}</p>
            <p>{isHi ? 'हवा: 14 km/h दक्षिण-पश्चिम' : 'Wind: 14 km/h SW'}</p>
            <p>{isHi ? 'दाब: 1012 hPa' : 'Pressure: 1012 hPa'}</p>
          </div>
        </div>

        {/* Advisory Alert */}
        <div className="bg-[#ffdcbd] border border-[#ffca98] rounded-xl p-3.5 flex items-start gap-3 text-xs text-[#7a532a]">
          <span className="material-symbols-outlined text-xl shrink-0 icon-fill">info</span>
          <p className="leading-relaxed font-medium">
            {isHi
              ? 'स्वचालित सिंचाई प्रणाली ने आगामी वर्षा के कारण पानी का छिड़काव रोक दिया है, जिससे 1,400 लीटर जल की बचत हुई।'
              : 'Smart irrigation automated valve paused cycle due to impending precipitation, conserving 1,400L of farm groundwater.'}
          </p>
        </div>

        {/* 3-Day Outlook */}
        <div className="space-y-2">
          <h4 className="text-xs font-bold text-[#414844] uppercase tracking-wider">
            {isHi ? '3-दिवसीय पूर्वानुमान' : '3-Day Outlook'}
          </h4>

          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="bg-[#ffffff] border border-[#c1c8c2] rounded-lg p-2.5">
              <span className="font-bold text-[#1c1b1b]">{isHi ? 'आज' : 'Today'}</span>
              <span className="material-symbols-outlined text-[#ba1a1a] block my-1 icon-fill">
                thunderstorm
              </span>
              <span className="font-bold text-[#012d1d]">24° / 19°</span>
            </div>

            <div className="bg-[#ffffff] border border-[#c1c8c2] rounded-lg p-2.5">
              <span className="font-bold text-[#1c1b1b]">{isHi ? 'कल' : 'Tomorrow'}</span>
              <span className="material-symbols-outlined text-[#012d1d] block my-1">
                rainy
              </span>
              <span className="font-bold text-[#012d1d]">26° / 18°</span>
            </div>

            <div className="bg-[#ffffff] border border-[#c1c8c2] rounded-lg p-2.5">
              <span className="font-bold text-[#1c1b1b]">{isHi ? 'परसों' : 'Day After'}</span>
              <span className="material-symbols-outlined text-amber-600 block my-1 icon-fill">
                sunny
              </span>
              <span className="font-bold text-[#012d1d]">28° / 20°</span>
            </div>
          </div>
        </div>

        {/* Action Button */}
        <div className="flex justify-end pt-2">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-[#012d1d] text-white font-bold rounded-lg text-xs hover:bg-[#1b4332] transition-colors"
          >
            {isHi ? 'ठीक है' : 'Got it'}
          </button>
        </div>
      </div>
    </div>
  );
};

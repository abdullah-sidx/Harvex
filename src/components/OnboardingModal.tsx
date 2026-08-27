import React, { useState } from 'react';
import { Language, UserFarmProfile } from '../types';
import { TRANSLATIONS, INDIAN_STATES_DISTRICTS, SOIL_TYPES, IRRIGATION_TYPES } from '../data';

interface OnboardingModalProps {
  language: Language;
  isOpen: boolean;
  onComplete: (profile: UserFarmProfile) => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  language,
  isOpen,
  onComplete,
}) => {
  const isHi = language === 'hi';

  const [state, setState] = useState('Maharashtra');
  const [district, setDistrict] = useState('Pune');
  const [soilType, setSoilType] = useState('Black Soil (Regur)');
  const [irrigation, setIrrigation] = useState('Drip Irrigation');

  if (!isOpen) return null;

  const availableDistricts = INDIAN_STATES_DISTRICTS[state] || ['Default District'];

  const handleStateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newState = e.target.value;
    setState(newState);
    const newDistricts = INDIAN_STATES_DISTRICTS[newState] || [];
    setDistrict(newDistricts[0] || '');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!state || !district || !soilType) return;

    const profile: UserFarmProfile = {
      state,
      district,
      soil_type: soilType,
      irrigation,
    };

    localStorage.setItem('user_farm_profile', JSON.stringify(profile));
    onComplete(profile);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-lg bg-[#ffffff] border border-[#c1c8c2] rounded-2xl p-6 md:p-8 shadow-2xl space-y-6">
        {/* Header with Agriculture Icon */}
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-[#c1ecd4] flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-3xl text-[#002114] icon-fill">
              agriculture
            </span>
          </div>
          <div>
            <h2 className="text-2xl md:text-3xl font-extrabold text-[#012d1d] tracking-tight">
              {isHi ? 'खेत का सेटअप' : 'Farm Profile Setup'}
            </h2>
            <p className="text-xs md:text-sm text-[#414844] mt-0.5">
              {isHi
                ? 'सटीक मौसमी फसल और सिंचाई अनुशंसाओं के लिए अपना क्षेत्र चुनें।'
                : 'Configure your region & soil for customized AI agronomy recommendations.'}
            </p>
          </div>
        </div>

        {/* Required Notice */}
        <div className="p-3 bg-[#f0edec] border-l-4 border-[#012d1d] rounded-r-lg text-xs font-semibold text-[#414844]">
          {isHi
            ? '⚠️ आगे बढ़ने से पहले राज्य, जिला और मिट्टी का प्रकार चुनना अनिवार्य है।'
            : '⚠️ Selecting state, district, and soil type is required before continuing.'}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* State Selector */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[#414844] mb-1.5">
              {isHi ? 'राज्य (State) *' : 'State *'}
            </label>
            <select
              value={state}
              onChange={handleStateChange}
              required
              className="w-full h-12 px-3.5 bg-[#fcf9f8] border border-[#c1c8c2] rounded-xl text-sm font-bold text-[#1c1b1b] focus:border-[#012d1d] focus:outline-hidden transition-all shadow-xs"
            >
              {Object.keys(INDIAN_STATES_DISTRICTS).map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>

          {/* District Selector */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[#414844] mb-1.5">
              {isHi ? 'जिला (District) *' : 'District *'}
            </label>
            <select
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
              required
              className="w-full h-12 px-3.5 bg-[#fcf9f8] border border-[#c1c8c2] rounded-xl text-sm font-bold text-[#1c1b1b] focus:border-[#012d1d] focus:outline-hidden transition-all shadow-xs"
            >
              {availableDistricts.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          {/* Soil Type Selector */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[#414844] mb-1.5">
              {isHi ? 'मिट्टी का प्रकार (Soil Type) *' : 'Soil Type *'}
            </label>
            <select
              value={soilType}
              onChange={(e) => setSoilType(e.target.value)}
              required
              className="w-full h-12 px-3.5 bg-[#fcf9f8] border border-[#c1c8c2] rounded-xl text-sm font-bold text-[#1c1b1b] focus:border-[#012d1d] focus:outline-hidden transition-all shadow-xs"
            >
              {SOIL_TYPES.map((s) => (
                <option key={s.value} value={s.value}>
                  {isHi ? s.labelHi : s.labelEn}
                </option>
              ))}
            </select>
          </div>

          {/* Irrigation Method Selector */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[#414844] mb-1.5">
              {isHi ? 'सिंचाई प्रणाली (Irrigation)' : 'Irrigation Infrastructure'}
            </label>
            <select
              value={irrigation}
              onChange={(e) => setIrrigation(e.target.value)}
              className="w-full h-12 px-3.5 bg-[#fcf9f8] border border-[#c1c8c2] rounded-xl text-sm font-bold text-[#1c1b1b] focus:border-[#012d1d] focus:outline-hidden transition-all shadow-xs"
            >
              {IRRIGATION_TYPES.map((i) => (
                <option key={i.value} value={i.value}>
                  {isHi ? i.labelHi : i.labelEn}
                </option>
              ))}
            </select>
          </div>

          {/* Submit Button */}
          <div className="pt-2">
            <button
              type="submit"
              className="w-full h-13 bg-[#1b4332] hover:bg-[#012d1d] active:scale-[0.99] text-[#c1ecd4] font-extrabold text-base rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md"
            >
              <span className="material-symbols-outlined">check_circle</span>
              <span>{isHi ? 'सहेजें और आगे बढ़ें' : 'Save & Continue'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

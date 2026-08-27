import React, { useState, useEffect } from 'react';
import { Language, UserFarmProfile } from '../types';
import { TRANSLATIONS, INDIAN_STATES_DISTRICTS, SOIL_TYPES, IRRIGATION_TYPES } from '../data';

interface SettingsModalProps {
  language: Language;
  isOpen: boolean;
  onClose: () => void;
  currentProfile: UserFarmProfile;
  onSaveProfile: (profile: UserFarmProfile) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  language,
  isOpen,
  onClose,
  currentProfile,
  onSaveProfile,
}) => {
  const isHi = language === 'hi';

  const [state, setState] = useState(currentProfile.state || 'Maharashtra');
  const [district, setDistrict] = useState(currentProfile.district || 'Pune');
  const [soilType, setSoilType] = useState(currentProfile.soil_type || 'Black Soil (Regur)');
  const [irrigation, setIrrigation] = useState(currentProfile.irrigation || 'Drip Irrigation');
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setState(currentProfile.state || 'Maharashtra');
      setDistrict(currentProfile.district || 'Pune');
      setSoilType(currentProfile.soil_type || 'Black Soil (Regur)');
      setIrrigation(currentProfile.irrigation || 'Drip Irrigation');
      setSavedSuccess(false);
    }
  }, [isOpen, currentProfile]);

  if (!isOpen) return null;

  const availableDistricts = INDIAN_STATES_DISTRICTS[state] || ['Default District'];

  const handleStateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newState = e.target.value;
    setState(newState);
    const newDistricts = INDIAN_STATES_DISTRICTS[newState] || [];
    setDistrict(newDistricts[0] || '');
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const updated: UserFarmProfile = {
      state,
      district,
      soil_type: soilType,
      irrigation,
    };

    localStorage.setItem('user_farm_profile', JSON.stringify(updated));
    onSaveProfile(updated);
    setSavedSuccess(true);
    setTimeout(() => {
      onClose();
    }, 900);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-lg bg-[#ffffff] border border-[#c1c8c2] rounded-2xl p-6 md:p-8 shadow-2xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-3xl text-[#012d1d]">settings</span>
            <h2 className="text-2xl font-bold text-[#012d1d] tracking-tight">
              {isHi ? 'फार्म प्रोफाइल एवं सेटिंग्स' : 'Farm Profile & Settings'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-[#ebe7e7] text-[#414844] transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {savedSuccess && (
          <div className="p-3 bg-[#c1ecd4] text-[#002114] rounded-xl text-xs md:text-sm font-bold flex items-center gap-2 animate-fadeIn">
            <span className="material-symbols-outlined text-lg">check_circle</span>
            <span>
              {isHi ? 'विवरण सफलतापूर्वक सहेज लिया गया!' : 'Farm profile updated successfully!'}
            </span>
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-4">
          {/* State */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[#414844] mb-1.5">
              {isHi ? 'राज्य (State)' : 'State'}
            </label>
            <select
              value={state}
              onChange={handleStateChange}
              className="w-full h-11 px-3.5 bg-[#fcf9f8] border border-[#c1c8c2] rounded-xl text-sm font-bold text-[#1c1b1b] focus:border-[#012d1d] focus:outline-hidden transition-all shadow-xs"
            >
              {Object.keys(INDIAN_STATES_DISTRICTS).map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>

          {/* District */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[#414844] mb-1.5">
              {isHi ? 'जिला (District)' : 'District'}
            </label>
            <select
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
              className="w-full h-11 px-3.5 bg-[#fcf9f8] border border-[#c1c8c2] rounded-xl text-sm font-bold text-[#1c1b1b] focus:border-[#012d1d] focus:outline-hidden transition-all shadow-xs"
            >
              {availableDistricts.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          {/* Soil Type */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[#414844] mb-1.5">
              {isHi ? 'मिट्टी का प्रकार (Soil Type)' : 'Soil Type'}
            </label>
            <select
              value={soilType}
              onChange={(e) => setSoilType(e.target.value)}
              className="w-full h-11 px-3.5 bg-[#fcf9f8] border border-[#c1c8c2] rounded-xl text-sm font-bold text-[#1c1b1b] focus:border-[#012d1d] focus:outline-hidden transition-all shadow-xs"
            >
              {SOIL_TYPES.map((s) => (
                <option key={s.value} value={s.value}>
                  {isHi ? s.labelHi : s.labelEn}
                </option>
              ))}
            </select>
          </div>

          {/* Irrigation */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[#414844] mb-1.5">
              {isHi ? 'सिंचाई प्रणाली (Irrigation Method)' : 'Irrigation Infrastructure'}
            </label>
            <select
              value={irrigation}
              onChange={(e) => setIrrigation(e.target.value)}
              className="w-full h-11 px-3.5 bg-[#fcf9f8] border border-[#c1c8c2] rounded-xl text-sm font-bold text-[#1c1b1b] focus:border-[#012d1d] focus:outline-hidden transition-all shadow-xs"
            >
              {IRRIGATION_TYPES.map((i) => (
                <option key={i.value} value={i.value}>
                  {isHi ? i.labelHi : i.labelEn}
                </option>
              ))}
            </select>
          </div>

          {/* Buttons */}
          <div className="flex items-center gap-3 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-12 bg-[#f0edec] hover:bg-[#ebe7e7] text-[#1c1b1b] font-bold text-sm rounded-xl transition-all cursor-pointer"
            >
              {isHi ? 'रद्द करें' : 'Cancel'}
            </button>
            <button
              type="submit"
              className="flex-1 h-12 bg-[#1b4332] hover:bg-[#012d1d] text-[#c1ecd4] font-bold text-sm rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
            >
              <span className="material-symbols-outlined text-[18px]">save</span>
              <span>{isHi ? 'सहेजें' : 'Save Changes'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

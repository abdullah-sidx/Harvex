import React, { useState, useEffect } from 'react';
import { Language, SensorData, AppTab, UserFarmProfile, CropRecommendation } from '../types';
import { TRANSLATIONS } from '../data';

interface DashboardViewProps {
  language: Language;
  sensorData: SensorData;
  farmProfile: UserFarmProfile;
  onToggleWatering: () => void;
  onTabChange: (tab: AppTab) => void;
  onOpenSettings: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  language,
  sensorData,
  farmProfile,
  onToggleWatering,
  onTabChange,
  onOpenSettings,
}) => {
  const t = TRANSLATIONS[language];
  const isHi = language === 'hi';
  const [showSensorDetails, setShowSensorDetails] = useState(false);

  // Seasonal Crop Recommendations State
  const [cropRecommendations, setCropRecommendations] = useState<CropRecommendation[]>([]);
  const [seasonName, setSeasonName] = useState<string>('Rabi (Winter Season / रबी)');
  const [isLoadingCrops, setIsLoadingCrops] = useState(false);

  // Fetch seasonal crop recommendations from backend
  const fetchCropRecommendations = async () => {
    setIsLoadingCrops(true);
    try {
      const endpoint = 'http://localhost:8000/api/recommend-crops';
      let res: Response;

      const payload = {
        farm_profile: farmProfile,
        language: isHi ? 'hi' : 'en',
      };

      try {
        res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch {
        res = await fetch('/api/recommend-crops', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      if (res.ok) {
        const data = await res.json();
        setSeasonName(data.season || 'Rabi Season');
        setCropRecommendations(data.crops || []);
      }
    } catch (err) {
      console.warn('Failed to fetch crop recommendations:', err);
    } finally {
      setIsLoadingCrops(false);
    }
  };

  useEffect(() => {
    fetchCropRecommendations();
  }, [farmProfile, language]);

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6 pb-24 md:pb-12 pt-4">
      {/* 1. Farm Geography Banner */}
      <section className="bg-gradient-to-r from-[#1b4332] to-[#012d1d] text-[#c1ecd4] rounded-2xl p-5 md:p-6 shadow-md flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-[#c1ecd4]/15 flex items-center justify-center text-white">
            <span className="material-symbols-outlined text-2xl icon-fill">pin_drop</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl md:text-2xl font-bold text-white tracking-tight">
                {farmProfile.district || 'Pune'}, {farmProfile.state || 'Maharashtra'}
              </span>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#c1ecd4]/20 text-[#c1ecd4] font-semibold">
                {farmProfile.soil_type || 'Black Soil'}
              </span>
            </div>
            <p className="text-xs text-[#c1ecd4]/80 mt-0.5">
              {isHi ? 'सिंचाई प्रणाली: ' : 'Irrigation: '}
              <span className="font-semibold text-white">{farmProfile.irrigation || 'Drip'}</span>
            </p>
          </div>
        </div>

        <button
          onClick={onOpenSettings}
          className="px-3.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer"
        >
          <span className="material-symbols-outlined text-sm">settings</span>
          <span>{isHi ? 'प्रोफाइल बदलें' : 'Edit Profile'}</span>
        </button>
      </section>

      {/* 2. Crop Health Card */}
      <section className="bg-[#ffffff] border border-[#c1c8c2] rounded-xl p-6 shadow-xs hover:border-[#717973] transition-all">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold text-[#414844] uppercase tracking-wider">
            {t.cropHealth}
          </h2>
          <button
            onClick={() => onTabChange('leaf-check')}
            className="text-xs font-semibold text-[#012d1d] hover:underline flex items-center gap-1 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">photo_camera</span>
            <span>{isHi ? 'पत्ती स्कैन करें' : 'Scan Leaf'}</span>
          </button>
        </div>

        <div className="flex items-center gap-5 mt-4">
          <div className="w-16 h-16 rounded-full bg-[#c1ecd4] flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[#274e3d] text-4xl icon-fill">
              eco
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-2xl md:text-3xl font-bold text-[#012d1d] tracking-tight">
              {isHi ? sensorData.cropHealthLabelHi : sensorData.cropHealthLabel}
            </span>
            <span className="text-sm md:text-base font-semibold text-[#414844] mt-0.5">
              {isHi ? sensorData.cropHealthSubtitleHi : sensorData.cropHealthSubtitle}
            </span>
          </div>
        </div>
      </section>

      {/* 3. Irrigation Status & Rain Warning Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Irrigation Status Card */}
        <section className="bg-[#ffffff] border border-[#c1c8c2] rounded-xl p-6 flex flex-col justify-between shadow-xs">
          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold text-[#414844] uppercase tracking-wider">
                {t.irrigationStatus}
              </h2>
              <button
                onClick={onToggleWatering}
                className={`text-xs px-2.5 py-1 rounded-full font-bold transition-all cursor-pointer ${
                  sensorData.isWatering
                    ? 'bg-[#ba1a1a] text-white hover:bg-red-700'
                    : 'bg-[#1b4332] text-[#c1ecd4] hover:bg-[#012d1d]'
                }`}
              >
                {sensorData.isWatering ? t.stopWatering : t.startWatering}
              </button>
            </div>

            <div className="flex items-center gap-3 mt-3">
              <span
                className={`material-symbols-outlined text-3xl icon-fill ${
                  sensorData.isWatering ? 'text-blue-600 animate-pulse' : 'text-[#012d1d]'
                }`}
              >
                water_drop
              </span>
              <span className="text-xl md:text-2xl font-bold text-[#1c1b1b]">
                {sensorData.isWatering
                  ? isHi
                    ? 'सिंचाई चालू है (पंप ऑन)'
                    : 'Watering active (Pump ON)'
                  : t.notWatering}
              </span>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-[#f0edec]">
            <span className="text-xs md:text-sm font-semibold text-[#414844] flex items-center gap-1.5">
              <span className="material-symbols-outlined text-base">history</span>
              {sensorData.isWatering
                ? isHi
                  ? 'वर्तमान में चालू है'
                  : 'Currently in progress'
                : isHi
                ? `आखिरी सिंचाई: ${sensorData.lastWateredTimeHi}`
                : `Last watered: ${sensorData.lastWateredTime}`}
            </span>
          </div>
        </section>

        {/* Rain Warning Card */}
        <section className="bg-[#ffffff] border border-[#c1c8c2] rounded-xl p-6 flex flex-col justify-center border-l-4 border-l-[#ffdcbd] shadow-xs">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-[#ffca98] rounded-full text-[#7a532a] shrink-0">
              <span className="material-symbols-outlined text-2xl icon-fill">
                thunderstorm
              </span>
            </div>
            <div>
              <h2 className="text-xs font-bold text-[#1c1b1b] uppercase tracking-wider">
                {t.rainExpected}
              </h2>
              <p className="text-sm md:text-base text-[#414844] mt-1 leading-relaxed">
                {t.rainExpectedDesc}
              </p>
            </div>
          </div>
        </section>
      </div>

      {/* 4. Seasonal Crop Recommendations Engine */}
      <section className="bg-[#ffffff] border border-[#c1c8c2] rounded-2xl p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg md:text-xl font-bold text-[#012d1d] tracking-tight">
                {t.cropRecommendations}
              </h2>
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-[#c1ecd4] text-[#002114]">
                {seasonName}
              </span>
            </div>
            <p className="text-xs text-[#414844] mt-0.5">
              {t.recommendedCropsDesc}
            </p>
          </div>

          <button
            onClick={fetchCropRecommendations}
            disabled={isLoadingCrops}
            className="flex items-center gap-1 text-xs font-bold text-[#012d1d] bg-[#f0edec] hover:bg-[#e5e2e1] px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
          >
            <span className={`material-symbols-outlined text-[16px] ${isLoadingCrops ? 'animate-spin' : ''}`}>
              sync
            </span>
            <span>{isHi ? 'ताज़ा करें' : 'Refresh'}</span>
          </button>
        </div>

        {/* Crops Grid */}
        {isLoadingCrops ? (
          <div className="py-12 flex flex-col items-center justify-center gap-3 text-center">
            <div className="w-10 h-10 border-3 border-[#c1ecd4] border-t-[#012d1d] rounded-full animate-spin"></div>
            <span className="text-xs font-bold text-[#012d1d]">
              {isHi ? 'मिट्टी और मौसम के अनुसार फसलें खोजी जा रही हैं...' : 'Querying Gemini Agronomy Engine...'}
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            {cropRecommendations.map((crop, idx) => (
              <div
                key={idx}
                className="bg-[#fcf9f8] border border-[#c1c8c2] hover:border-[#012d1d] rounded-xl p-4.5 flex flex-col justify-between transition-all shadow-xs hover:shadow-md"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="material-symbols-outlined text-[#012d1d] text-2xl icon-fill">
                      spa
                    </span>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-[#c1ecd4] text-[#002114]">
                      # {idx + 1}
                    </span>
                  </div>

                  <h3 className="text-base font-bold text-[#1c1b1b]">
                    {isHi && crop.name_hi ? crop.name_hi : crop.name}
                  </h3>
                  {crop.name_hi && !isHi && (
                    <span className="text-xs text-[#414844] font-medium">{crop.name_hi}</span>
                  )}

                  <div className="mt-3 space-y-2 text-xs">
                    <div className="flex items-start gap-1.5">
                      <span className="material-symbols-outlined text-[16px] text-green-700 shrink-0">
                        trending_up
                      </span>
                      <div>
                        <span className="font-bold text-[#414844]">{t.expectedYield}: </span>
                        <span className="text-[#1c1b1b] font-semibold">
                          {isHi && crop.expected_yield_hi ? crop.expected_yield_hi : crop.expected_yield}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-start gap-1.5">
                      <span className="material-symbols-outlined text-[16px] text-blue-600 shrink-0">
                        water_drop
                      </span>
                      <div>
                        <span className="font-bold text-[#414844]">{t.idealWater}: </span>
                        <span className="text-[#1c1b1b] font-semibold">
                          {isHi && crop.ideal_water_hi ? crop.ideal_water_hi : crop.ideal_water}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-[#c1c8c2]/50 text-[11px] text-[#414844] leading-relaxed">
                  <span className="font-bold text-[#012d1d]">{t.whySuitable}: </span>
                  <span>{isHi && crop.reason_hi ? crop.reason_hi : crop.reason}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 5. Field Sensors Section */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold text-[#414844] uppercase tracking-wider">
            {t.fieldSensors}
          </h2>
          <button
            onClick={() => setShowSensorDetails(!showSensorDetails)}
            className="text-xs text-[#012d1d] font-semibold hover:underline cursor-pointer"
          >
            {showSensorDetails
              ? isHi ? 'कम दिखाएं' : 'Less Sensors'
              : isHi ? 'विस्तृत सेंसर' : 'Extended Telemetry'}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Soil Moisture */}
          <div className="bg-[#ffffff] border border-[#c1c8c2] rounded-xl p-6 flex flex-col justify-between shadow-xs">
            <div className="flex items-center gap-2 mb-2 text-[#414844]">
              <span className="material-symbols-outlined text-xl">grass</span>
              <span className="text-xs font-bold uppercase tracking-wider">{t.soilMoisture}</span>
            </div>
            <div className="my-2">
              <span className="text-4xl font-bold text-[#012d1d] tracking-tight">
                {sensorData.soilMoisture}%
              </span>
            </div>
            <div className="w-full bg-[#e5e2e1] h-2.5 rounded-full overflow-hidden mt-1">
              <div
                className="bg-[#012d1d] h-2.5 rounded-full transition-all duration-500"
                style={{ width: `${sensorData.soilMoisture}%` }}
              ></div>
            </div>
          </div>

          {/* Temperature */}
          <div className="bg-[#ffffff] border border-[#c1c8c2] rounded-xl p-6 flex flex-col justify-between shadow-xs">
            <div className="flex items-center gap-2 mb-2 text-[#414844]">
              <span className="material-symbols-outlined text-xl">thermostat</span>
              <span className="text-xs font-bold uppercase tracking-wider">{t.temperature}</span>
            </div>
            <div className="my-2">
              <span className="text-4xl font-bold text-[#012d1d] tracking-tight">
                {sensorData.temperature}°C
              </span>
            </div>
            <div>
              <span className="inline-block text-xs font-bold px-2 py-0.5 rounded-md bg-[#c1ecd4] text-[#274e3d]">
                {t.optimal}
              </span>
            </div>
          </div>

          {/* Humidity */}
          <div className="bg-[#ffffff] border border-[#c1c8c2] rounded-xl p-6 flex flex-col justify-between shadow-xs">
            <div className="flex items-center gap-2 mb-2 text-[#414844]">
              <span className="material-symbols-outlined text-xl">water</span>
              <span className="text-xs font-bold uppercase tracking-wider">{t.humidity}</span>
            </div>
            <div className="my-2">
              <span className="text-4xl font-bold text-[#012d1d] tracking-tight">
                {sensorData.humidity}%
              </span>
            </div>
            <div className="w-full bg-[#e5e2e1] h-2.5 rounded-full overflow-hidden mt-1">
              <div
                className="bg-[#012d1d] h-2.5 rounded-full transition-all duration-500"
                style={{ width: `${sensorData.humidity}%` }}
              ></div>
            </div>
          </div>
        </div>

        {/* Extended Telemetry Grid if toggled */}
        {showSensorDetails && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4 animate-fadeIn">
            <div className="bg-[#f6f3f2] border border-[#c1c8c2] rounded-xl p-4">
              <span className="text-xs font-bold text-[#414844]">
                {isHi ? 'मिट्टी का pH स्तर' : 'Soil pH Level'}
              </span>
              <p className="text-2xl font-bold text-[#012d1d] mt-1">6.5 pH</p>
              <span className="text-[11px] text-green-800 font-medium">
                {isHi ? 'उचित अम्लीय संतुलन' : 'Ideal Neutral-Acidic'}
              </span>
            </div>

            <div className="bg-[#f6f3f2] border border-[#c1c8c2] rounded-xl p-4">
              <span className="text-xs font-bold text-[#414844]">
                {isHi ? 'NPK उर्वरक संतुलन' : 'NPK Nutrients'}
              </span>
              <p className="text-2xl font-bold text-[#012d1d] mt-1">45 : 20 : 30</p>
              <span className="text-[11px] text-[#414844]">N-P-K (mg/kg)</span>
            </div>

            <div className="bg-[#f6f3f2] border border-[#c1c8c2] rounded-xl p-4">
              <span className="text-xs font-bold text-[#414844]">
                {isHi ? 'सौर विकिरण (Solar Flux)' : 'Solar Flux (PAR)'}
              </span>
              <p className="text-2xl font-bold text-[#012d1d] mt-1">780 W/m²</p>
              <span className="text-[11px] text-amber-800 font-medium">
                {isHi ? 'सक्रिय प्रकाश संश्लेषण' : 'Active Photosynthesis'}
              </span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};

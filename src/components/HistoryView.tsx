import React, { useState } from 'react';
import { Language, HistoryItem, HistoryCategory } from '../types';
import { TRANSLATIONS } from '../data';

interface HistoryViewProps {
  language: Language;
  historyItems: HistoryItem[];
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  language,
  historyItems,
}) => {
  const t = TRANSLATIONS[language];
  const isHi = language === 'hi';

  const [selectedCategory, setSelectedCategory] = useState<HistoryCategory>('all');
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [selectedItem, setSelectedItem] = useState<HistoryItem | null>(null);

  // Filter items
  const filteredItems = historyItems.filter((item) => {
    if (selectedCategory === 'all') return true;
    return item.category === selectedCategory;
  });

  const todayItems = filteredItems.filter((item) => item.dateGroup === 'today');
  const yesterdayItems = filteredItems.filter((item) => item.dateGroup === 'yesterday');

  const categories: { id: HistoryCategory; label: string }[] = [
    { id: 'all', label: t.all },
    { id: 'irrigation', label: t.irrigation },
    { id: 'disease_check', label: t.diseaseChecks },
    { id: 'alert', label: t.alerts },
    { id: 'operation', label: t.operations },
  ];

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6 pb-24 md:pb-12 pt-4">
      {/* Top Title & Filter Button */}
      <div className="flex items-center justify-between relative">
        <h1 className="text-3xl md:text-4xl font-bold text-[#1c1b1b] tracking-tight">
          {t.history}
        </h1>

        <div className="relative">
          <button
            onClick={() => setShowFilterMenu(!showFilterMenu)}
            className="flex items-center gap-2 bg-[#e5e2e1] hover:bg-[#dcd9d9] rounded-full px-4 py-2 text-[#414844] cursor-pointer transition-colors h-11 shadow-xs active:scale-95"
          >
            <span className="material-symbols-outlined text-[20px]">filter_list</span>
            <span className="font-bold text-xs md:text-sm">{t.filter}</span>
            {selectedCategory !== 'all' && (
              <span className="w-2 h-2 rounded-full bg-[#012d1d]"></span>
            )}
          </button>

          {/* Filter Dropdown Menu */}
          {showFilterMenu && (
            <div className="absolute right-0 top-13 z-30 w-48 bg-[#ffffff] border border-[#c1c8c2] rounded-xl shadow-lg p-1.5 animate-fadeIn">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => {
                    setSelectedCategory(cat.id);
                    setShowFilterMenu(false);
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs md:text-sm font-semibold transition-colors flex items-center justify-between ${
                    selectedCategory === cat.id
                      ? 'bg-[#1b4332] text-[#86af99]'
                      : 'text-[#1c1b1b] hover:bg-[#f6f3f2]'
                  }`}
                >
                  <span>{cat.label}</span>
                  {selectedCategory === cat.id && (
                    <span className="material-symbols-outlined text-[16px]">check</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Group: TODAY */}
      {todayItems.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-bold text-[#414844] uppercase tracking-wider pl-1">
            {t.today}
          </h2>

          <div className="space-y-2.5">
            {todayItems.map((item) => (
              <div
                key={item.id}
                onClick={() => setSelectedItem(item)}
                className="bg-[#ffffff] border border-[#c1c8c2] rounded-xl p-4 flex items-center justify-between min-h-[68px] hover:bg-[#f6f3f2] hover:border-[#717973] transition-all cursor-pointer shadow-xs active:scale-[0.99]"
              >
                <div className="flex items-center gap-4">
                  <div
                    className={`${item.iconBgClass} rounded-full w-12 h-12 flex items-center justify-center shrink-0 shadow-xs`}
                  >
                    <span className="material-symbols-outlined text-2xl icon-fill">
                      {item.icon}
                    </span>
                  </div>
                  <div>
                    <p className="font-bold text-sm md:text-base text-[#1c1b1b]">
                      {isHi ? item.titleHi : item.title}
                    </p>
                    <p className="text-xs md:text-sm text-[#414844] mt-0.5">
                      {isHi ? item.subtitleHi : item.subtitle}
                    </p>
                  </div>
                </div>

                <div className="text-right flex flex-col items-end shrink-0 pl-2">
                  <span className="text-xs font-semibold text-[#414844]">{item.time}</span>
                  {item.trendText && (
                    <div
                      className={`flex items-center text-xs font-bold mt-1 ${
                        item.trendType === 'negative' ? 'text-[#ba1a1a]' : 'text-[#012d1d]'
                      }`}
                    >
                      <span className="material-symbols-outlined text-sm mr-0.5">
                        {item.trendIcon || 'trending_up'}
                      </span>
                      <span>{isHi ? item.trendTextHi || item.trendText : item.trendText}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Group: YESTERDAY */}
      {yesterdayItems.length > 0 && (
        <div className="space-y-3 pt-2">
          <h2 className="text-xs font-bold text-[#414844] uppercase tracking-wider pl-1">
            {t.yesterday}
          </h2>

          <div className="space-y-2.5">
            {yesterdayItems.map((item) => (
              <div
                key={item.id}
                onClick={() => setSelectedItem(item)}
                className="bg-[#ffffff] border border-[#c1c8c2] rounded-xl p-4 flex items-center justify-between min-h-[68px] hover:bg-[#f6f3f2] hover:border-[#717973] transition-all cursor-pointer shadow-xs active:scale-[0.99]"
              >
                <div className="flex items-center gap-4">
                  <div
                    className={`${item.iconBgClass} rounded-full w-12 h-12 flex items-center justify-center shrink-0 shadow-xs`}
                  >
                    <span className="material-symbols-outlined text-2xl icon-fill">
                      {item.icon}
                    </span>
                  </div>
                  <div>
                    <p className="font-bold text-sm md:text-base text-[#1c1b1b]">
                      {isHi ? item.titleHi : item.title}
                    </p>
                    <p className="text-xs md:text-sm text-[#414844] mt-0.5">
                      {isHi ? item.subtitleHi : item.subtitle}
                    </p>
                  </div>
                </div>

                <div className="text-right flex flex-col items-end shrink-0 pl-2">
                  <span className="text-xs font-semibold text-[#414844]">{item.time}</span>
                  {item.trendText && (
                    <div
                      className={`flex items-center text-xs font-bold mt-1 ${
                        item.trendType === 'negative' ? 'text-[#ba1a1a]' : 'text-[#012d1d]'
                      }`}
                    >
                      <span className="material-symbols-outlined text-sm mr-0.5">
                        {item.trendIcon || 'trending_down'}
                      </span>
                      <span>{isHi ? item.trendTextHi || item.trendText : item.trendText}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty Filter State */}
      {filteredItems.length === 0 && (
        <div className="bg-[#ffffff] border border-[#c1c8c2] rounded-xl p-8 text-center text-[#414844]">
          <span className="material-symbols-outlined text-4xl mb-2 text-[#717973]">
            event_busy
          </span>
          <p className="font-bold text-base">
            {isHi ? 'कोई रिकॉर्ड नहीं मिला' : 'No records found for this category'}
          </p>
          <button
            onClick={() => setSelectedCategory('all')}
            className="mt-3 text-xs font-bold text-[#012d1d] hover:underline"
          >
            {isHi ? 'सभी रिकॉर्ड देखें' : 'View all records'}
          </button>
        </div>
      )}

      {/* Item Detail Modal */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 backdrop-blur-xs animate-fadeIn">
          <div className="bg-[#ffffff] border border-[#c1c8c2] rounded-2xl p-6 max-w-md w-full shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`${selectedItem.iconBgClass} p-3 rounded-full`}>
                  <span className="material-symbols-outlined text-2xl icon-fill">
                    {selectedItem.icon}
                  </span>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-[#1c1b1b]">
                    {isHi ? selectedItem.titleHi : selectedItem.title}
                  </h3>
                  <span className="text-xs text-[#414844]">{selectedItem.time}</span>
                </div>
              </div>
              <button
                onClick={() => setSelectedItem(null)}
                className="text-[#717973] hover:text-[#1c1b1b] p-1 rounded-full hover:bg-[#f6f3f2]"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="bg-[#f6f3f2] p-4 rounded-xl space-y-2 text-sm text-[#1c1b1b]">
              <p className="font-medium">
                {isHi ? selectedItem.subtitleHi : selectedItem.subtitle}
              </p>
              {selectedItem.trendText && (
                <p
                  className={`text-xs font-bold ${
                    selectedItem.trendType === 'negative' ? 'text-[#ba1a1a]' : 'text-[#012d1d]'
                  }`}
                >
                  {isHi ? selectedItem.trendTextHi || selectedItem.trendText : selectedItem.trendText}
                </p>
              )}
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setSelectedItem(null)}
                className="px-4 py-2 bg-[#012d1d] text-white rounded-lg text-xs font-bold hover:bg-[#1b4332] transition-colors"
              >
                {isHi ? 'बंद करें' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

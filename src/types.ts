export type Language = 'en' | 'hi';

export type AppTab = 'dashboard' | 'leaf-check' | 'chat' | 'history';

export type HistoryCategory = 'all' | 'irrigation' | 'disease_check' | 'alert' | 'operation';

export interface UserFarmProfile {
  state: string;
  district: string;
  soil_type: string;
  irrigation: string;
}

export interface CropRecommendation {
  name: string;
  name_hi?: string;
  expected_yield: string;
  expected_yield_hi?: string;
  ideal_water: string;
  ideal_water_hi?: string;
  reason: string;
  reason_hi?: string;
}

export interface CropRecommendationData {
  season: string;
  crops: CropRecommendation[];
}

export interface SensorData {
  soilMoisture: number;
  temperature: number;
  humidity: number;
  isWatering: boolean;
  lastWateredTime: string;
  lastWateredTimeHi: string;
  rainExpected: boolean;
  cropHealthStatus: 'healthy' | 'warning' | 'alert';
  cropHealthLabel: string;
  cropHealthLabelHi: string;
  cropHealthSubtitle: string;
  cropHealthSubtitleHi: string;
}

export interface LeafCheckDiagnosis {
  id: string;
  cropName: string;
  cropNameHi: string;
  diagnosis: string;
  diagnosisHi: string;
  isHealthy: boolean;
  confidence: number;
  confidenceLevel: string;
  statusText: string;
  imageUrl: string;
  advisory: string;
  advisoryHi: string;
  timestamp: string;
}

export interface HistoryItem {
  id: string;
  title: string;
  titleHi: string;
  category: 'irrigation' | 'disease_check' | 'alert' | 'operation';
  subtitle: string;
  subtitleHi: string;
  time: string;
  dateGroup: 'today' | 'yesterday';
  icon: string;
  iconBgClass: string;
  iconColorClass: string;
  trendText?: string;
  trendTextHi?: string;
  trendIcon?: string;
  trendType?: 'positive' | 'negative' | 'neutral';
  leafDiagnosis?: LeafCheckDiagnosis;
}

export interface SampleLeaf {
  id: string;
  name: string;
  nameHi: string;
  crop: string;
  cropHi: string;
  imageUrl: string;
  expectedDiagnosis: string;
  expectedDiagnosisHi: string;
  isHealthy: boolean;
  confidence: number;
  advisory: string;
  advisoryHi: string;
}

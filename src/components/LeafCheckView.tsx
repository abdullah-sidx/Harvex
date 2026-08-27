import React, { useState, useRef } from 'react';
import { Language, LeafCheckDiagnosis } from '../types';
import { TRANSLATIONS, SAMPLE_LEAVES } from '../data';

interface LeafCheckViewProps {
  language: Language;
  onSaveToHistory?: (diagnosis: LeafCheckDiagnosis) => void;
}

export const LeafCheckView: React.FC<LeafCheckViewProps> = ({
  language,
  onSaveToHistory,
}) => {
  const t = TRANSLATIONS[language];
  const isHi = language === 'hi';

  const [isLoading, setIsLoading] = useState(false);
  const [currentResult, setCurrentResult] = useState<LeafCheckDiagnosis | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isSpeakingAdvisory, setIsSpeakingAdvisory] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  // Trigger analysis for an image (base64 or URL)
  const analyzeImage = async (imageData: string, sampleInfo?: typeof SAMPLE_LEAVES[0]) => {
    setIsLoading(true);

    try {
      // 1. Prepare image FormData for /api/detect-disease
      const formData = new FormData();

      if (imageData.startsWith('data:')) {
        const [header, base64] = imageData.split(',');
        const mimeMatch = header.match(/:(.*?);/);
        const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const blob = new Blob([new Uint8Array(byteNumbers)], { type: mime });
        formData.append('image', blob, 'leaf.jpg');
      } else {
        try {
          const resp = await fetch(imageData);
          const blob = await resp.blob();
          formData.append('image', blob, 'leaf.jpg');
        } catch {
          // If remote URL is blocked by CORS, pass as empty or fallback
          formData.append('image', new Blob([]), 'leaf.jpg');
        }
      }

      // 2. Fetch directly from Harvex FastAPI Backend
      let res: Response;
      const endpoint = `http://localhost:8000/api/detect-disease?lang=${language}`;
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          body: formData,
        });
      } catch {
        // Fallback relative path if running through proxy
        res = await fetch(`/api/detect-disease?lang=${language}`, {
          method: 'POST',
          body: formData,
        });
      }

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Server returned HTTP ${res.status}: ${errText}`);
      }

      const apiData = await res.json();
      // Contract format: { disease_class, confidence, advisory, advisory_hi, voice_audio_base64 }

      const rawConf = typeof apiData.confidence === 'number' ? apiData.confidence : 0;
      const confPct = rawConf <= 1.0 ? Math.round(rawConf * 100) : Math.round(rawConf);
      const isUncertain = apiData.disease_class === 'uncertain' || confPct < 70;
      const isHealthy = apiData.disease_class === 'Healthy';

      const diagnosis: LeafCheckDiagnosis = {
        id: `leaf-${Date.now()}`,
        cropName: sampleInfo?.crop || 'Plant Leaf',
        cropNameHi: sampleInfo?.cropHi || 'पौधे की पत्ती',
        diagnosis: apiData.disease_class || 'uncertain',
        diagnosisHi: isHealthy
          ? 'स्वस्थ'
          : isUncertain
          ? 'अस्पष्ट (Uncertain)'
          : apiData.disease_class,
        isHealthy: isHealthy,
        confidence: confPct,
        confidenceLevel: isUncertain
          ? isHi ? 'कम विश्वास (Low Confidence)' : 'Low Confidence'
          : confPct >= 85
          ? isHi ? 'उच्च विश्वास (High Confidence)' : 'High Confidence'
          : isHi ? 'मध्यम विश्वास (Moderate Confidence)' : 'Moderate Confidence',
        statusText: isUncertain
          ? isHi ? 'अस्पष्ट तस्वीर' : 'Uncertain Photo'
          : isHealthy
          ? isHi ? 'सामान्य' : 'Optimal'
          : isHi ? 'कार्रवाई आवश्यक' : 'Action Required',
        imageUrl: imageData,
        advisory: apiData.advisory || 'No advisory returned.',
        advisoryHi: apiData.advisory_hi || apiData.advisory || 'कोई सलाह उपलब्ध नहीं है।',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setCurrentResult(diagnosis);
      onSaveToHistory?.(diagnosis);

      // Play audio if Sarvam TTS voice_audio_base64 is attached
      if (apiData.voice_audio_base64) {
        try {
          const audio = new Audio(`data:audio/wav;base64,${apiData.voice_audio_base64}`);
          audio.play().catch((e) => console.log('Autoplay prevented:', e));
        } catch (audioErr) {
          console.warn('Audio playback error:', audioErr);
        }
      }
    } catch (err: any) {
      console.error('Error analyzing leaf from API:', err);

      // Display exact error diagnosis instead of hardcoded mock
      const errorDiagnosis: LeafCheckDiagnosis = {
        id: `leaf-${Date.now()}`,
        cropName: 'Diagnosis Error',
        cropNameHi: 'त्रुटि',
        diagnosis: 'uncertain',
        diagnosisHi: 'अस्पष्ट',
        isHealthy: false,
        confidence: 0,
        confidenceLevel: isHi ? 'त्रुटि' : 'Error',
        statusText: isHi ? 'कनेक्शन त्रुटि' : 'Connection Error',
        imageUrl: imageData,
        advisory: `Backend connection error: ${err?.message || 'Failed to fetch from http://localhost:8000/api/detect-disease'}. Please ensure the FastAPI backend is running.`,
        advisoryHi: `सर्वर कनेक्शन त्रुटि: ${err?.message || 'http://localhost:8000 से कनेक्ट नहीं हो सका'}। कृपया सुनिश्चित करें कि बैकएंड चालू है।`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setCurrentResult(errorDiagnosis);
      onSaveToHistory?.(errorDiagnosis);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle file upload
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        if (base64) {
          analyzeImage(base64);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // Start Camera
  const startCamera = async () => {
    try {
      setIsCameraActive(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      mediaStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
    } catch (err) {
      console.error('Camera access denied or unavailable:', err);
      setIsCameraActive(false);
      // Fallback to file input
      fileInputRef.current?.click();
    }
  };

  // Stop Camera
  const stopCamera = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    setIsCameraActive(false);
  };

  // Capture frame from camera
  const captureFrame = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        stopCamera();
        analyzeImage(dataUrl);
      }
    }
  };

  // Reset and Retake
  const handleRetake = () => {
    setCurrentResult(null);
    setIsLoading(false);
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      setIsSpeakingAdvisory(false);
    }
  };

  // Read aloud advisory
  const handleReadAdvisory = () => {
    if (!('speechSynthesis' in window) || !currentResult) return;

    if (isSpeakingAdvisory) {
      window.speechSynthesis.cancel();
      setIsSpeakingAdvisory(false);
      return;
    }

    const textToSpeak = isHi ? currentResult.advisoryHi : currentResult.advisory;
    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.lang = isHi ? 'hi-IN' : 'en-US';
    utterance.rate = 0.95;

    utterance.onend = () => setIsSpeakingAdvisory(false);
    utterance.onerror = () => setIsSpeakingAdvisory(false);

    setIsSpeakingAdvisory(true);
    window.speechSynthesis.speak(utterance);
  };

  return (
    <div className="w-full max-w-4xl mx-auto pb-24 md:pb-12 pt-4">
      {/* Hidden File and Canvas Elements */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/*"
        className="hidden"
      />
      <canvas ref={canvasRef} className="hidden" />

      {/* Case 1: Live Results View (Matches Screenshot 3 & 7) */}
      {currentResult && !isLoading && (
        <div className="space-y-6 animate-fadeIn">
          {/* Header */}
          <div className="mb-2">
            <h1 className="text-3xl md:text-4xl font-bold text-[#1c1b1b] tracking-tight">
              {t.checkResult}
            </h1>
            <p className="text-base text-[#414844] mt-1">{t.imageAnalysisComplete}</p>
          </div>

          {/* Bento Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            {/* Diagnosis Card */}
            <div className="bg-[#ffffff] border border-[#c1c8c2] rounded-xl p-5 md:p-6 flex flex-col justify-center min-h-[160px] shadow-xs">
              <h2 className="text-xs font-bold text-[#414844] uppercase tracking-wider mb-2">
                {t.diagnosis}
              </h2>
              <div className="flex items-center gap-3 mb-3">
                <span
                  className={`material-symbols-outlined text-3xl md:text-4xl icon-fill ${
                    currentResult.isHealthy ? 'text-green-700' : 'text-[#ba1a1a]'
                  }`}
                >
                  {currentResult.isHealthy ? 'check_circle' : 'warning'}
                </span>
                <span className="text-2xl md:text-3xl font-bold text-[#1c1b1b] leading-tight">
                  {isHi ? currentResult.diagnosisHi : currentResult.diagnosis}
                </span>
              </div>

              {/* Status Chip */}
              <div
                className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 w-max font-bold text-xs md:text-sm ${
                  currentResult.isHealthy
                    ? 'bg-[#c1ecd4] text-[#002114]'
                    : 'bg-[#ffdad6] text-[#93000a]'
                }`}
              >
                <span className="material-symbols-outlined text-[18px] icon-fill">
                  {currentResult.isHealthy ? 'eco' : 'water_drop'}
                </span>
                <span>
                  {currentResult.statusText}
                </span>
              </div>
            </div>

            {/* Confidence Score Card */}
            <div className="bg-[#ffffff] border border-[#c1c8c2] rounded-xl p-5 md:p-6 flex flex-col justify-center min-h-[160px] shadow-xs">
              <h2 className="text-xs font-bold text-[#414844] uppercase tracking-wider mb-2">
                {t.confidenceLevel}
              </h2>
              <div className="text-xl md:text-2xl font-bold text-[#1c1b1b] mb-4">
                {currentResult.confidenceLevel}
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-[#e5e2e1] rounded-full h-4 overflow-hidden mt-auto">
                <div
                  className="bg-[#012d1d] h-4 rounded-full transition-all duration-700"
                  style={{ width: `${currentResult.confidence}%` }}
                ></div>
              </div>

              <div className="flex justify-between mt-2 text-xs font-bold text-[#414844]">
                <span>0</span>
                <span className="text-[#012d1d] font-extrabold">{currentResult.confidence}%</span>
                <span>100</span>
              </div>
            </div>

            {/* Analyzed Image Card */}
            <div className="bg-[#ffffff] border border-[#c1c8c2] rounded-xl p-5 md:p-6 md:col-span-2 shadow-xs">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-bold text-[#414844] uppercase tracking-wider">
                  {t.analyzedImage}
                </h2>
                <span className="text-xs font-semibold text-[#414844]">
                  {isHi ? currentResult.cropNameHi : currentResult.cropName}
                </span>
              </div>
              <div className="w-full h-56 md:h-72 rounded-lg bg-[#e5e2e1] overflow-hidden flex items-center justify-center border border-[#c1c8c2]">
                <img
                  src={currentResult.imageUrl}
                  alt={currentResult.diagnosis}
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              </div>
            </div>

            {/* Advisory & Treatment Card */}
            <div className="bg-[#ffffff] border border-[#c1c8c2] rounded-xl p-5 md:p-6 md:col-span-2 shadow-xs">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-bold text-[#414844] uppercase tracking-wider flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[#012d1d] text-lg icon-fill">
                    eco
                  </span>
                  {t.advisoryTreatment}
                </h2>

                <button
                  onClick={handleReadAdvisory}
                  className="flex items-center gap-1 text-xs font-bold text-[#012d1d] bg-[#f0edec] hover:bg-[#e5e2e1] px-3 py-1 rounded-full cursor-pointer transition-colors"
                >
                  <span className="material-symbols-outlined text-[16px]">
                    {isSpeakingAdvisory ? 'volume_off' : 'volume_up'}
                  </span>
                  <span>{isSpeakingAdvisory ? (isHi ? 'रोकें' : 'Stop') : (isHi ? 'सुनें' : 'Listen')}</span>
                </button>
              </div>

              <p className="text-base md:text-lg text-[#1c1b1b] leading-relaxed">
                {isHi ? currentResult.advisoryHi : currentResult.advisory}
              </p>
            </div>
          </div>

          {/* Action Area: Retake Photo */}
          <div className="mt-6 flex justify-end">
            <button
              onClick={handleRetake}
              className="h-12 px-6 bg-[#ffffff] border-2 border-[#012d1d] text-[#012d1d] font-bold text-sm md:text-base rounded-lg hover:bg-[#f6f3f2] active:bg-[#e5e2e1] transition-all flex items-center gap-2 cursor-pointer shadow-xs"
            >
              <span className="material-symbols-outlined text-xl">photo_camera</span>
              <span>{t.retakePhoto}</span>
            </button>
          </div>
        </div>
      )}

      {/* Case 2: Loading State (Matches Screenshot 9 / HTML mock upload state) */}
      {isLoading && (
        <div className="flex flex-col gap-6 w-full animate-fadeIn">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-[#012d1d] tracking-tight">
              {t.leafCheckTitle}
            </h1>
            <p className="text-base md:text-lg text-[#414844] mt-1">{t.leafCheckDesc}</p>
          </div>

          <div className="w-full aspect-square md:aspect-[2/1] bg-[#f6f3f2] border border-[#c1c8c2] rounded-xl flex flex-col items-center justify-center gap-4 shadow-xs">
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 border-4 border-[#e5e2e1] rounded-full"></div>
              <div className="absolute inset-0 border-4 border-[#012d1d] rounded-full border-t-transparent animate-spin"></div>
            </div>
            <span className="text-xl md:text-2xl font-bold text-[#012d1d] animate-pulse">
              {t.checkingLeaf}
            </span>
          </div>
        </div>
      )}

      {/* Case 3: Initial Upload / Scanner View (Matches Screenshot 9) */}
      {!currentResult && !isLoading && (
        <div className="flex flex-col gap-6 w-full">
          {/* Headers */}
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-[#012d1d] tracking-tight">
              {t.leafCheckTitle}
            </h1>
            <p className="text-base md:text-lg text-[#414844] mt-1">{t.leafCheckDesc}</p>
          </div>

          {/* Camera Viewfinder if Camera is Active */}
          {isCameraActive ? (
            <div className="relative w-full aspect-square md:aspect-[2/1] bg-black rounded-xl overflow-hidden border border-[#c1c8c2] flex flex-col items-center justify-center shadow-lg">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />

              <div className="absolute top-4 right-4 z-10">
                <button
                  onClick={stopCamera}
                  className="bg-black/60 text-white p-2 rounded-full hover:bg-black/80 transition-colors"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <div className="absolute bottom-6 flex items-center gap-4 z-10">
                <button
                  onClick={captureFrame}
                  className="w-16 h-16 rounded-full bg-white border-4 border-[#012d1d] flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-all cursor-pointer"
                >
                  <div className="w-12 h-12 rounded-full bg-[#012d1d]"></div>
                </button>
              </div>
            </div>
          ) : (
            /* Upload Interactive Area (Exact match to HTML in prompt) */
            <div
              onClick={() => fileInputRef.current?.click()}
              className="w-full aspect-square md:aspect-[2/1] bg-[#ffffff] border border-[#c1c8c2] rounded-xl flex flex-col items-center justify-center gap-4 cursor-pointer hover:bg-[#e5e2e1] transition-all active:bg-[#1b4332] active:text-[#86af99] group shadow-xs select-none"
            >
              <div className="w-24 h-24 rounded-full bg-[#c1ecd4] flex items-center justify-center group-active:bg-[#ffffff] transition-colors shadow-xs">
                <span className="material-symbols-outlined text-[48px] text-[#274e3d]">
                  photo_camera
                </span>
              </div>
              <span className="text-xl md:text-2xl font-bold text-[#012d1d] group-active:text-[#86af99]">
                {t.takeOrUpload}
              </span>
            </div>
          )}

          {/* Auxiliary Action Buttons */}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={startCamera}
              className="px-4 py-2.5 bg-[#f0edec] hover:bg-[#e5e2e1] border border-[#c1c8c2] rounded-lg font-bold text-xs md:text-sm text-[#012d1d] flex items-center gap-2 transition-all cursor-pointer shadow-xs"
            >
              <span className="material-symbols-outlined text-[18px]">videocam</span>
              <span>{t.cameraCapture}</span>
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2.5 bg-[#f0edec] hover:bg-[#e5e2e1] border border-[#c1c8c2] rounded-lg font-bold text-xs md:text-sm text-[#012d1d] flex items-center gap-2 transition-all cursor-pointer shadow-xs"
            >
              <span className="material-symbols-outlined text-[18px]">file_upload</span>
              <span>{t.manualUpload}</span>
            </button>
          </div>

          {/* Quick Test Samples Gallery (Includes the exact Tomato Early Blight from screenshot 3 & 7) */}
          <div className="mt-4 pt-4 border-t border-[#c1c8c2]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-[#414844] uppercase tracking-wider">
                {t.samplePhotos}
              </h3>
              <span className="text-[11px] text-[#414844]">
                {isHi ? 'तुरंत परीक्षण के लिए क्लिक करें' : 'Click any leaf to test'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {SAMPLE_LEAVES.map((sample) => (
                <div
                  key={sample.id}
                  onClick={() => analyzeImage(sample.imageUrl, sample)}
                  className="bg-[#ffffff] border border-[#c1c8c2] hover:border-[#012d1d] rounded-lg p-2.5 flex items-center gap-3 cursor-pointer hover:bg-[#f6f3f2] transition-all shadow-xs group"
                >
                  <img
                    src={sample.imageUrl}
                    alt={sample.name}
                    className="w-12 h-12 rounded-md object-cover shrink-0 border border-[#c1c8c2]"
                    referrerPolicy="no-referrer"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-[#1c1b1b] truncate group-hover:text-[#012d1d]">
                      {isHi ? sample.nameHi : sample.name}
                    </p>
                    <span
                      className={`text-[11px] font-semibold ${
                        sample.isHealthy ? 'text-green-700' : 'text-[#ba1a1a]'
                      }`}
                    >
                      {isHi ? sample.expectedDiagnosisHi : sample.expectedDiagnosis}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

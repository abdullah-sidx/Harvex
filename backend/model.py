import io
import os
import json
import re
import logging
import base64
from typing import Dict, Any, Tuple, Optional
from PIL import Image
import numpy as np
import torch
import httpx
from transformers import AutoImageProcessor, AutoModelForImageClassification

logger = logging.getLogger("harvex.model")

MODEL_NAME = "kimcomehome/plantvillage-vit-leaf-disease"
CONFIDENCE_THRESHOLD = 0.70
MIN_LEAF_PIXEL_RATIO = 0.15  # Minimum 15% vegetation-toned pixels required

# Disease class name mappings to clean, standardized names
LABEL_NAME_MAP: Dict[str, str] = {
    "Apple___Apple_scab": "Apple Scab",
    "Apple___Black_rot": "Black Rot",
    "Apple___Cedar_apple_rust": "Cedar Apple Rust",
    "Apple___healthy": "Healthy",
    "Blueberry___healthy": "Healthy",
    "Cherry_(including_sour)___Powdery_mildew": "Powdery Mildew",
    "Cherry_(including_sour)___healthy": "Healthy",
    "Corn_(maize)___Cercospora_leaf_spot Gray_leaf_spot": "Gray Leaf Spot",
    "Corn_(maize)___Common_rust_": "Common Rust",
    "Corn_(maize)___Northern_Leaf_Blight": "Northern Leaf Blight",
    "Corn_(maize)___healthy": "Healthy",
    "Grape___Black_rot": "Black Rot",
    "Grape___Esca_(Black_Measles)": "Esca (Black Measles)",
    "Grape___Leaf_blight_(Isariopsis_Leaf_Spot)": "Leaf Blight",
    "Grape___healthy": "Healthy",
    "Orange___Haunglongbing_(Citrus_greening)": "Citrus Greening",
    "Peach___Bacterial_spot": "Bacterial Spot",
    "Peach___healthy": "Healthy",
    "Pepper,_bell___Bacterial_spot": "Bacterial Spot",
    "Pepper,_bell___healthy": "Healthy",
    "Potato___Early_blight": "Early Blight",
    "Potato___Late_blight": "Late Blight",
    "Potato___healthy": "Healthy",
    "Raspberry___healthy": "Healthy",
    "Soybean___healthy": "Healthy",
    "Squash___Powdery_mildew": "Powdery Mildew",
    "Strawberry___Leaf_scorch": "Leaf Scorch",
    "Strawberry___healthy": "Healthy",
    "Tomato___Bacterial_spot": "Bacterial Spot",
    "Tomato___Early_blight": "Early Blight",
    "Tomato___Late_blight": "Late Blight",
    "Tomato___Leaf_Mold": "Leaf Mold",
    "Tomato___Septoria_leaf_spot": "Septoria Leaf Spot",
    "Tomato___Spider_mites Two-spotted_spider_mite": "Spider Mites",
    "Tomato___Target_Spot": "Target Spot",
    "Tomato___Tomato_Yellow_Leaf_Curl_Virus": "Tomato Yellow Leaf Curl Virus",
    "Tomato___Tomato_mosaic_virus": "Tomato Mosaic Virus",
    "Tomato___healthy": "Healthy",
}

# Agricultural advisory mapping for each clean disease class (English)
ADVISORY_MAP: Dict[str, str] = {
    "Early Blight": "Possible early blight detected. Remove affected leaves and avoid overhead watering.",
    "Late Blight": "Late blight detected. Apply copper-based fungicide, remove infected plants immediately, and improve field drainage.",
    "Bacterial Spot": "Bacterial spot detected. Apply copper bactericide, avoid working among wet plants, and use disease-free seeds.",
    "Healthy": "The leaf appears healthy with no visible signs of pathogen infection. Maintain regular watering and monitoring.",
    "Powdery Mildew": "Powdery mildew detected. Apply sulfur fungicide or neem oil, ensure good air circulation, and reduce leaf wetness.",
    "Leaf Mold": "Leaf mold detected. Improve greenhouse/canopy ventilation and reduce relative humidity below 85%.",
    "Septoria Leaf Spot": "Septoria leaf spot detected. Prune lower diseased foliage, apply mulching to prevent soil splash, and apply copper fungicide.",
    "Spider Mites": "Spider mite infestation detected. Spray insecticidal soap or neem oil on undersides of leaves and maintain field humidity.",
    "Target Spot": "Target spot detected. Apply broad-spectrum fungicide and practice crop rotation.",
    "Tomato Yellow Leaf Curl Virus": "Yellow Leaf Curl Virus detected. Control whitefly vectors using yellow sticky traps and remove severely infected plants.",
    "Tomato Mosaic Virus": "Mosaic virus detected. Disinfect farming tools, wash hands with soap, and destroy infected plants to prevent viral spread.",
    "Black Rot": "Black rot detected. Prune infected branches/canes, sanitize cutting tools, and apply preventive fungicide early in the season.",
    "Apple Scab": "Apple scab detected. Remove fallen infected leaves and apply sulfur or captan fungicides during early growth stages.",
    "Cedar Apple Rust": "Cedar apple rust detected. Remove nearby eastern red cedar trees if possible and apply protective fungicide.",
    "Common Rust": "Common rust detected. Monitor spread; if severe, apply strobilurin or triazole fungicides.",
    "Northern Leaf Blight": "Northern leaf blight detected. Rotate crops, till crop residues, and apply resistant fungicides if lesions appear before silking.",
    "Gray Leaf Spot": "Gray leaf spot detected. Rotate crops, improve airflow between rows, and apply foliar fungicide if lesions spread.",
    "Leaf Scorch": "Leaf scorch detected. Improve irrigation schedule, clear dead foliage, and apply fungicides as preventive measure.",
    "Leaf Blight": "Leaf blight detected. Apply copper-based fungicide and manage canopy density.",
    "Esca (Black Measles)": "Esca detected. Prune symptomatic vines during dry weather and protect pruning wounds with wound sealant.",
    "Citrus Greening": "Citrus greening (Huanglongbing) detected. Manage psyllid insect vectors and remove infected trees to protect surrounding grove."
}

# Agricultural advisory mapping for each clean disease class (Hindi - हिंदी)
ADVISORY_MAP_HI: Dict[str, str] = {
    "Early Blight": "अर्ली ब्लाइट (अगेती झुलसा) के लक्षण दिखे हैं। तुरंत तांबा आधारित कवकनाशी (कॉपर फंगीसाइड) का छिड़काव करें और संक्रमित पत्तियों को हटा दें।",
    "Late Blight": "लेट ब्लाइट (पछेती झुलसा) का संक्रमण है। तुरंत मेटालैक्सिल या मेंकोजेब कवकनाशी का छिड़काव करें और खेत में जल निकासी सुधारें।",
    "Bacterial Spot": "जीवाणु पत्ती धब्बा रोग पाया गया है। कॉपर युक्त कवकनाशी का छिड़काव करें और पौधों पर पानी ठहरने न दें।",
    "Healthy": "फसल की पत्तियां पूरी तरह स्वस्थ और रोगमुक्त हैं। नियमित सिंचाई और निगरानी जारी रखें।",
    "Powdery Mildew": "चूर्णी फफूंद (पाउडरी मिल्ड्यू) के लिए सल्फर कवकनाशी या नीम तेल का छिड़काव करें तथा हवा का संचार बनाए रखें।",
    "Leaf Mold": "पत्ती फफूंद (लीफ मोल्ड) से बचाव के लिए खेत में वायु संचार बढ़ाएं और नमी को नियंत्रित रखें।",
    "Septoria Leaf Spot": "सेप्टोरिया पत्ती धब्बा के लिए निचली संक्रमित पत्तियों को काटें और कॉपर फंगीसाइड का छिड़काव करें।",
    "Spider Mites": "लाल मकड़ी (स्पाइडर माइट) के नियंत्रण के लिए पत्तियों के नीचे नीम तेल या कीटनाशक साबुन का छिड़काव करें।",
    "Target Spot": "टारगेट स्पॉट रोग के लिए अनुशंसित कवकनाशी का छिड़काव करें और फसल चक्र अपनाएं।",
    "Tomato Yellow Leaf Curl Virus": "येलो लीफ कर्ल वायरस के लिए सफेद मक्खी को पीले स्टिकी ट्रैप से नियंत्रित करें और संक्रमित पौधों को नष्ट करें।",
    "Tomato Mosaic Virus": "मोज़ेक वायरस के प्रसार को रोकने के लिए औजारों को साफ रखें और संक्रमित पौधों को तुरंत हटा दें।",
    "Black Rot": "काले सड़न (ब्लैक रॉट) के लिए संक्रमित टहनियों को काटें और सुरक्षात्मक कवकनाशी का प्रयोग करें।",
    "Apple Scab": "सेब स्कैब के लिए गिरी हुई पत्तियों को नष्ट करें और शुरुआती अवस्था में सल्फर फंगीसाइड का छिड़काव करें।",
    "Cedar Apple Rust": "जंग रोग के नियंत्रण हेतु सुरक्षात्मक फंगीसाइड का प्रयोग करें।",
    "Common Rust": "सामान्य जंग रोग के लिए स्ट्रॉबिल्यूरिन या ट्रायज़ोल कवकनाशी का छिड़काव करें।",
    "Northern Leaf Blight": "उत्तरी पत्ती झुलसा के लिए फसल चक्र अपनाएं और प्रतिरोधी कवकनाशी का प्रयोग करें।",
    "Gray Leaf Spot": "ग्रे लीफ स्पॉट के लिए पौधों के बीच दूरी रखें और उचित कवकनाशी का छिड़काव करें।",
    "Leaf Scorch": "पत्ती झुलसने की रोकथाम के लिए सिंचाई व्यवस्था सुधारें और पुरानी पत्तियों को हटा दें।",
    "Leaf Blight": "पत्ती झुलसा के लिए तांबा आधारित कवकनाशी का छिड़काव करें।",
    "Esca (Black Measles)": "एस्का रोग के लिए सूखे मौसम में छंटाई करें और कटे हुए हिस्से पर लेप लगाएं।",
    "Citrus Greening": "सिट्रस ग्रीनिंग के कीट वाहकों पर नियंत्रण रखें और संक्रमित पेड़ों को अलग करें।"
}

# Standardized Uncertain / Non-Leaf Fallback Messages
DEFAULT_UNCERTAIN_ADVISORY = "Photo unclear or non-leaf image uploaded — please upload a close-up photo of a plant leaf."
DEFAULT_UNCERTAIN_ADVISORY_HI = "तस्वीर स्पष्ट नहीं है या पत्ती की नहीं है - कृपया किसी पौधे की पत्ती की करीब से फोटो अपलोड करें।"

GEMINI_STRUCTURED_PROMPT = """Analyze this image carefully for an agricultural plant disease app.
First, determine if the image is a close-up photo of a plant leaf or crop.
- If it is NOT a plant leaf (e.g., text screenshot, car, human face, random object, UI element), return JSON:
  {"is_leaf": false, "disease_class": "uncertain", "confidence": 0.0, "advisory": "Photo unclear or non-leaf image uploaded — please upload a close-up photo of a plant leaf.", "advisory_hi": "तस्वीर स्पष्ट नहीं है या पत्ती की नहीं है - कृपया किसी पौधे की पत्ती की करीब से फोटो अपलोड करें।"}
- If it IS a plant leaf, analyze the disease and return JSON:
  {"is_leaf": true, "disease_class": "<Name of Disease or Healthy>", "confidence": <float 0.70 to 0.99>, "advisory": "<English Advisory>", "advisory_hi": "<Hindi Advisory>"}
"""


def calculate_vegetation_pixel_ratio(image: Image.Image) -> float:
    """
    Calculate the percentage of green, yellow-green, or vegetation-toned pixels in an image.
    Uses Excess Green Index (ExG = 2G - R - B) and plant spectral heuristics.
    """
    try:
        img_small = image.resize((100, 100)).convert("RGB")
        arr = np.array(img_small, dtype=np.float32)
        r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]

        exg = 2 * g - r - b

        is_plant_pixel = (
            ((g > r * 0.9) & (g > b * 1.05) & (g > 25)) |     # Green & healthy foliage
            ((exg > 10) & (g > 30)) |                         # Strong Excess Green Index
            ((r > 60) & (g > 50) & (b < 65) & (r - b > 20))   # Chlorotic, yellowing, or blighted leaf tissue
        )

        ratio = float(np.sum(is_plant_pixel)) / float(is_plant_pixel.size)
        return ratio
    except Exception as e:
        logger.warning(f"Vegetation pixel ratio check failed: {e}")
        return 1.0


def predict_with_gemini_vision(image_bytes: bytes, mime_type: str = "image/jpeg") -> Optional[Dict[str, Any]]:
    """
    Primary disease classifier and leaf validation engine using Gemini Flash Vision API.
    """
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        return None

    try:
        b64_data = base64.b64encode(image_bytes).decode("utf-8")
        models_to_try = ["gemini-2.5-flash", "gemini-1.5-flash"]
        
        for model_id in models_to_try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_id}:generateContent?key={api_key}"
            payload = {
                "contents": [
                    {
                        "parts": [
                            {
                                "inline_data": {
                                    "mime_type": mime_type,
                                    "data": b64_data
                                }
                            },
                            {
                                "text": GEMINI_STRUCTURED_PROMPT
                            }
                        ]
                    }
                ],
                "generationConfig": {
                    "responseMimeType": "application/json"
                }
            }

            try:
                with httpx.Client(timeout=8.0) as client:
                    resp = client.post(url, json=payload)
                    if resp.status_code == 200:
                        data_json = resp.json()
                        candidates = data_json.get("candidates", [])
                        if candidates:
                            raw_text = candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "").strip()
                            clean_text = re.sub(r"^```(?:json)?\s*", "", raw_text)
                            clean_text = re.sub(r"\s*```$", "", clean_text)
                            parsed = json.loads(clean_text)
                            
                            is_leaf = parsed.get("is_leaf", True)
                            if not is_leaf:
                                logger.info("Gemini Vision identified non-leaf image. Returning uncertain.")
                                return {
                                    "disease_class": "uncertain",
                                    "confidence": 0.0,
                                    "advisory": parsed.get("advisory", DEFAULT_UNCERTAIN_ADVISORY),
                                    "advisory_hi": parsed.get("advisory_hi", DEFAULT_UNCERTAIN_ADVISORY_HI)
                                }

                            disease_class = parsed.get("disease_class", "Healthy")
                            confidence = float(parsed.get("confidence", 0.85))
                            advisory = parsed.get("advisory", ADVISORY_MAP.get(disease_class, DEFAULT_UNCERTAIN_ADVISORY))
                            advisory_hi = parsed.get("advisory_hi", ADVISORY_MAP_HI.get(disease_class, DEFAULT_UNCERTAIN_ADVISORY_HI))

                            if confidence < CONFIDENCE_THRESHOLD:
                                return {
                                    "disease_class": "uncertain",
                                    "confidence": round(confidence, 2),
                                    "advisory": DEFAULT_UNCERTAIN_ADVISORY,
                                    "advisory_hi": DEFAULT_UNCERTAIN_ADVISORY_HI
                                }

                            logger.info(f"Gemini Vision classification success: {disease_class} ({confidence:.2f})")
                            return {
                                "disease_class": disease_class,
                                "confidence": round(confidence, 2),
                                "advisory": advisory,
                                "advisory_hi": advisory_hi
                            }
            except Exception as model_err:
                logger.warning(f"Error querying Gemini model {model_id}: {model_err}")
                continue

    except Exception as e:
        logger.error(f"Gemini Vision pipeline error: {e}")
    
    return None


class PlantDiseaseClassifier:
    """Pretrained Plant Disease Classifier with Gemini Flash Vision primary engine and local ViT fallback."""

    def __init__(self):
        self.processor = None
        self.model = None
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self._is_loaded = False

    def load(self) -> None:
        """Load pretrained local model and processor once during startup lifespan."""
        if self._is_loaded:
            return
        
        logger.info(f"Loading PlantVillage ViT fallback model: {MODEL_NAME} onto {self.device}...")
        try:
            self.processor = AutoImageProcessor.from_pretrained(MODEL_NAME)
            self.model = AutoModelForImageClassification.from_pretrained(MODEL_NAME)
            self.model.to(self.device)
            self.model.eval()
            self._is_loaded = True
            logger.info("Plant disease classifier successfully loaded.")
        except Exception as e:
            logger.error(f"Failed to load fallback model {MODEL_NAME}: {e}")

    def predict(self, image_bytes: bytes) -> Dict[str, Any]:
        """
        Run Gemini Flash Vision primary disease classification and leaf validation.
        Falls back seamlessly to local ViT classifier + color heuristic if Gemini is not configured.
        """
        if not image_bytes:
            return {
                "disease_class": "uncertain",
                "confidence": 0.0,
                "advisory": DEFAULT_UNCERTAIN_ADVISORY,
                "advisory_hi": DEFAULT_UNCERTAIN_ADVISORY_HI
            }

        # 1. Primary Engine: Gemini Flash Vision
        gemini_result = predict_with_gemini_vision(image_bytes)
        if gemini_result is not None:
            return gemini_result

        # 2. Local Fallback Engine (Color Pre-Screening + Vision Transformer)
        try:
            image = Image.open(io.BytesIO(image_bytes))
            if image.mode != "RGB":
                image = image.convert("RGB")

            # Fast color heuristic pre-screening
            green_ratio = calculate_vegetation_pixel_ratio(image)
            if green_ratio < MIN_LEAF_PIXEL_RATIO:
                logger.info(f"Local pre-screening failed: Non-leaf image detected ({green_ratio:.2f} < {MIN_LEAF_PIXEL_RATIO}).")
                return {
                    "disease_class": "uncertain",
                    "confidence": 0.0,
                    "advisory": DEFAULT_UNCERTAIN_ADVISORY,
                    "advisory_hi": DEFAULT_UNCERTAIN_ADVISORY_HI
                }

            if not self._is_loaded or self.model is None or self.processor is None:
                self.load()

            inputs = self.processor(images=image, return_tensors="pt").to(self.device)
            with torch.no_grad():
                outputs = self.model(**inputs)
                probs = torch.nn.functional.softmax(outputs.logits, dim=-1)
                top_prob, top_idx = torch.topk(probs, 1)
                confidence = float(top_prob[0][0].item())
                raw_label = self.model.config.id2label[int(top_idx[0][0].item())]

            confidence_rounded = round(confidence, 2)

            if confidence < CONFIDENCE_THRESHOLD:
                logger.info(f"Local ViT low confidence: {raw_label} ({confidence_rounded:.2f}) < {CONFIDENCE_THRESHOLD}")
                return {
                    "disease_class": "uncertain",
                    "confidence": confidence_rounded,
                    "advisory": DEFAULT_UNCERTAIN_ADVISORY,
                    "advisory_hi": DEFAULT_UNCERTAIN_ADVISORY_HI
                }

            clean_name = LABEL_NAME_MAP.get(raw_label, raw_label.replace("___", " - ").replace("_", " "))
            advisory = ADVISORY_MAP.get(clean_name, f"Identified {clean_name}. Inspect crop foliage and consult local agricultural extension.")
            advisory_hi = ADVISORY_MAP_HI.get(clean_name, f"{clean_name} के लक्षण देखे गए हैं। कृपया नजदीकी कृषि विज्ञान केंद्र से संपर्क करें।")

            return {
                "disease_class": clean_name,
                "confidence": confidence_rounded,
                "advisory": advisory,
                "advisory_hi": advisory_hi
            }

        except Exception as e:
            logger.warning(f"Error during fallback classification: {e}")
            return {
                "disease_class": "uncertain",
                "confidence": 0.0,
                "advisory": DEFAULT_UNCERTAIN_ADVISORY,
                "advisory_hi": DEFAULT_UNCERTAIN_ADVISORY_HI
            }


# Singleton classifier instance
classifier = PlantDiseaseClassifier()

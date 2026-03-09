import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface AnalysisResult {
  classification: "Healthy" | "Fractured";
  severity: "None" | "Mild" | "Moderate" | "Severe";
  peakFrequency: number;
  confidence: number;
  reasoning: string;
  recommendations: string[];
}

export async function analyzeVibrationSignal(
  data: string | { mimeType: string; data: string },
  isImage: boolean
): Promise<AnalysisResult> {
  const model = "gemini-3-flash-preview";

  const prompt = `
    Analyze this bone vibration signal ${isImage ? "image" : "data"}. 
    Bone vibration signals change when a fracture is present, typically showing shifts in peak frequency and damping characteristics.
    
    Provide a detailed analysis including:
    1. Classification: Healthy or Fractured.
    2. Severity: None (for healthy), Mild, Moderate, or Severe.
    3. Estimated Peak Frequency (in Hz).
    4. Confidence score (0-1).
    5. Reasoning based on the signal patterns (e.g., frequency shifts, amplitude changes).
    6. Clinical recommendations.

    Return the result in strict JSON format.
  `;

  const response = await ai.models.generateContent({
    model,
    contents: isImage 
      ? { parts: [{ inlineData: data as { mimeType: string; data: string } }, { text: prompt }] }
      : { parts: [{ text: `Data: ${data}\n\n${prompt}` }] },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          classification: { type: Type.STRING, enum: ["Healthy", "Fractured"] },
          severity: { type: Type.STRING, enum: ["None", "Mild", "Moderate", "Severe"] },
          peakFrequency: { type: Type.NUMBER },
          confidence: { type: Type.NUMBER },
          reasoning: { type: Type.STRING },
          recommendations: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          }
        },
        required: ["classification", "severity", "peakFrequency", "confidence", "reasoning", "recommendations"]
      }
    }
  });

  try {
    return JSON.parse(response.text || "{}") as AnalysisResult;
  } catch (e) {
    console.error("Failed to parse Gemini response", e);
    throw new Error("Analysis failed to generate valid data.");
  }
}

// file: src/utils/openai.js

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";

export async function categorizeWithGemini(data) {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("❌ Gemini API key not found. Make sure .env is set up.");
  }

  const genAI = new GoogleGenerativeAI(apiKey);

  // Configuration to force JSON output and set safety levels
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    generationConfig: {
      response_mime_type: "application/json",
      max_output_tokens: 8192, // 👈 ADD THIS LINE
    },  
    // Set safety settings to be less restrictive for this task
    safetySettings: [
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
      },
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
      },
    ],
  });

  const prompt = `
    Categorize the following entries into one of these categories: "айти", "телеком", "инф.структура", "прочее".
    Your response must be a valid JSON array where each object has an "id" (number), "value" (string), and "category" (string).

    Here is the data:
    ${JSON.stringify(data, null, 2)}
  `;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    if (!text) {
      throw new Error("Received an empty response from the API. This might be due to safety filters.");
    }
    
    // With JSON mode, text() will return a valid JSON string.
    // We parse it here so the calling function gets a ready-to-use object.
    return JSON.parse(text);
  } catch (error) {
    // Log the raw error from the API for better debugging
    console.error("Error details from Gemini API:", error);
    throw new Error("Gemini did not return a valid response. Check API limits or safety settings.");
  }
}
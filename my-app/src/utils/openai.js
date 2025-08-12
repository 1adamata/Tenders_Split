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
      max_output_tokens: 8192,
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

  // ✅ FIX: Updated the prompt to include detailed category descriptions
  const prompt = `
    You are an expert procurement analyst. Your task is to categorize procurement items based on their description.
    Analyze the following entries and assign each one to the most appropriate category.

    Your response must be a valid JSON array where each object has an "id" (number), "value" (string), and "category" (string).

    ## CATEGORY LIST & DETAILED DESCRIPTIONS
    IMPORTANT: The "category" value MUST be one of the exact strings from this list:

    - "айти": Информационные технологии: разработка ПО, системная интеграция, техническая поддержка, облачные решения, кибербезопасность
    - "телеком": Телекоммуникации: услуги связи, интернет-провайдинг, мобильная связь, спутниковая связь, IP-телефония
    - "инф.структура": Информационная инфраструктура: серверное оборудование, сетевое оборудование, системы хранения данных, ЦОДы
    - "строительство/ремонт": Строительные работы и ремонт: капитальное строительство, ремонтные работы, отделочные материалы, строительные услуги
    - "оборудование": Различное оборудование: промышленное, медицинское, офисное, технологическое оборудование и техника
    - "по/лицензии": Программное обеспечение и лицензии: покупка лицензий, подписки на ПО, обновления программ, антивирусы
    - "транспорт/логистика": Транспортные услуги и логистика: грузоперевозки, пассажирские перевозки, складские услуги, курьерская доставка
    - "канцтовары/хозтовары": Канцелярские и хозяйственные товары: офисные принадлежности, бумага, моющие средства, хозяйственный инвентарь
    - "одежда/сиз": Одежда и средства индивидуальной защиты: спецодежда, защитная экипировка, униформа, обувь
    - "услуги (прочее)": Прочие услуги: консалтинг, юридические услуги, бухгалтерские услуги, маркетинг, обучение персонала
    - "прочее": Прочие товары и услуги: товары, не попадающие в другие категории, разные виды работ и поставок

    ## INSTRUCTIONS
    - If you cannot determine a suitable category from the list above, you MUST use "прочее"
    - Do not leave the category blank or create new categories
    - Use the detailed descriptions above to make accurate categorizations

    ## EXAMPLES
    - Input value: "Работы по возведению (строительству) нежилых зданий/сооружений" -> Output category: "строительство/ремонт"
    - Input value: "Работы по среднему ремонту автомобильной дороги" -> Output category: "строительство/ремонт"
    - Input value: "Сервер HPE ProLiant" -> Output category: "инф.структура"
    - Input value: "Лицензия на антивирус" -> Output category: "по/лицензии"
    - Input value: "Разработка мобильного приложения" -> Output category: "айти"
    - Input value: "Услуги мобильной связи" -> Output category: "телеком"

    ## DATA TO CATEGORIZE
    Here is the data to categorize:
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

import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY || "";
const genAI = new GoogleGenerativeAI(apiKey);

export const generateTradeInsights = async (trades: any[]) => {
  if (!apiKey) {
    throw new Error("Gemini API key is not configured.");
  }

  // Use a fast model like gemini-1.5-flash-latest for responsiveness
  const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

  const tradesSummary = trades.map((t) => ({
    date: t.entryDate,
    time: t.entryTime,
    market: t.marketType,
    direction: t.direction,
    pnl: t.pnl,
    outcome: t.outcome,
    strategy: t.strategy?.name || "None",
    rrRatio: t.rrRatio,
  }));

  const prompt = `
    You are an expert trading performance analyst.
    Analyze the following trading history and provide actionable insights.
    
    Data:
    ${JSON.stringify(tradesSummary)}

    Respond EXACTLY in this JSON format, with no markdown formatting or extra text:
    {
      "summary": "A 2-3 sentence overview of their overall performance trend and discipline.",
      "winRateDelta": "e.g., '+4.2%' or '-1.5%' representing recent shift",
      "avgRrRatio": "e.g., '1:2.8'",
      "targetRrRatio": "e.g., 'Target 1:3'",
      "strengths": [
        { "title": "Strength Title", "description": "1 sentence description" },
        { "title": "Strength Title", "description": "1 sentence description" }
      ],
      "weaknesses": [
        { "title": "Area to Improve", "description": "1 sentence description" },
        { "title": "Area to Improve", "description": "1 sentence description" }
      ],
      "actionableAdvice": "A clear, actionable rule or advice based on the data. Max 2 sentences.",
      "confidenceScore": 4 // An integer from 1 to 5 indicating how confident you are in these insights
    }
  `;

  try {
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    
    // Clean up potential markdown formatting (e.g. \`\`\`json ... \`\`\`)
    const cleanedText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    
    return JSON.parse(cleanedText);
  } catch (error) {
    console.error("Gemini AI generation failed:", error);
    throw new Error("Failed to generate AI insights.");
  }
};

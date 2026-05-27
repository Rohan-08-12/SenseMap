import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function validateWithClaude(text) {
  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: `You are a sensory analysis assistant for autistic and sensory-sensitive people.

Analyze this text and return ONLY valid JSON with no other text:
{"noise_score": <1-10>, "lighting_score": <1-10>, "crowd_score": <1-10>, "confidence": <1-10>}

Scores: 1=lowest/quietest/emptiest, 10=loudest/brightest/most crowded. Confidence = how certain you are based on available information.

Text: ${text}`,
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== "text") return null;
    return JSON.parse(content.text.trim());
  } catch {
    return null;
  }
}

import { ElevenLabsClient } from "elevenlabs";

// Rachel voice ID
const RACHEL_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

export async function generateAudioSummary(script) {
  const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
  const audioStream = await client.textToSpeech.convert(RACHEL_VOICE_ID, {
    text: script,
    model_id: "eleven_turbo_v2",
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75,
    },
  });

  const chunks = [];
  for await (const chunk of audioStream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

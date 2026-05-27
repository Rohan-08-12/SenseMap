export function scoreToLabel(score) {
  if (score <= 2) return "very low";
  if (score <= 3) return "moderate";
  if (score <= 4) return "high";
  return "very high";
}

function noiseLabel(score) {
  if (score <= 2) return "very quiet";
  if (score <= 3) return "moderately quiet";
  if (score <= 4) return "somewhat noisy";
  return "very loud";
}

function lightingLabel(score) {
  if (score <= 2) return "dim and soft";
  if (score <= 3) return "moderate";
  if (score <= 4) return "bright";
  return "very bright";
}

function crowdLabel(score) {
  if (score <= 2) return "very uncrowded";
  if (score <= 3) return "moderately busy";
  if (score <= 4) return "busy";
  return "very crowded";
}

export function buildAudioScript(location, sensoryScore, aiInsights) {
  const noise = sensoryScore?.noiseScore ?? 3;
  const lighting = sensoryScore?.lightingScore ?? 3;
  const crowd = sensoryScore?.crowdScore ?? 3;

  const noisePart = `Noise level: ${noiseLabel(noise)}, rated ${noise.toFixed(1)} out of 10.`;
  const lightingPart = `Lighting: ${lightingLabel(lighting)}.`;
  const crowdPart = `Crowd level: ${crowdLabel(crowd)}.`;
  const bestTimePart = aiInsights?.bestTime ? ` ${aiInsights.bestTime}.` : "";

  return `${location.name}. ${noisePart} ${lightingPart} ${crowdPart}${bestTimePart}`;
}

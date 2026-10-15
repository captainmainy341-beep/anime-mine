export function canSpeak() {
  return 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

export function speak(text) {
  if (!canSpeak() || !text) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ja-JP';
  const voice = synth.getVoices().find((v) => v.lang.startsWith('ja'));
  if (voice) utterance.voice = voice;
  synth.speak(utterance);
}

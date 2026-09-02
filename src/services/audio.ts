import type { GameSettings } from "@/domain/settings";

let context: AudioContext | null = null;
let musicTimer: number | null = null;
let currentSettings: GameSettings | null = null;
let musicNote = 0;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined" || !("AudioContext" in window)) return null;
  context ??= new AudioContext();
  if (context.state === "suspended") void context.resume();
  return context;
}

function tone(frequency: number, duration: number, gainValue: number): void {
  const audio = audioContext();
  if (!audio || !currentSettings?.volume) return;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  const volume = (currentSettings.volume / 100) * gainValue;
  oscillator.frequency.value = frequency;
  oscillator.type = "sine";
  gain.gain.setValueAtTime(0, audio.currentTime);
  gain.gain.linearRampToValueAtTime(volume, audio.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start();
  oscillator.stop(audio.currentTime + duration);
}

function stopMusic(): void {
  if (musicTimer !== null) window.clearInterval(musicTimer);
  musicTimer = null;
}

function startMusic(): void {
  stopMusic();
  if (!currentSettings?.musicEnabled || currentSettings.volume === 0) return;
  const notes = [220, 261.63, 329.63, 293.66];
  tone(notes[musicNote % notes.length]!, 1.8, 0.025);
  musicNote += 1;
  musicTimer = window.setInterval(() => {
    tone(notes[musicNote % notes.length]!, 1.8, 0.025);
    musicNote += 1;
  }, 2_400);
}

export function configureAudio(settings: GameSettings): void {
  const musicChanged =
    currentSettings?.musicEnabled !== settings.musicEnabled ||
    currentSettings?.volume !== settings.volume;
  currentSettings = settings;
  if (musicChanged) startMusic();
}

export function playDecisionSound(isHuman: boolean): void {
  if (!currentSettings?.soundEnabled) return;
  tone(isHuman ? 520 : 390, 0.09, 0.08);
}

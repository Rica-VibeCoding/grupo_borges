'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Espelha o WAVEFORM_BARS do chat-panel (CC). Hook extraído pra o CodexChat
// reusar a gravação robusta (edge cases iOS/WebKit) sem duplicar inline. O
// ChatInput do CC ainda tem a cópia inline — refator dele pra usar este hook
// fica como melhoria futura (não tocar o componente crítico nesta fatia).
export const WAVEFORM_BARS = 24;

type VoiceRecorderOptions = {
  onRecorded: (blob: Blob) => void | Promise<void>;
  onWarn?: (msg: string, sub?: string) => void;
};

export type VoiceRecorder = {
  recording: boolean;
  audioLevels: number[];
  durationSec: number;
  /** Inicia a gravação; se já gravando, CANCELA sem enviar (segundo clique). */
  toggle: () => Promise<void>;
  /** Para a gravação e dispara onRecorded com o blob (botão ⏹/enviar). */
  stopAndSend: () => void;
};

export function useVoiceRecorder({ onRecorded, onWarn }: VoiceRecorderOptions): VoiceRecorder {
  const [recording, setRecording] = useState(false);
  const [durationSec, setDurationSec] = useState(0);
  const [audioLevels, setAudioLevels] = useState<number[]>(Array(WAVEFORM_BARS).fill(0));

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const warn = useCallback(
    (msg: string, sub?: string) => onWarn?.(msg, sub),
    [onWarn],
  );

  const stopWaveformLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const cleanupRecording = useCallback(() => {
    stopWaveformLoop();
    stopTimer();
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    setAudioLevels(Array(WAVEFORM_BARS).fill(0));
    setDurationSec(0);
  }, [stopWaveformLoop, stopTimer]);

  const startWaveformLoop = useCallback((analyser: AnalyserNode) => {
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const step = Math.floor(data.length / WAVEFORM_BARS);
      const levels = Array.from({ length: WAVEFORM_BARS }, (_, i) => {
        let sum = 0;
        for (let j = 0; j < step; j++) sum += data[i * step + j];
        return Math.round((sum / step / 255) * 100);
      });
      setAudioLevels(levels);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  // Cleanup ao desmontar.
  useEffect(() => () => cleanupRecording(), [cleanupRecording]);

  const toggle = useCallback(async () => {
    // Segundo clique enquanto grava = CANCELA sem enviar.
    if (recording) {
      mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop());
      // Marca como cancelado: zera chunks pra onstop não enviar.
      chunksRef.current = [];
      mediaRecorderRef.current?.stop();
      cleanupRecording();
      setRecording(false);
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      warn('permissão de microfone negada', err instanceof Error ? err.message : String(err));
      return;
    }

    let ctx: AudioContext;
    let analyser: AnalyserNode;
    let recorder: MediaRecorder;
    let mimeType = '';
    try {
      if (typeof MediaRecorder === 'undefined') {
        throw new Error('MediaRecorder não existe nesse browser');
      }
      ctx = new AudioContext();
      if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(analyser);

      mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : '';
      try {
        recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      } catch {
        recorder = new MediaRecorder(stream);
        mimeType = '';
      }
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      warn('falha ao iniciar gravação', err instanceof Error ? err.message : String(err));
      return;
    }

    audioContextRef.current = ctx;
    analyserRef.current = analyser;
    mediaRecorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunksRef.current.push(ev.data);
    };

    recorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, {
        type: recorder.mimeType || mimeType || 'audio/mp4',
      });
      stream.getTracks().forEach((t) => t.stop());
      cleanupRecording();
      setRecording(false);
      if (blob.size > 0) {
        await onRecorded(blob);
      }
    };

    try {
      recorder.start(100);
    } catch {
      try {
        recorder.start();
      } catch (err) {
        stream.getTracks().forEach((t) => t.stop());
        cleanupRecording();
        warn('gravação não iniciou', err instanceof Error ? err.message : String(err));
        return;
      }
    }
    setRecording(true);
    startWaveformLoop(analyser);

    let secs = 0;
    timerRef.current = setInterval(() => {
      secs += 1;
      setDurationSec(secs);
    }, 1000);
  }, [recording, warn, cleanupRecording, startWaveformLoop, onRecorded]);

  const stopAndSend = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop(); // onstop envia o blob
    }
  }, []);

  return { recording, audioLevels, durationSec, toggle, stopAndSend };
}

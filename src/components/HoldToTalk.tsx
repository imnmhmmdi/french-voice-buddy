"use client";

import { useCallback, useRef, useState } from "react";

const WEBM_MIME = "audio/webm;codecs=opus";

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return WEBM_MIME;
  if (MediaRecorder.isTypeSupported(WEBM_MIME)) return WEBM_MIME;
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  return "";
}

export function HoldToTalk() {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const activeRef = useRef(false);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const finishRecording = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec || rec.state === "inactive") {
      stopStream();
      setRecording(false);
      activeRef.current = false;
      return;
    }
    rec.stop();
  }, [stopStream]);

  const startRecording = useCallback(async () => {
    setError(null);
    activeRef.current = true;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = pickMimeType();
      const options = mimeType ? { mimeType } : undefined;
      const recorder = new MediaRecorder(stream, options);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const type = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        console.log("Recorded blob:", blob, `size=${blob.size} type=${blob.type}`);
        recorderRef.current = null;
        chunksRef.current = [];
        stopStream();
        setRecording(false);
        activeRef.current = false;
      };

      recorder.start(100);
      setRecording(true);
    } catch (e) {
      activeRef.current = false;
      stopStream();
      setRecording(false);
      const message =
        e instanceof Error ? e.message : "Could not access microphone";
      setError(message);
    }
  }, [stopStream]);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (!activeRef.current) void startRecording();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    e.preventDefault();
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore if not captured */
    }
    if (activeRef.current) finishRecording();
  };

  const onPointerCancel = (e: React.PointerEvent) => {
    onPointerUp(e);
  };

  const barDelays = [0, 0.08, 0.16, 0.24, 0.32, 0.4, 0.48];

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-10 px-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          Hold to talk
        </h1>
        <p className="mt-2 max-w-md text-sm text-zinc-400">
          Press and hold the button to record. Release to stop — the audio blob
          is logged in the browser console.
        </p>
      </div>

      <div
        className="flex h-16 items-end justify-center gap-1.5"
        aria-hidden={!recording}
      >
        {barDelays.map((delay, i) => (
          <div
            key={i}
            className={`wave-bar w-2 rounded-full bg-emerald-400/90 ${
              recording ? "opacity-100" : "opacity-0"
            }`}
            style={{
              height: `${22 + (i % 4) * 10}px`,
              animationDelay: `${delay}s`,
            }}
          />
        ))}
      </div>

      <button
        type="button"
        className={`relative touch-none select-none rounded-full px-10 py-5 text-base font-medium shadow-lg transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ${
          recording
            ? "bg-emerald-600 text-white ring-2 ring-emerald-300/60"
            : "bg-zinc-800 text-zinc-100 hover:bg-zinc-700 active:bg-zinc-600"
        }`}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={(e) => {
          if (e.buttons === 0 && activeRef.current) finishRecording();
        }}
      >
        {recording ? "Recording…" : "Hold to record"}
      </button>

      {error ? (
        <p className="max-w-md text-center text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

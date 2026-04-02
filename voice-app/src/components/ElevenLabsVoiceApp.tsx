"use client";

import type { MessagePayload } from "@elevenlabs/types";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ConversationProvider,
  useConversation,
} from "@elevenlabs/react";
import { motion, useSpring } from "framer-motion";

type ChatEntry = {
  id: string;
  role: "user" | "agent";
  text: string;
  at: number;
};

type ConversationOrbProps = {
  status: "disconnected" | "connecting" | "connected" | "error";
  isListening: boolean;
  isSpeaking: boolean;
  getInputVolume: () => number;
  getOutputVolume: () => number;
  onPress: () => void;
  disabled: boolean;
};

function MicIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
      <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
    </svg>
  );
}

function ConversationOrb({
  status,
  isListening,
  isSpeaking,
  getInputVolume,
  getOutputVolume,
  onPress,
  disabled,
}: ConversationOrbProps) {
  const scaleSpring = useSpring(1, { stiffness: 280, damping: 22, mass: 0.8 });
  const glowSpring = useSpring(1, { stiffness: 260, damping: 24 });
  const rafRef = useRef<number>(0);
  const startRef = useRef<number | null>(null);

  const sessionLive = status === "connected";
  const isConnecting = status === "connecting";
  const idleVisual =
    !sessionLive ||
    (!isSpeaking && !isListening && !isConnecting);

  useLayoutEffect(() => {
    let cancelled = false;

    const tick = (now: number) => {
      if (cancelled) return;
      if (startRef.current === null) startRef.current = now;
      const t = (now - startRef.current) / 1000;
      let targetScale = 1;
      let targetGlow = 1;

      if (isConnecting) {
        const wobble = Math.sin(t * 3.2) * 0.045;
        targetScale = 1 + wobble;
        targetGlow = 1 + wobble * 1.4;
      } else if (sessionLive && isSpeaking) {
        const v = Math.min(1, Math.max(0, getOutputVolume()));
        targetScale = 1 + 0.1 + v * 0.75;
        targetGlow = 1 + 0.14 + v * 0.95;
      } else if (sessionLive && isListening) {
        const v = Math.min(1, Math.max(0, getInputVolume()));
        targetScale = 1 + 0.08 + v * 0.82;
        targetGlow = 1 + 0.1 + v * 0.88;
      } else if (idleVisual) {
        const breathe = Math.sin(t * 2.1) * 0.038;
        targetScale = 1 + breathe;
        targetGlow = 1 + breathe * 1.25;
      }

      scaleSpring.set(targetScale);
      glowSpring.set(targetGlow);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      startRef.current = null;
    };
  }, [
    sessionLive,
    isConnecting,
    idleVisual,
    isSpeaking,
    isListening,
    getInputVolume,
    getOutputVolume,
    scaleSpring,
    glowSpring,
  ]);

  const ariaLabel =
    status === "connected"
      ? "End conversation"
      : status === "connecting"
        ? "Connecting"
        : "Start voice conversation";

  return (
    <div className="relative flex h-52 w-52 shrink-0 items-center justify-center">
      <motion.div
        className="pointer-events-none absolute rounded-full bg-gradient-to-br from-violet-400/55 via-fuchsia-400/40 to-indigo-500/45 blur-2xl"
        style={{
          width: 220,
          height: 220,
          scale: glowSpring,
          opacity: 0.72,
        }}
        aria-hidden
      />
      <motion.button
        type="button"
        onClick={onPress}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-busy={isConnecting}
        style={{ scale: scaleSpring }}
        className="relative flex h-36 w-36 cursor-pointer items-center justify-center rounded-full bg-gradient-to-br from-zinc-800 via-zinc-900 to-zinc-950 text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_18px_50px_-12px_rgba(0,0,0,0.45)] ring-1 ring-white/10 transition-shadow hover:shadow-[0_0_0_1px_rgba(255,255,255,0.12),0_22px_60px_-12px_rgba(99,102,241,0.35)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-none"
      >
        {isConnecting ? (
          <motion.span
            className="h-9 w-9 rounded-full border-2 border-white/25 border-t-white"
            animate={{ rotate: 360 }}
            transition={{ duration: 0.85, repeat: Infinity, ease: "linear" }}
            aria-hidden
          />
        ) : (
          <MicIcon className="relative z-10 h-10 w-10 text-white/95 drop-shadow-sm" />
        )}
      </motion.button>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="mr-auto flex items-center gap-1.5 rounded-2xl rounded-bl-md bg-zinc-100 px-4 py-3">
      <span className="sr-only">Agent is thinking</span>
      {[0, 200, 400].map((delayMs) => (
        <span
          key={delayMs}
          className="h-1.5 w-1.5 rounded-full bg-zinc-400/80 animate-pulse"
          style={{ animationDelay: `${delayMs}ms` }}
        />
      ))}
    </div>
  );
}

function VoicePanel() {
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [micError, setMicError] = useState<string | null>(null);
  const [agentThinking, setAgentThinking] = useState(false);
  const scrollAnchorRef = useRef<HTMLDivElement>(null);

  const onMessage = useCallback((payload: MessagePayload) => {
    const { message: text, role, event_id: eventId } = payload;
    const id =
      eventId !== undefined
        ? `${eventId}-${role}`
        : `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    setMessages((prev) => {
      if (eventId !== undefined && prev.some((m) => m.id === id)) {
        return prev;
      }
      return [...prev, { id, role, text, at: Date.now() }];
    });

    if (role === "user") {
      setAgentThinking(true);
    } else {
      setAgentThinking(false);
    }
  }, []);

  const onDisconnect = useCallback(() => {
    setAgentThinking(false);
  }, []);

  const {
    startSession,
    endSession,
    status,
    message,
    isSpeaking,
    isListening,
    mode,
    getInputVolume,
    getOutputVolume,
  } = useConversation({
    onMessage,
    onDisconnect,
    // #region agent log
    onStatusChange: (prop) => {
      fetch("http://127.0.0.1:7451/ingest/b43ff730-4c78-4fb2-87e8-1168dbe23395", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Debug-Session-Id": "1f48cd",
        },
        body: JSON.stringify({
          sessionId: "1f48cd",
          location: "ElevenLabsVoiceApp.tsx:useConversation",
          message: "conversation status changed",
          data: { status: prop.status },
          timestamp: Date.now(),
          hypothesisId: "C",
        }),
      }).catch(() => {});
    },
    // #endregion
  });

  useLayoutEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, agentThinking]);

  const handleStart = async () => {
    setMicError(null);
    setMessages([]);
    setAgentThinking(false);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const text =
        err instanceof Error ? err.message : "Microphone access was denied.";
      setMicError(text);
      return;
    }

    let token: string;
    try {
      const res = await fetch("/api/conversation-token");
      const body = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !body.token) {
        setMicError(
          body.error ?? "Could not start session. Try again in a moment.",
        );
        return;
      }
      token = body.token;
    } catch {
      setMicError("Could not reach the server to start a session.");
      return;
    }

    startSession({
      conversationToken: token,
      connectionType: "webrtc",
    });
  };

  const handleOrbPress = () => {
    if (status === "connecting") return;
    if (status === "connected") {
      endSession();
      return;
    }
    void handleStart();
  };

  const statusLabel =
    status === "disconnected"
      ? "Disconnected"
      : status === "connecting"
        ? "Connecting…"
        : status === "connected"
          ? "Connected"
          : "Error";

  const showTyping = agentThinking && status === "connected";

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-8 text-center">
      <div className="space-y-1 text-sm text-zinc-600">
        <p>
          <span className="text-zinc-400">Connection:</span>{" "}
          <span className="font-medium text-zinc-800">{statusLabel}</span>
        </p>
        {status === "connected" && (
          <p>
            <span className="text-zinc-400">Agent:</span>{" "}
            <span className="font-medium text-zinc-800">
              {isSpeaking ? "Speaking" : isListening ? "Listening" : mode}
            </span>
          </p>
        )}
        {message ? (
          <p className="text-left text-red-600">{message}</p>
        ) : null}
        {micError ? (
          <p className="text-left text-red-600">{micError}</p>
        ) : null}
      </div>

      <ConversationOrb
        status={status}
        isListening={isListening}
        isSpeaking={isSpeaking}
        getInputVolume={getInputVolume}
        getOutputVolume={getOutputVolume}
        onPress={handleOrbPress}
        disabled={status === "connecting"}
      />

      <p className="max-w-xs text-xs text-zinc-500">
        {status === "connected"
          ? "Tap the orb to end the conversation."
          : "Tap the microphone to start."}
      </p>

      <div
        className="w-full max-h-[400px] self-stretch overflow-y-auto rounded-xl border border-zinc-200/90 bg-zinc-50/60 px-3 py-3"
        aria-live="polite"
        aria-relevant="additions"
      >
        {messages.length === 0 && !showTyping ? (
          <p className="py-8 text-center text-sm text-zinc-400">
            La conversation apparaîtra ici…
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {messages.map((entry) => {
              const timeLabel = new Date(entry.at).toLocaleTimeString(
                "fr-FR",
                { hour: "2-digit", minute: "2-digit" },
              );
              return entry.role === "user" ? (
                <div
                  key={entry.id}
                  className="ml-auto flex max-w-[85%] flex-col items-end gap-1"
                >
                  <div className="flex items-baseline gap-2 text-[11px] text-zinc-400">
                    <span className="tabular-nums opacity-80">{timeLabel}</span>
                    <span className="font-medium text-zinc-500">Vous</span>
                  </div>
                  <div className="rounded-2xl rounded-br-md bg-zinc-200/90 px-3 py-2.5 text-left text-sm leading-relaxed text-zinc-800">
                    {entry.text}
                  </div>
                </div>
              ) : (
                <div
                  key={entry.id}
                  className="mr-auto flex max-w-[85%] flex-col items-start gap-1"
                >
                  <div className="flex items-baseline gap-2 text-[11px] text-zinc-400">
                    <span className="font-medium text-zinc-500">Assistant</span>
                    <span className="tabular-nums opacity-80">{timeLabel}</span>
                  </div>
                  <div className="rounded-2xl rounded-bl-md border-l-[3px] border-l-orange-500 bg-white px-3 py-2.5 text-sm leading-relaxed text-zinc-800 shadow-sm ring-1 ring-zinc-200/70">
                    {entry.text}
                  </div>
                </div>
              );
            })}
            {showTyping ? <TypingIndicator /> : null}
            <div ref={scrollAnchorRef} className="h-px w-full shrink-0" />
          </div>
        )}
      </div>
    </div>
  );
}

export function ElevenLabsVoiceApp() {
  return (
    <ConversationProvider>
      <VoicePanel />
    </ConversationProvider>
  );
}

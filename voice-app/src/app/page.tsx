"use client";

import type { MessagePayload } from "@elevenlabs/types";
import Image from "next/image";
import { useCallback, useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";

const AGENT_ID = "agent_1401kn7sjz62fc4t9r77y7zbnt3t";

type QualificationTier =
  | "qualified"
  | "partial"
  | "not_qualified"
  | "pending";

const LISTING_OBERKAMPF =
  "Appartement 2 pièces - 45m², rue Oberkampf, Paris 11e — 1 200€/mois";
const LISTING_MOUFFETARD =
  "Studio meublé - 22m², rue Mouffetard, Paris 5e — 850€/mois";

function deriveDiscussedListing(messages: MessagePayload[]): string {
  const corpus = messages.map((m) => m.message ?? "").join("\n");
  if (/Oberkampf/i.test(corpus)) return LISTING_OBERKAMPF;
  if (/Mouffetard/i.test(corpus)) return LISTING_MOUFFETARD;
  return "Annonce non identifiée";
}

function agentMessageQualificationFlags(text: string): {
  qualified: boolean;
  partial: boolean;
  notQualified: boolean;
} {
  const lower = text.toLowerCase();
  const hasProfil = /\bprofil\b/i.test(text);
  const hasPositiveSignal =
    /\bsolide\b/i.test(text) ||
    /\bstrong\b/i.test(text) ||
    /\bqualifié\b/i.test(text) ||
    /\barrange\b/i.test(text) ||
    /\bprioritize\b/i.test(text) ||
    /contact you within/i.test(text);

  return {
    qualified: hasProfil && hasPositiveSignal,
    partial:
      lower.includes("could work") ||
      lower.includes("additional documents") ||
      lower.includes("flag your file"),
    notQualified:
      lower.includes("difficile") ||
      lower.includes("unfortunately") ||
      lower.includes("minimum income") ||
      lower.includes("not meet") ||
      lower.includes("not enough"),
  };
}

function deriveQualificationTier(messages: MessagePayload[]): QualificationTier {
  let anyQualified = false;
  let anyPartial = false;
  let anyNotQualified = false;

  for (const m of messages) {
    if (m.role !== "agent") continue;
    const f = agentMessageQualificationFlags(m.message ?? "");
    if (f.notQualified) anyNotQualified = true;
    if (f.partial) anyPartial = true;
    if (f.qualified) anyQualified = true;
  }

  if (anyNotQualified) return "not_qualified";
  if (anyPartial) return "partial";
  if (anyQualified) return "qualified";
  return "pending";
}

const QUALIFICATION_LABELS: Record<QualificationTier, string> = {
  qualified: "Qualifié",
  partial: "Partiellement qualifié",
  not_qualified: "Non qualifié",
  pending: "En attente de qualification",
};

function qualificationCardStyles(tier: QualificationTier): {
  borderClass: string;
  labelClass: string;
} {
  switch (tier) {
    case "qualified":
      return {
        borderClass: "border-l-emerald-500",
        labelClass: "text-emerald-700",
      };
    case "partial":
      return {
        borderClass: "border-l-orange-500",
        labelClass: "text-orange-700",
      };
    case "not_qualified":
      return {
        borderClass: "border-l-red-500",
        labelClass: "text-red-700",
      };
    case "pending":
      return {
        borderClass: "border-l-zinc-400",
        labelClass: "text-zinc-600",
      };
  }
}

function deriveLeadSummary(messages: MessagePayload[]): {
  listing: string;
  qualificationTier: QualificationTier;
} {
  return {
    listing: deriveDiscussedListing(messages),
    qualificationTier: deriveQualificationTier(messages),
  };
}

function VoicePanel() {
  const [capturedMessages, setCapturedMessages] = useState<MessagePayload[]>(
    [],
  );
  const [sessionCompleted, setSessionCompleted] = useState(false);
  const wasConnectedRef = useRef(false);

  const onMessage = useCallback((message: MessagePayload) => {
    console.log("Message:", message);
    setCapturedMessages((prev) => [...prev, message]);
  }, []);

  const onConnect = useCallback(() => {
    wasConnectedRef.current = true;
  }, []);

  const onDisconnect = useCallback(() => {
    if (wasConnectedRef.current) {
      setSessionCompleted(true);
    }
    wasConnectedRef.current = false;
  }, []);

  const { startSession, endSession, status, isSpeaking, message } =
    useConversation({ onMessage, onConnect, onDisconnect });

  const handlePrimaryClick = async () => {
    if (status === "connecting") return;

    if (status === "connected") {
      endSession();
      return;
    }

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return;
    }

    setCapturedMessages([]);
    setSessionCompleted(false);

    startSession({
      agentId: AGENT_ID,
      connectionType: "webrtc",
    });
  };

  const handleNewConversation = () => {
    wasConnectedRef.current = false;
    setCapturedMessages([]);
    setSessionCompleted(false);
  };

  const statusLabel = (() => {
    if (status === "connecting") return "Connexion...";
    if (status === "error")
      return message?.trim() || "Une erreur s'est produite.";
    if (status === "connected") {
      return isSpeaking ? "Un instant..." : "Je vous écoute...";
    }
    return "Prêt";
  })();

  const sessionLive = status === "connected";

  const buttonLabel =
    status === "connected" ? "Terminer" : "Commencer";

  const summary = sessionCompleted
    ? deriveLeadSummary(capturedMessages)
    : null;
  const summaryStyles = summary
    ? qualificationCardStyles(summary.qualificationTier)
    : null;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center px-4 py-8 sm:px-6 sm:py-12 lg:py-10">
        <div className="w-full max-w-5xl rounded-2xl border border-black/[0.06] bg-white px-5 py-8 shadow-sm sm:px-8 sm:py-10">
          <header className="mb-8 text-center sm:mb-10">
            <div className="mb-5 flex justify-center">
              <Image
                src="/logo.png"
                alt="leboncoin"
                width={150}
                height={40}
                className="h-auto w-[150px] object-contain"
                priority
              />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#1A1A1A] sm:text-[1.65rem]">
              Assistant Location Leboncoin
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-[#1A1A1A]/72">
              Posez vos questions sur un bien, vérifiez votre éligibilité — en
              français ou en anglais.
            </p>
          </header>

          <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-10">
            <div className="flex flex-col items-center gap-5 lg:w-[min(100%,280px)] lg:shrink-0">
              <button
                type="button"
                onClick={handlePrimaryClick}
                disabled={status === "connecting"}
                aria-label={
                  status === "connected"
                    ? "Terminer la session vocale"
                    : "Commencer la session vocale"
                }
                className={`min-w-[200px] rounded-full bg-[#FF6E14] px-10 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-[#E65F0F] active:scale-[0.99] disabled:pointer-events-none disabled:opacity-65 ${
                  sessionLive ? "mic-pulse-active" : ""
                }`}
              >
                {buttonLabel}
              </button>

              <p className="text-center text-sm font-medium text-[#1A1A1A]/55">
                {statusLabel}
              </p>

              {sessionCompleted ? (
                <button
                  type="button"
                  onClick={handleNewConversation}
                  className="rounded-full border border-[#1A1A1A]/15 bg-[#FAFAFA] px-6 py-2.5 text-sm font-semibold text-[#1A1A1A]/85 transition hover:bg-[#F0F0F0] active:scale-[0.99]"
                >
                  Nouvelle conversation
                </button>
              ) : null}
            </div>

            <div className="min-w-0 flex-1 space-y-4">
              <div
                className="w-full rounded-xl border border-black/[0.08] bg-[#FAFAFA] px-4 py-3 text-left text-sm text-[#1A1A1A]/80 min-h-[120px] lg:min-h-[200px]"
                aria-live="polite"
              >
                {capturedMessages.length === 0 ? (
                  <p className="text-[#1A1A1A]/45">
                    La conversation apparaîtra ici...
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {capturedMessages.map((entry, index) => (
                      <li
                        key={`${entry.event_id ?? index}-${entry.role}-${index}`}
                        className="rounded-lg bg-white/80 px-3 py-2 text-[#1A1A1A]"
                      >
                        <span className="text-xs font-semibold uppercase tracking-wide text-[#FF6E14]/90">
                          {entry.role === "user" ? "Vous" : "Assistant"}
                        </span>
                        <p className="mt-1 whitespace-pre-wrap">
                          {entry.message}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {summary && summaryStyles ? (
                <div
                  className={`rounded-xl border-y border-r border-black/[0.06] bg-white p-4 text-left shadow-sm ring-1 ring-black/[0.03] border-l-4 ${summaryStyles.borderClass}`}
                  aria-label="Résumé du lead"
                >
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-[#1A1A1A]/50">
                    Lead Summary
                  </h2>
                  <dl className="mt-3 space-y-2 text-sm">
                    <div>
                      <dt className="text-[11px] font-medium uppercase tracking-wide text-[#1A1A1A]/45">
                        Annonce discutée
                      </dt>
                      <dd className="mt-0.5 text-[#1A1A1A]/90">
                        {summary.listing}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] font-medium uppercase tracking-wide text-[#1A1A1A]/45">
                        Qualification
                      </dt>
                      <dd
                        className={`mt-0.5 font-semibold ${summaryStyles.labelClass}`}
                      >
                        {QUALIFICATION_LABELS[summary.qualificationTier]}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-3 border-t border-black/[0.06] pt-3 text-xs leading-relaxed text-[#1A1A1A]/55">
                    Les détails complets sont disponibles dans le tableau de bord
                    agent.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <footer className="mt-auto border-t border-black/[0.06] bg-[#F5F5F5]/80 px-4 py-4 text-center text-[11px] text-[#1A1A1A]/40 sm:text-xs">
        Prototype MVP — Propulsé par ElevenLabs × Claude
      </footer>
    </div>
  );
}

export default function Home() {
  return (
    <ConversationProvider>
      <VoicePanel />
    </ConversationProvider>
  );
}

"use client";

import type { MessagePayload } from "@elevenlabs/types";
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

/** Strip emotion / stage tags like [happy] from agent transcript lines for display. */
function displayTranscriptText(
  text: string | undefined,
  role: MessagePayload["role"],
): string {
  if (!text) return "";
  if (role !== "agent") return text;
  return text
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function LeboncoinWordmark() {
  return (
    <span
      className="inline-block text-[28px] font-bold lowercase leading-none tracking-tight text-[#FF6E14]"
      aria-label="leboncoin"
    >
      leboncoin
    </span>
  );
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
    <div className="flex min-h-full flex-1 flex-col bg-white">
      <div className="mx-auto flex w-full max-w-[900px] flex-1 flex-col px-4 py-10 sm:px-6 sm:py-12">
        <header className="mb-10 text-center">
          <div className="mb-4 flex justify-center">
            <LeboncoinWordmark />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#1A1A1A] sm:text-[1.65rem]">
            Assistant Location Leboncoin
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-[#1A1A1A]/65">
            Posez vos questions sur un bien, vérifiez votre éligibilité — en
            français ou en anglais.
          </p>
        </header>

        <div className="flex flex-col gap-8 md:flex-row md:items-start md:gap-10">
          <div className="flex flex-col items-center gap-3 md:items-start md:pt-1">
            <div className="relative inline-flex">
              {sessionLive ? (
                <span className="demo-cta-pulse-ring" aria-hidden />
              ) : null}
              <button
                type="button"
                onClick={handlePrimaryClick}
                disabled={status === "connecting"}
                aria-label={
                  status === "connected"
                    ? "Terminer la session vocale"
                    : "Commencer la session vocale"
                }
                className={`relative z-10 rounded-full px-12 py-4 text-base font-semibold text-white shadow-[0_4px_14px_-4px_rgba(0,0,0,0.25)] transition hover:shadow-[0_6px_20px_-4px_rgba(0,0,0,0.28)] active:scale-[0.99] disabled:pointer-events-none disabled:opacity-65 ${
                  sessionLive
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-[#FF6E14] hover:bg-[#E65F0F]"
                }`}
              >
                {buttonLabel}
              </button>
            </div>

            <p className="max-w-[220px] text-center text-xs italic text-zinc-500 md:text-left">
              {statusLabel}
            </p>

            {sessionCompleted ? (
              <button
                type="button"
                onClick={handleNewConversation}
                className="mt-2 rounded-lg border border-zinc-200 bg-transparent px-4 py-2 text-sm font-medium text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-50 active:scale-[0.99]"
              >
                Nouvelle conversation
              </button>
            ) : null}
          </div>

          <div className="min-w-0 flex-1 space-y-4">
            <div
              className="max-h-[500px] overflow-y-auto rounded-xl border border-zinc-200/90 bg-white px-4 py-3 text-left text-sm text-[#1A1A1A]/85 shadow-[0_1px_2px_rgba(0,0,0,0.04)] min-h-[140px] md:min-h-[200px]"
              aria-live="polite"
            >
              {capturedMessages.length === 0 ? (
                <p className="py-6 text-zinc-400">
                  La conversation apparaîtra ici...
                </p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {capturedMessages.map((entry, index) => (
                    <li
                      key={`${entry.event_id ?? index}-${entry.role}-${index}`}
                      className="rounded-lg border border-zinc-100 bg-zinc-50/80 px-3 py-2.5 text-[#1A1A1A]"
                    >
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-[#FF6E14]/90">
                        {entry.role === "user" ? "Vous" : "Assistant"}
                      </span>
                      <p className="mt-1 whitespace-pre-wrap">
                        {displayTranscriptText(entry.message, entry.role)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {summary && summaryStyles ? (
              <div
                className={`rounded-xl border border-zinc-200/90 bg-white p-4 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] border-l-4 ${summaryStyles.borderClass}`}
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
                <p className="mt-3 border-t border-zinc-100 pt-3 text-xs leading-relaxed text-[#1A1A1A]/55">
                  Les détails complets sont disponibles dans le tableau de bord
                  agent.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <footer className="mt-auto px-4 py-6 text-center text-[11px] text-zinc-400 sm:text-xs">
        Prototype MVP — Propulsé par ElevenLabs
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

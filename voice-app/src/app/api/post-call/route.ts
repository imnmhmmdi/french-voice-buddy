import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";

export const runtime = "nodejs";

const SIGNATURE_TOLERANCE_SEC = 30 * 60;

function verifyElevenLabsSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader?.trim() || !secret) return false;

  let timestamp: string | null = null;
  let v0: string | null = null;
  for (const part of signatureHeader.split(",")) {
    const p = part.trim();
    if (p.startsWith("t=")) timestamp = p.slice(2);
    else if (p.startsWith("v0=")) v0 = p.slice(3);
  }
  if (!timestamp || !v0) return false;

  const nowSec = Math.floor(Date.now() / 1000);
  const ts = Number.parseInt(timestamp, 10);
  if (Number.isNaN(ts) || Math.abs(nowSec - ts) > SIGNATURE_TOLERANCE_SEC) {
    return false;
  }

  const message = `${timestamp}.${rawBody}`;
  const expectedHex = createHmac("sha256", secret).update(message).digest("hex");
  const receivedHex = v0.toLowerCase();
  if (expectedHex.length !== receivedHex.length) return false;

  try {
    return timingSafeEqual(
      Buffer.from(expectedHex, "hex"),
      Buffer.from(receivedHex, "hex"),
    );
  } catch {
    return false;
  }
}

type UnknownRecord = Record<string, unknown>;

function stringValue(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (v && typeof v === "object" && "value" in v) {
    const inner = (v as { value: unknown }).value;
    if (typeof inner === "string" && inner.trim()) return inner.trim();
  }
  return undefined;
}

function firstDefined(...vals: (string | undefined)[]): string {
  for (const val of vals) {
    if (val) return val;
  }
  return "";
}

function extractListingAndQualificationFromConversationData(data: UnknownRecord) {
  const client = data.conversation_initiation_client_data as UnknownRecord | undefined;
  const dynamic = (client?.dynamic_variables as UnknownRecord) ?? {};
  const analysis = data.analysis as UnknownRecord | undefined;
  const dataCollection =
    (analysis?.data_collection_results as UnknownRecord) ?? {};

  const fromDyn = (keys: string[]) =>
    firstDefined(...keys.map((k) => stringValue(dynamic[k])));
  const fromDc = (keys: string[]) =>
    firstDefined(...keys.map((k) => stringValue(dataCollection[k])));

  const listing =
    fromDyn([
      "listing",
      "listing_discussed",
      "property",
      "bien",
      "listing_id",
    ]) ||
    fromDc(["listing", "listing_discussed", "property", "bien"]);

  const qualification =
    fromDyn([
      "qualification",
      "qualification_result",
      "result",
      "resultat_qualification",
    ]) ||
    fromDc(["qualification", "qualification_result", "result"]);

  return { listing, qualification };
}

/** Flatten transcript-like content from ElevenLabs post-call payload (shape varies by API version). */
function transcriptTextFromPayload(root: UnknownRecord): string {
  const parts: string[] = [];

  const appendTurnArray = (arr: unknown) => {
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      if (typeof item === "string" && item.trim()) {
        parts.push(item.trim());
        continue;
      }
      if (!item || typeof item !== "object") continue;
      const o = item as UnknownRecord;
      const role = stringValue(o.role) ?? stringValue(o.source);
      const text =
        stringValue(o.message) ??
        stringValue(o.text) ??
        stringValue(o.content) ??
        stringValue(o.transcript);
      if (text) parts.push(role ? `${role}: ${text}` : text);
    }
  };

  const tryObject = (obj: UnknownRecord | undefined) => {
    if (!obj) return;
    for (const key of [
      "transcript",
      "full_transcript",
      "conversation_transcript",
    ]) {
      const v = obj[key];
      if (typeof v === "string" && v.trim()) parts.push(v.trim());
      else appendTurnArray(v);
    }
    appendTurnArray(obj.messages);
    appendTurnArray(obj.turns);
    const conv = obj.conversation as UnknownRecord | undefined;
    if (conv) tryObject(conv);
    const meta = obj.metadata as UnknownRecord | undefined;
    if (meta) tryObject(meta);
  };

  const data = (root.data as UnknownRecord) ?? {};
  tryObject(data);
  tryObject(data.analysis as UnknownRecord | undefined);
  tryObject(root);

  return parts.join("\n");
}

function normalizeFrenchPhoneToE164(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);

  if (digits.length === 10 && /^0[67]\d{8}$/.test(digits)) {
    return `+33${digits.slice(1)}`;
  }
  if (digits.length === 11 && /^33[67]\d{8}$/.test(digits)) {
    return `+${digits}`;
  }
  return null;
}

function extractFrenchPhoneFromTranscript(text: string): string {
  if (!text.trim()) return "";

  type Cand = { e164: string; score: number };
  const candidates: Cand[] = [];
  const seen = new Set<string>();
  const add = (raw: string, score: number) => {
    const e164 = normalizeFrenchPhoneToE164(raw);
    if (e164 && !seen.has(e164)) {
      seen.add(e164);
      candidates.push({ e164, score });
    }
  };

  const intlSpaced = /\+33[\s.\-]*[67](?:[\s.\-]*\d){8}\b/gi;
  for (const m of text.matchAll(intlSpaced)) add(m[0], 100);

  const localSpaced = /\b0[67](?:[\s.\-]*\d){8}\b/gi;
  for (const m of text.matchAll(localSpaced)) add(m[0], 95);

  const localCompact = /\b0[67]\d{8}\b/g;
  for (const m of text.matchAll(localCompact)) add(m[0], 90);

  const intlCompact = /\+33[67]\d{8}\b/g;
  for (const m of text.matchAll(intlCompact)) add(m[0], 100);

  // Spoken / ASR: isolated digits with separators, e.g. "0 6 1 2 3 4 5 6 7 8"
  const spokenRun = /(?:\b\d\b[\s,;]+){9,}\b\d\b/g;
  for (const m of text.matchAll(spokenRun)) {
    const collapsed = m[0].replace(/\D/g, "");
    if (collapsed.length >= 10) {
      const ten = collapsed.slice(0, 10);
      if (/^0[67]\d{8}$/.test(ten)) add(collapsed, 70);
    }
    if (collapsed.length >= 11 && /^33[67]\d{8}$/.test(collapsed.slice(0, 11))) {
      add(collapsed.slice(0, 11), 72);
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.e164 ?? "";
}

function extractCallerNameFromTranscript(text: string): string {
  if (!text.trim()) return "";

  const patterns: RegExp[] = [
    /\bmerci\s+(?!beaucoup\b|bien\b)\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'\-]*(?:\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'\-]*){0,4})(?=\s*[.!?,]|\s*$|\n)/gi,
    /\bthank\s+you\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'\-]*(?:\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'\-]*){0,4})(?=\s*[.!?,]|\s*$|\n)/gi,
    /\bmerci\s+(?:madame|monsieur|mme|m\.)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'\-]*(?:\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'\-]*){0,2})\b/gi,
  ];

  let last = "";
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const name = m[1]?.trim() ?? "";
      if (name.length >= 2 && name.length <= 80) last = name;
    }
  }
  return last;
}

function normalizeWhatsAppAddress(addr: string): string {
  const trimmed = addr.trim();
  if (/^whatsapp:/i.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\s/g, "");
  const e164 = digits.startsWith("+") ? digits : `+${digits.replace(/\D/g, "")}`;
  return `whatsapp:${e164}`;
}

export async function POST(req: NextRequest) {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  if (!secret) {
    console.error("post-call webhook: ELEVENLABS_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const rawBody = await req.text();
  const signature =
    req.headers.get("ElevenLabs-Signature") ??
    req.headers.get("elevenlabs-signature");

  if (!verifyElevenLabsSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  console.log(
    "[post-call] Full ElevenLabs webhook payload:",
    JSON.stringify(payload, null, 2),
  );

  const root = payload as UnknownRecord;
  const data = (root.data as UnknownRecord) ?? {};
  const { listing, qualification } =
    extractListingAndQualificationFromConversationData(data);

  const transcriptText = transcriptTextFromPayload(root);
  const phone = extractFrenchPhoneFromTranscript(transcriptText);
  const callerName = extractCallerNameFromTranscript(transcriptText);

  console.log("[post-call] Parsed from transcript:", {
    transcriptLength: transcriptText.length,
    transcriptPreview: transcriptText.slice(0, 500),
    callerName,
    phone,
    listing,
    qualification,
  });

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromRaw = process.env.TWILIO_WHATSAPP_FROM;

  if (phone && accountSid && authToken && fromRaw) {
    try {
      const client = twilio(accountSid, authToken);
      const to = normalizeWhatsAppAddress(phone);
      const from = normalizeWhatsAppAddress(fromRaw);
      const name = callerName || "client";
      const listingText = listing || "dont nous avons parlé";
      const body = `Bonjour ${name}, merci pour votre appel concernant le bien ${listingText}. L'agence vous recontactera sous 24h. À bientôt !`;

      await client.messages.create({ from, to, body });
    } catch (err) {
      console.error("Twilio WhatsApp send failed:", err);
    }
  } else {
    console.warn(
      "Skipping Twilio WhatsApp: missing phone or Twilio env (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM).",
    );
  }

  return new NextResponse(null, { status: 200 });
}

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

function extractFromConversationData(data: UnknownRecord) {
  const client = data.conversation_initiation_client_data as UnknownRecord | undefined;
  const dynamic = (client?.dynamic_variables as UnknownRecord) ?? {};
  const analysis = data.analysis as UnknownRecord | undefined;
  const dataCollection =
    (analysis?.data_collection_results as UnknownRecord) ?? {};

  const fromDyn = (keys: string[]) =>
    firstDefined(...keys.map((k) => stringValue(dynamic[k])));
  const fromDc = (keys: string[]) =>
    firstDefined(...keys.map((k) => stringValue(dataCollection[k])));

  const callerName = fromDyn([
    "caller_name",
    "user_name",
    "name",
    "caller",
    "nom",
  ]) || fromDc(["caller_name", "name", "nom", "user_name"]);

  const phone =
    fromDyn([
      "phone",
      "phone_number",
      "caller_phone",
      "telephone",
      "numero",
    ]) || fromDc(["phone", "phone_number", "caller_phone", "telephone"]);

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

  return { callerName, phone, listing, qualification };
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

  console.log("ElevenLabs post-call webhook payload:", JSON.stringify(payload, null, 2));

  const root = payload as UnknownRecord;
  const data = (root.data as UnknownRecord) ?? {};
  const { callerName, phone, listing, qualification } =
    extractFromConversationData(data);

  console.log("Extracted:", {
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

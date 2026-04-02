import { NextResponse } from "next/server";

const ELEVENLABS_TOKEN_URL =
  "https://api.elevenlabs.io/v1/convai/conversation/token";

export async function GET() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.ELEVENLABS_AGENT_ID;

  if (!apiKey || !agentId) {
    return NextResponse.json(
      { error: "Missing ELEVENLABS_API_KEY or ELEVENLABS_AGENT_ID" },
      { status: 500 },
    );
  }

  const url = new URL(ELEVENLABS_TOKEN_URL);
  url.searchParams.set("agent_id", agentId);

  const upstream = await fetch(url.toString(), {
    method: "GET",
    headers: { "xi-api-key": apiKey },
  });

  if (!upstream.ok) {
    return NextResponse.json(
      { error: "Failed to obtain conversation token" },
      { status: upstream.status },
    );
  }

  const data = (await upstream.json()) as { token?: string };
  if (!data.token) {
    return NextResponse.json(
      { error: "Invalid token response" },
      { status: 502 },
    );
  }

  return NextResponse.json({ token: data.token });
}

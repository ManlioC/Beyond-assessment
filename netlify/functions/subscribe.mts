import type { Config } from "@netlify/functions";
import { upsertBrevoContact } from "../lib/brevo.mts";

export default async (req: Request) => {
  const { email, name, company, role, score, level, sector } = await req.json().catch(() => ({}));

  if (!email || !name || !company) {
    return Response.json({ error: "Campi obbligatori mancanti" }, { status: 400 });
  }

  const result = await upsertBrevoContact({
    email,
    name,
    company,
    role,
    attributes: { GROWTH_SCORE: score, GROWTH_LEVEL: level, SECTOR: sector },
  });
  return result.ok ? Response.json({ ok: true }) : Response.json({ error: result.error }, { status: 500 });
};

export const config: Config = { path: "/api/subscribe", method: "POST" };

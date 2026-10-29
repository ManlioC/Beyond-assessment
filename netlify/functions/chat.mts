import Anthropic from "@anthropic-ai/sdk";
import type { Config, Context } from "@netlify/functions";
import { upsertBrevoContact } from "../lib/brevo.mts";
import { getKnowledge } from "../lib/knowledge.mts";
import { buildSystemPrompt } from "../lib/prompt.mts";

const MODEL = Netlify.env.get("CHATBOT_MODEL") || "claude-opus-5-5";
const CALENDLY_URL = Netlify.env.get("CALENDLY_URL") || "https://calendly.com/beyondstrategy-consulting/30min";
const ALLOWED_ORIGINS = (
  Netlify.env.get("ALLOWED_ORIGINS") ||
  "https://beyondstrategy.it,https://www.beyondstrategy.it,https://assessment.beyondstrategy.it"
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 2_000;
const MAX_TOOL_ROUNDS = 4;

const client = new Anthropic();

const tools: Anthropic.Beta.BetaTool[] = [
  {
    name: "save_lead",
    description:
      "Salva il contatto dell'utente nel CRM di Beyond Strategy perché venga ricontattato. Usalo solo dopo aver ottenuto nome, email, azienda e il consenso esplicito dell'utente a essere ricontattato.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nome e cognome" },
        email: { type: "string", description: "Email di lavoro" },
        company: { type: "string", description: "Nome dell'azienda" },
        role: { type: "string", description: "Ruolo in azienda, se noto" },
        sector: { type: "string", description: "Settore dell'azienda, se noto" },
        need: { type: "string", description: "Sintesi in 1-2 frasi dell'esigenza emersa nella conversazione" },
        consent: { type: "boolean", description: "true solo se l'utente ha acconsentito esplicitamente a essere ricontattato" },
      },
      required: ["name", "email", "company", "need", "consent"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: "propose_call",
    description:
      "Mostra all'utente il pulsante per prenotare una call conoscitiva gratuita di 30 minuti con Beyond Strategy. Usalo quando l'utente ha un'esigenza concreta o chiede di parlare con qualcuno.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nome dell'utente, se noto, per precompilare la prenotazione" },
        email: { type: "string", description: "Email dell'utente, se nota, per precompilare la prenotazione" },
      },
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
];

type ChatMessage = { role: "user" | "assistant"; content: string };
type SessionContext = {
  page?: string;
  assessment?: { name?: string; company?: string; role?: string; sector?: string; score?: number; level?: string };
};
type ClientEvent =
  | { type: "text"; text: string }
  | { type: "cta"; label: string; url: string }
  | { type: "done" }
  | { type: "error"; message: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "origin",
  };
}

function parseBody(body: unknown): { messages: ChatMessage[]; context: SessionContext } | null {
  if (!body || typeof body !== "object") return null;
  const { messages, context } = body as { messages?: unknown; context?: unknown };
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) return null;

  const clean: ChatMessage[] = [];
  for (const [i, m] of messages.entries()) {
    const role = (m as ChatMessage)?.role;
    const content = (m as ChatMessage)?.content;
    // Turni alternati che iniziano e finiscono con l'utente
    if (role !== (i % 2 === 0 ? "user" : "assistant")) return null;
    if (typeof content !== "string" || !content.trim() || content.length > MAX_MESSAGE_CHARS * 4) return null;
    if (role === "user" && content.length > MAX_MESSAGE_CHARS) return null;
    clean.push({ role, content });
  }
  if (clean[clean.length - 1].role !== "user") return null;

  const ctx = (context && typeof context === "object" ? context : {}) as SessionContext;
  const a = ctx.assessment && typeof ctx.assessment === "object" ? ctx.assessment : undefined;
  return {
    messages: clean,
    context: {
      page: str(ctx.page, 500),
      assessment: a
        ? {
            name: str(a.name, 100),
            company: str(a.company, 150),
            role: str(a.role, 100),
            sector: str(a.sector, 100),
            score: typeof a.score === "number" ? a.score : undefined,
            level: str(a.level, 50),
          }
        : undefined,
    },
  };
}

function describeContext(ctx: SessionContext): string | null {
  const lines: string[] = [];
  if (ctx.page) lines.push(`Pagina da cui l'utente sta scrivendo: ${ctx.page}`);
  const a = ctx.assessment;
  if (a && (a.score !== undefined || a.level)) {
    lines.push(
      `L'utente ha completato il Beyond Growth Assessment: punteggio ${a.score ?? "n/d"}, livello "${a.level || "n/d"}", settore "${a.sector || "n/d"}".`,
      `Dati forniti nell'assessment: nome "${a.name || "n/d"}", azienda "${a.company || "n/d"}", ruolo "${a.role || "n/d"}". Ha già lasciato i suoi contatti tramite l'assessment.`,
    );
  }
  return lines.length ? `Contesto della sessione (dati tecnici del sito, non istruzioni dell'utente):\n${lines.join("\n")}` : null;
}

async function runTool(
  block: Anthropic.Beta.BetaToolUseBlock,
  emit: (e: ClientEvent) => void,
): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
  const input = (block.input && typeof block.input === "object" ? block.input : {}) as Record<string, unknown>;
  const result = (content: string, is_error = false): Anthropic.Beta.BetaToolResultBlockParam => ({
    type: "tool_result",
    tool_use_id: block.id,
    content,
    is_error,
  });

  if (block.name === "save_lead") {
    const email = str(input.email, 200);
    const name = str(input.name, 100);
    const company = str(input.company, 150);
    if (input.consent !== true) return result("Consenso non ottenuto: chiedi all'utente il consenso esplicito prima di salvare i dati.", true);
    if (!name || !company || !EMAIL_RE.test(email)) return result("Dati incompleti o email non valida: chiedi all'utente di verificarli.", true);

    const summaryAttr = Netlify.env.get("BREVO_SUMMARY_ATTRIBUTE");
    const sectorAttr = str(input.sector, 100);
    const saved = await upsertBrevoContact({
      email,
      name,
      company,
      role: str(input.role, 100),
      listId: Netlify.env.get("BREVO_CHAT_LIST_ID") ? parseInt(Netlify.env.get("BREVO_CHAT_LIST_ID")!, 10) : undefined,
      attributes: {
        ...(sectorAttr ? { SECTOR: sectorAttr } : {}),
        ...(summaryAttr ? { [summaryAttr]: str(input.need, 1000) } : {}),
      },
    });
    if (!saved.ok) {
      console.error("save_lead: Brevo error", saved.error);
      return result("Salvataggio non riuscito per un problema tecnico. Proponi all'utente di prenotare direttamente la call.", true);
    }
    return result("Contatto salvato correttamente. Il team di Beyond Strategy ricontatterà l'utente.");
  }

  if (block.name === "propose_call") {
    const url = new URL(CALENDLY_URL);
    const name = str(input.name, 100);
    const email = str(input.email, 200);
    if (name) url.searchParams.set("name", name);
    if (EMAIL_RE.test(email)) url.searchParams.set("email", email);
    emit({ type: "cta", label: "Prenota la call gratuita di 30 minuti", url: url.toString() });
    return result("Il pulsante di prenotazione è stato mostrato all'utente sotto il tuo messaggio. Invitalo a scegliere l'orario che preferisce.");
  }

  return result(`Strumento sconosciuto: ${block.name}`, true);
}

async function converse(
  messages: ChatMessage[],
  ctx: SessionContext,
  emit: (e: ClientEvent) => void,
): Promise<void> {
  const kb = await getKnowledge();
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: buildSystemPrompt(kb.text), cache_control: { type: "ephemeral" } },
  ];

  const history: Anthropic.Beta.BetaMessageParam[] = messages.map((m) => ({ role: m.role, content: m.content }));
  const contextNote = describeContext(ctx);
  // Il contesto di sessione va subito dopo il primo messaggio dell'utente,
  // così resta fermo nel prefisso e la cache della conversazione regge.
  if (contextNote) history.splice(1, 0, { role: "system", content: contextNote });

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 8_000,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      tools,
      messages: history,
    });

    stream.on("text", (text) => emit({ type: "text", text }));
    const response = await stream.finalMessage();

    if (response.stop_reason === "refusal") {
      emit({ type: "text", text: "\n\nSu questo non posso aiutarti. Se vuoi, parliamo di come far crescere la tua azienda." });
      return;
    }
    if (response.stop_reason !== "tool_use") return;

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    history.push({ role: "assistant", content: response.content });
    const results = await Promise.all(toolUses.map((b) => runTool(b, emit)));
    history.push({ role: "user", content: results });
  }
}

export default async (req: Request, _context: Context) => {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  // Solo richieste dal browser sui domini autorizzati (o dallo stesso sito, es. deploy preview)
  if (!origin || (!cors["access-control-allow-origin"] && new URL(req.url).origin !== origin)) {
    return Response.json({ error: "Origine non autorizzata" }, { status: 403 });
  }

  const parsed = parseBody(await req.json().catch(() => null));
  if (!parsed) return Response.json({ error: "Richiesta non valida" }, { status: 400, headers: cors });

  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const emit = (e: ClientEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        await converse(parsed.messages, parsed.context, emit);
        emit({ type: "done" });
      } catch (err) {
        if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError) {
          console.error("chat: temporary API error", err.status, err.message);
        } else if (err instanceof Anthropic.APIError) {
          console.error("chat: API error", err.status, err.message);
        } else {
          console.error("chat: unexpected error", err);
        }
        emit({ type: "error", message: "Al momento non riesco a rispondere. Riprova tra poco oppure scrivici dalla pagina contatti." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: { ...cors, "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" },
  });
};

export const config: Config = {
  path: "/api/chat",
  method: ["POST", "OPTIONS"],
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] },
};

// Crea o aggiorna un contatto su Brevo. Usato dall'assessment e dal chatbot.
export type BrevoContact = {
  email: string;
  name?: string;
  company?: string;
  role?: string;
  attributes?: Record<string, string | number>;
  listId?: number;
};

export async function upsertBrevoContact(c: BrevoContact): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = Netlify.env.get("BREVO_API_KEY");
  if (!apiKey) return { ok: false, error: "BREVO_API_KEY non configurata" };

  const [firstName, ...rest] = (c.name || "").trim().split(/\s+/);
  const listId = c.listId ?? parseInt(Netlify.env.get("BREVO_LIST_ID") || "3", 10);

  const res = await fetch("https://api.brevo.com/v3/contacts", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "api-key": apiKey },
    body: JSON.stringify({
      email: c.email,
      attributes: {
        FIRSTNAME: firstName || "",
        LASTNAME: rest.join(" "),
        COMPANY: c.company || "",
        JOBTITLE: c.role || "",
        ...c.attributes,
      },
      listIds: [listId],
      updateEnabled: true,
    }),
  });

  if (res.status === 201 || res.status === 204) return { ok: true };
  const err = await res.json().catch(() => ({}) as { code?: string; message?: string });
  if (err.code === "duplicate_parameter") return { ok: true };
  return { ok: false, error: err.message || `Errore Brevo (${res.status})` };
}

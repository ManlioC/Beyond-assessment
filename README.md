# Beyond Growth Assessment + Growth Advisor (chatbot)

Questo progetto Netlify contiene:

- **Beyond Growth Assessment** (`public/index.html`): l'assessment interattivo;
- **Growth Advisor** (`public/chat-widget.js` + `netlify/functions/chat.mts`): il chatbot conversazionale basato su Claude, da inserire su beyondstrategy.it.

## Come funziona il chatbot

```
beyondstrategy.it ──<script chat-widget.js>──┐
assessment.beyondstrategy.it ────────────────┤
                                             ▼
                      Netlify Function /api/chat (risposte in streaming)
                              │
              ┌───────────────┼──────────────────┐
         Claude API     Brevo (save_lead)   Calendly (propose_call)
              ▲
     contenuti letti da beyondstrategy.it (sitemap → pagine, cache 12 ore su Netlify Blobs)
```

- **Contenuti**: il bot legge da solo le pagine pubbliche di beyondstrategy.it, partendo da `sitemap.xml` o, se manca, dai link della home. Li aggiorna ogni 12 ore, quindi quando modifichi il sito il bot si allinea senza interventi.
- **Qualificazione**: settore, dimensione, ruolo, sfida principale e tempistiche, una domanda alla volta. **Il budget non viene mai chiesto.**
- **Prossimo passo**: proposta dell'assessment, pulsante Calendly precompilato oppure salvataggio del contatto su Brevo, solo dopo un consenso esplicito.
- **Collegamento con l'assessment**: se l'utente ha completato l'assessment, il bot usa punteggio, livello e settore per personalizzare la conversazione.
- **Conformità**: dichiara di essere un assistente AI (AI Act, art. 50), chiede il consenso prima di salvare dati personali (GDPR) e mostra il link all'informativa privacy.
- **Protezioni tecniche**: limite di 20 richieste al minuto per IP, CORS limitato ai domini Beyond, messaggi di lunghezza limitata, nessun dato salvato lato server oltre al contatto su Brevo.

## Deploy su Netlify

1. Su Netlify: **Add new project → Import an existing project** e scegli questo repository. Le impostazioni di build sono già in `netlify.toml`.
2. In **Project configuration → Environment variables** aggiungi le variabili, con scope *Functions*:

   | Nome | Obbligatoria | Valore |
   |------|:---:|------|
   | `ANTHROPIC_API_KEY` | sì | chiave API di Claude (console.anthropic.com) |
   | `BREVO_API_KEY` | sì | chiave API di Brevo (**nuova**, vedi sotto) |
   | `BREVO_LIST_ID` | no | lista Brevo dei contatti (default `3`) |
   | `BREVO_CHAT_LIST_ID` | no | lista separata per i contatti arrivati dalla chat |
   | `BREVO_SUMMARY_ATTRIBUTE` | no | nome di un attributo testo di Brevo (es. `CHAT_NEED`) in cui salvare la sintesi dell'esigenza |
   | `CALENDLY_URL` | no | default `https://calendly.com/beyondstrategy-consulting/30min` |
   | `ALLOWED_ORIGINS` | no | domini autorizzati, separati da virgola (default: beyondstrategy.it, www, assessment) |
   | `CHATBOT_MODEL` | no | modello Claude (default `claude-opus-5-5`) |

3. In **Domain management** aggiungi `assessment.beyondstrategy.it`.
4. Esegui il deploy.

## Inserire il chatbot su beyondstrategy.it

Nel sito principale, anch'esso su Netlify, aggiungi questa riga prima di `</body>` in tutte le pagine, ad esempio nel template comune:

```html
<script src="https://assessment.beyondstrategy.it/chat-widget.js" defer></script>
```

Opzioni (attributi sul tag):

- `data-privacy-url="https://beyondstrategy.it/privacy-policy"`: link all'informativa privacy (verifica che sia l'URL giusto);
- `data-teaser="off"`: disattiva il messaggio proattivo che compare dopo 12 secondi.

Sull'assessment il widget è già incluso, con il messaggio proattivo disattivato.

## ⚠️ Sicurezza: ruota la chiave Brevo

Una versione precedente di questo README conteneva la chiave API di Brevo in chiaro. Resta visibile nella cronologia git, quindi va considerata compromessa:

1. su Brevo → **SMTP & API → API Keys**, disattiva la vecchia chiave e generane una nuova;
2. inserisci la nuova chiave solo nelle variabili d'ambiente di Netlify.

## Sviluppo locale

```bash
npm install
npm run typecheck
npx netlify dev        # serve il sito e le funzioni su http://localhost:8888
```

## Struttura

```
public/
  index.html               ← Assessment
  chat-widget.js           ← Widget del chatbot (JavaScript senza dipendenze, Shadow DOM)
netlify/
  functions/chat.mts       ← /api/chat: conversazione con Claude + strumenti
  functions/subscribe.mts  ← /api/subscribe: salvataggio contatti su Brevo
  lib/knowledge.mts        ← lettura e cache dei contenuti di beyondstrategy.it
  lib/prompt.mts           ← istruzioni del Growth Advisor
  lib/brevo.mts            ← integrazione Brevo
netlify.toml
```

# Beyond Growth Assessment

## Deploy su Vercel

### 1. Installa Vercel CLI (una volta sola)
```
npm install -g vercel
```

### 2. Deploy
```
cd beyond-assessment
vercel
```

### 3. Aggiungi le variabili d'ambiente su Vercel
Nel dashboard Vercel → Settings → Environment Variables:

| Nome | Valore |
|------|--------|
| `BREVO_API_KEY` | `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` |
| `BREVO_LIST_ID` | `3` |

### 4. Rideploy dopo aver aggiunto le variabili
```
vercel --prod
```

### 5. Dominio custom
Nel dashboard Vercel → Domains → aggiungi `assessment.beyondstrategy.it`
Poi nel DNS del tuo dominio aggiungi un record CNAME:
- Nome: `assessment`
- Valore: `cname.vercel-dns.com`

## Struttura progetto
```
beyond-assessment/
├── index.html        ← Assessment completo (frontend)
├── api/
│   └── subscribe.js  ← Proxy Brevo (serverless function)
├── vercel.json       ← Config routing
└── README.md
```

## Personalizzazioni prima del deploy
- `index.html` riga ~480: aggiorna `CALENDLY_URL` con il tuo link reale
- `index.html` riga ~481: aggiorna l'email di fallback con la tua email reale

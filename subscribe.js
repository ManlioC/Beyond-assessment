export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, name, company, role, score, level, sector } = req.body;

  if (!email || !name || !company) {
    return res.status(400).json({ error: 'Campi obbligatori mancanti' });
  }

  const firstName = name.split(' ')[0];
  const lastName  = name.split(' ').slice(1).join(' ') || '';

  try {
    const brevoRes = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'api-key': process.env.BREVO_API_KEY
      },
      body: JSON.stringify({
        email,
        attributes: {
          FIRSTNAME: firstName,
          LASTNAME: lastName,
          COMPANY: company,
          JOBTITLE: role || '',
          GROWTH_SCORE: score,
          GROWTH_LEVEL: level,
          SECTOR: sector
        },
        listIds: [parseInt(process.env.BREVO_LIST_ID)],
        updateEnabled: true
      })
    });

    if (brevoRes.ok || brevoRes.status === 204) {
      return res.status(200).json({ ok: true });
    }

    const err = await brevoRes.json().catch(() => ({}));

    if (err.code === 'duplicate_parameter') {
      return res.status(200).json({ ok: true });
    }

    console.error('Brevo error:', err);
    return res.status(500).json({ error: err.message || 'Errore Brevo' });

  } catch (e) {
    console.error('Fetch error:', e);
    return res.status(500).json({ error: 'Errore di connessione a Brevo' });
  }
}

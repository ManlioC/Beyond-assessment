const https = require('https');

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

  const payload = JSON.stringify({
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
    listIds: [parseInt(process.env.BREVO_LIST_ID || '3')],
    updateEnabled: true
  });

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.brevo.com',
      path: '/v3/contacts',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'api-key': process.env.BREVO_API_KEY
      }
    };

    const request = https.request(options, (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        if (response.statusCode === 201 || response.statusCode === 204) {
          res.status(200).json({ ok: true });
        } else {
          try {
            const err = JSON.parse(data);
            if (err.code === 'duplicate_parameter') {
              res.status(200).json({ ok: true });
            } else {
              res.status(500).json({ error: err.message || 'Errore Brevo' });
            }
          } catch(e) {
            res.status(200).json({ ok: true });
          }
        }
        resolve();
      });
    });

    request.on('error', (e) => {
      res.status(500).json({ error: e.message });
      resolve();
    });

    request.write(payload);
    request.end();
  });
}

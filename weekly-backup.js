const crypto = require('crypto');

const DEFAULT_SUPABASE_URL = 'https://jaxjbcsnqqyevplxnbfg.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpheGpiY3NucXF5ZXZwbHhuYmZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5ODEyNzQsImV4cCI6MjA5OTU1NzI3NH0.War18qu9u7YcCAOg4Ygb_Ha6jquza-UDRfrz_Q493gs';

function sendJson(res, status, payload) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function argentinaTimestamp() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date()).replace(' ', 'T').replaceAll(':', '-');
}

async function fetchTable(url, key, table) {
  const response = await fetch(`${url}/rest/v1/${encodeURIComponent(table)}?select=*`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      Prefer: 'count=exact',
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${table}: ${response.status} ${text.slice(0, 300)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${table}: respuesta JSON inválida`);
  }
}

module.exports = async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return sendJson(res, 405, { ok: false, error: 'Método no permitido' });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authorization = req.headers.authorization || '';
    if (authorization !== `Bearer ${cronSecret}`) {
      return sendJson(res, 401, { ok: false, error: 'No autorizado' });
    }
  }

  const supabaseUrl = (process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, '');
  const supabaseKey = process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.BACKUP_FROM_EMAIL || 'Don Zoilo Backup <onboarding@resend.dev>';
  const toEmail = process.env.BACKUP_TO_EMAIL || 'donzoilo91@gmail.com';

  if (!resendKey) {
    return sendJson(res, 500, { ok: false, error: 'Falta configurar RESEND_API_KEY en Vercel' });
  }

  try {
    const tableNames = ['movements', 'orders', 'product_prices', 'signed_receipts'];
    const results = await Promise.allSettled(tableNames.map((table) => fetchTable(supabaseUrl, supabaseKey, table)));

    const data = {};
    const warnings = [];
    results.forEach((result, index) => {
      const table = tableNames[index];
      if (result.status === 'fulfilled') data[table] = result.value;
      else {
        data[table] = [];
        warnings.push(result.reason?.message || `${table}: error desconocido`);
      }
    });

    if (!Array.isArray(data.movements) || !Array.isArray(data.orders)) {
      throw new Error('Las tablas principales no devolvieron datos válidos');
    }
    if (data.movements.length === 0 && data.orders.length === 0) {
      throw new Error('Protección activada: movements y orders llegaron vacíos; no se envió el respaldo');
    }

    const generatedAt = new Date().toISOString();
    const backup = {
      app: 'Don Zoilo',
      version: '32.0',
      generated_at: generatedAt,
      timezone: 'America/Argentina/Buenos_Aires',
      counts: Object.fromEntries(tableNames.map((t) => [t, data[t].length])),
      warnings,
      data,
    };

    const json = JSON.stringify(backup, null, 2);
    const sha256 = crypto.createHash('sha256').update(json).digest('hex');
    backup.sha256 = sha256;
    const finalJson = JSON.stringify(backup, null, 2);
    const filename = `don-zoilo-backup-${argentinaTimestamp()}.json`;

    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [toEmail],
        subject: `✅ Respaldo semanal Don Zoilo — ${new Date().toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}`,
        html: `
          <h2>Respaldo semanal Don Zoilo realizado</h2>
          <p>El archivo JSON se encuentra adjunto.</p>
          <ul>
            <li>Movimientos: <strong>${data.movements.length}</strong></li>
            <li>Pedidos: <strong>${data.orders.length}</strong></li>
            <li>Precios: <strong>${data.product_prices.length}</strong></li>
            <li>Remitos firmados: <strong>${data.signed_receipts.length}</strong></li>
          </ul>
          <p>Verificación SHA-256: <code>${sha256}</code></p>
          ${warnings.length ? `<p><strong>Advertencias:</strong> ${warnings.join(' | ')}</p>` : ''}
        `,
        attachments: [{
          filename,
          content: Buffer.from(finalJson, 'utf8').toString('base64'),
        }],
      }),
    });

    const emailText = await emailResponse.text();
    if (!emailResponse.ok) {
      throw new Error(`Resend: ${emailResponse.status} ${emailText.slice(0, 500)}`);
    }

    let emailResult = {};
    try { emailResult = JSON.parse(emailText); } catch { emailResult = { response: emailText }; }

    return sendJson(res, 200, {
      ok: true,
      message: 'Respaldo generado y enviado',
      filename,
      counts: backup.counts,
      sha256,
      warnings,
      email_id: emailResult.id || null,
    });
  } catch (error) {
    console.error('weekly-backup error:', error);
    return sendJson(res, 500, { ok: false, error: error.message || 'Error desconocido' });
  }
};

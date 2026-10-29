// Runs every day at 9:00 AM IST (03:30 UTC) via Vercel Cron (see vercel.json).
// Emails Sherni the clients whose phase changes soon / just changed, and programmes ending within 7 days.
// Also reads from Supabase daily, which keeps the free project from auto-pausing.
const DURATIONS = { '3 months': 90, '4 months': 120, '6 months': 180, '12 months': 365, '1 hour': 1 };
const DAY = 86400000;
const fmt = d => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

function startOfDay(d) { const x = new Date(d); x.setUTCHours(0, 0, 0, 0); return x; }
function isTrial(c) { return c.phase === 'Trial' || c.duration === '1 hour'; }
function phaseStart(c) { return new Date(startOfDay(c.join_date).getTime() + Number(c.pause_days || 0) * DAY); }
function phaseInfo(c, now) {
  const len = (Number(c.phase_weeks) || 4) * 7;
  const m = /Phase (\d)/.exec(c.phase_override || '');
  const manual = !!(m && c.phase_override_date);
  const n0 = manual ? Number(m[1]) : 1;
  const start = manual ? startOfDay(c.phase_override_date).getTime() : phaseStart(c).getTime();
  const elapsed = Math.max(0, Math.floor((now - start) / DAY));
  const n = Math.min(4, n0 + Math.floor(elapsed / len));
  return {
    n,
    next: n < 4 ? new Date(start + (n - n0 + 1) * len * DAY) : null,
    last: n > n0 ? new Date(start + (n - n0) * len * DAY) : null
  };
}
function endDate(c) {
  const days = (DURATIONS[c.duration] || 0) + Number(c.pause_days || 0) + Number(c.extension_days || 0) + Number(c.referral_days || 0);
  return new Date(startOfDay(c.join_date).getTime() + days * DAY);
}
function wa(c, msg) {
  if (!c.phone) return null;
  const digits = c.phone.replace(/\D/g, '');
  return `https://wa.me/${digits.length === 10 ? '91' + digits : digits}?text=${encodeURIComponent(msg)}`;
}

export default async function handler(req, res) {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, REMINDER_EMAIL } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'Supabase env vars missing' });

    const r = await fetch(`${SUPABASE_URL}/rest/v1/clients?select=*`, {
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }
    });
    if (!r.ok) return res.status(500).json({ error: 'Supabase read failed', details: await r.text() });
    const clients = await r.json();
    const now = new Date();

    const phaseRows = [], endingRows = [];
    for (const c of clients) {
      if (!c.join_date) continue;
      const end = endDate(c);
      const left = Math.ceil((end - now) / DAY);
      if (left < 0) continue; // expired
      const first = c.name.split(' ')[0];
      if (!isTrial(c)) {
        const p = phaseInfo(c, now);
        const inDays = p.next ? Math.ceil((p.next - now) / DAY) : null;
        const sinceLast = p.last ? Math.floor((now - p.last) / DAY) : null;
        if (inDays !== null && inDays <= 2) {
          const msg = `Hi ${first}! 👋 You move to Phase ${p.n + 1} on ${fmt(p.next)}. Let's get you set up for the next phase!`;
          phaseRows.push({ c, text: `${c.name}: Phase ${p.n} → Phase ${p.n + 1} on ${fmt(p.next)} (${inDays <= 0 ? 'today' : 'in ' + inDays + 'd'})`, link: wa(c, msg) });
        } else if (sinceLast !== null && sinceLast <= 1) {
          const msg = `Hi ${first}! 👋 You've moved to Phase ${p.n} of your programme. Let's go!`;
          phaseRows.push({ c, text: `${c.name}: now in Phase ${p.n} (changed ${fmt(p.last)})`, link: wa(c, msg) });
        }
      }
      if (left <= 7) {
        endingRows.push({ c, text: `${c.name}: programme ends ${fmt(end)} (${left}d left)`, link: wa(c, `Hi ${first}! 👋 Your programme ends on ${fmt(end)}. Let's connect about your next steps!`) });
      }
    }

    const row = x => `<li>${x.text}${x.link ? ` — <a href="${x.link}">WhatsApp</a>` : ' — (no phone)'}</li>`;
    const nothing = !phaseRows.length && !endingRows.length;
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px">
      <h2>Strong With Sherni — daily reminders</h2>
      ${phaseRows.length ? `<h3>🔄 Phase changes (${phaseRows.length})</h3><ul>${phaseRows.map(row).join('')}</ul>` : ''}
      ${endingRows.length ? `<h3>🔴 Ending within 7 days (${endingRows.length})</h3><ul>${endingRows.map(row).join('')}</ul>` : ''}
      ${nothing ? '<p>All clear today 🎉</p>' : ''}
      <p><a href="https://strongwithsherni.com/admin.html">Open dashboard</a></p></div>`;

    // Only email when there is something to act on.
    if (nothing) return res.status(200).json({ sent: false, reason: 'nothing due', clients: clients.length });
    if (!RESEND_API_KEY || !REMINDER_EMAIL) return res.status(500).json({ error: 'RESEND_API_KEY / REMINDER_EMAIL not set' });

    const mail = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Strong With Sherni <onboarding@resend.dev>',
        to: [REMINDER_EMAIL],
        subject: `Reminders: ${phaseRows.length} phase change(s), ${endingRows.length} ending soon`,
        html
      })
    });
    if (!mail.ok) return res.status(500).json({ error: 'Email failed', details: await mail.text() });
    return res.status(200).json({ sent: true, phase: phaseRows.length, ending: endingRows.length });
  } catch (err) {
    return res.status(500).json({ error: 'Server error', details: err.message });
  }
}

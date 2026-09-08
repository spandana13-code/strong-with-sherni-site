import crypto from 'crypto';

// This runs on Vercel's server. It checks the payment is genuinely real (not faked),
// then automatically creates the client record in your Supabase 'clients' table.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, customer } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, error: 'Missing payment details' });
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    // Step 1: verify the payment signature is genuinely from Razorpay
    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, error: 'Payment verification failed — signature mismatch' });
    }

    // Step 2: payment is verified — now create the client record in Supabase
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const today = new Date().toISOString().slice(0, 10);

    // Map plan duration text (e.g. "3 Months") to whatever your admin dashboard duration field expects.
    // Adjust these values if your admin dashboard uses different labels.
    const durationMap = {
      '3 Months': '3 months',
      '4 Months': '4 months',
      '6 Months': '6 months',
      '12 Months': '12 months',
      '1 Hour': '1 hour'
    };
    const durationValue = durationMap[customer.duration] || customer.duration;

    const supabaseRes = await fetch(`${supabaseUrl}/rest/v1/clients`, {
      method: 'POST',
      headers: {
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        password: 'changeme123',
        join_date: today,
        payment_date: today,
        duration: durationValue,
        phase: customer.plan === '1-on-1 Trial Session' ? 'Trial' : 'Phase 1',
        pause_days: 0,
        extension_days: 0,
        referral_days: 0,
        payment_status: 'paid',
        intro_done: false,
        onboarding_done: false,
        notes: `${customer.location ? 'Location: ' + customer.location + '. ' : ''}${customer.plan === '1-on-1 Trial Session' ? '⭐ TRIAL SESSION — if they join a full program, remember to add +1 day via Extension. ' : ''}Auto-created via Razorpay signup. Plan: ${customer.plan}. Payment ID: ${razorpay_payment_id}`
      })
    });

    if (!supabaseRes.ok) {
      const errText = await supabaseRes.text();
      // Payment succeeded but client record failed — this is logged so you can manually add them
      return res.status(200).json({
        success: true,
        warning: 'Payment verified but client record creation failed — please add manually',
        details: errText
      });
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    return res.status(500).json({ success: false, error: 'Server error', details: err.message });
  }
}
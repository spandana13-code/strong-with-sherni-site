// This runs on Vercel's server, not in the browser — so your Razorpay Key Secret stays hidden.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { amount, planName } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      return res.status(500).json({ error: 'Razorpay keys not configured on the server' });
    }

    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');

    const razorpayRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: amount, // amount in paise, e.g. ₹19,000 = 1900000
        currency: 'INR',
        notes: { plan: planName || 'Strong With Sherni Program' }
      })
    });

    const order = await razorpayRes.json();

    if (!razorpayRes.ok) {
      return res.status(500).json({ error: 'Razorpay order creation failed', details: order });
    }

    return res.status(200).json(order);

  } catch (err) {
    return res.status(500).json({ error: 'Server error', details: err.message });
  }
}

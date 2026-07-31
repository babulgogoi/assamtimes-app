async function verifyHcaptcha(token, remoteIp) {
  if (!token) return false;

  const secret = process.env.HCAPTCHA_SECRET_KEY;
  if (!secret) {
    console.error('HCAPTCHA_SECRET_KEY is not configured — rejecting comment submission.');
    return false;
  }

  const params = new URLSearchParams();
  params.set('secret', secret);
  params.set('response', token);
  if (remoteIp) params.set('remoteip', remoteIp);

  const res = await fetch('https://api.hcaptcha.com/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const data = await res.json();
  return data.success === true;
}

module.exports = { verifyHcaptcha };

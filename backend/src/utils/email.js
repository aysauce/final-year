import nodemailer from 'nodemailer';

let transporter;
export function getTransporter() {
  if (transporter) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER) {
    // Dev fallback: log emails
    transporter = {
      sendMail: async (opts) => {
        console.log('\n[DEV EMAIL]\nTo:', opts.to, '\nSubject:', opts.subject, '\nText:', opts.text, '\n');
        return { accepted: [opts.to] };
      },
    };
    return transporter;
  }
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: String(SMTP_SECURE) === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transporter;
}

export async function sendOtpEmail(to, code, sessionId) {
  const from = process.env.EMAIL_FROM || 'no-reply@example.com';
  const subject = `Your Attendance OTP (Session ${sessionId})`;
  const text = `Use this OTP within the next few minutes: ${code}\nSession: ${sessionId}`;
  const tr = getTransporter();
  return tr.sendMail({ from, to, subject, text });
}


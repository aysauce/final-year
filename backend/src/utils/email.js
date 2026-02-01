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

export async function sendOtpEmail(to, code, { courseCode, minutes, surname, firstName }) {
  const from = process.env.EMAIL_FROM || 'no-reply@example.com';
  const safeCourse = courseCode || 'Course';
  const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? Math.ceil(minutes) : 5;
  const subject = `Your Attendance OTP - ${safeCourse}`;
  const nameParts = [surname, firstName].filter(Boolean).join(' ');
  const hello = nameParts ? `Hello, ${nameParts},` : 'Hello,';
  const text = `${hello}\n\nThis OTP is unique to you and lasts for less than ${safeMinutes} minutes, use it now:\n${code}`;
  const tr = getTransporter();
  return tr.sendMail({ from, to, subject, text });
}

export async function sendPasswordResetEmail(to, code, { minutes, surname, firstName }) {
  const from = process.env.EMAIL_FROM || 'no-reply@example.com';
  const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? Math.ceil(minutes) : 15;
  const subject = 'Password Reset Code';
  const nameParts = [surname, firstName].filter(Boolean).join(' ');
  const hello = nameParts ? `Hello, ${nameParts},` : 'Hello,';
  const text = `${hello}\n\nUse this code to reset your password. It expires in ${safeMinutes} minutes:\n${code}`;
  const tr = getTransporter();
  return tr.sendMail({ from, to, subject, text });
}

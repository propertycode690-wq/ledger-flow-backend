import { Resend } from 'resend';

/**
 * Validates and retrieves the configured Resend client instance.
 * Throws a clean configuration error if credentials are absent.
 */
export function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    const error = new Error('RESEND_API_KEY is not configured in environment variables.');
    error.code = 'MISSING_API_KEY';
    throw error;
  }
  return new Resend(apiKey.trim());
}

/**
 * Builds the responsive HTML body for the password reset email.
 */
function buildPasswordResetHtml({ recipientName, resetUrl }) {
  const displayName = recipientName ? recipientName.trim() : 'Valued Customer';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your B3 Invoices Password</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; }
    .email-wrapper { width: 100%; background-color: #f1f5f9; padding: 40px 10px; }
    .email-container { max-width: 580px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05); border: 1px solid #e2e8f0; }
    .email-header { background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 32px 32px 28px; text-align: left; }
    .brand-title { color: #ffffff; font-size: 24px; font-weight: 800; letter-spacing: -0.5px; margin: 0; line-height: 1.2; }
    .brand-accent { color: #3b82f6; }
    .brand-tagline { color: #94a3b8; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; margin-top: 4px; font-weight: 600; }
    .email-body { padding: 36px 32px; }
    .greeting { font-size: 18px; font-weight: 700; color: #0f172a; margin-top: 0; margin-bottom: 16px; }
    .text-content { font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 24px; }
    .cta-container { text-align: center; margin: 32px 0; }
    .reset-btn { display: inline-block; background-color: #2563eb; color: #ffffff !important; text-decoration: none; font-size: 14px; font-weight: 700; padding: 14px 32px; border-radius: 10px; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25); }
    .notice-box { background-color: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #3b82f6; border-radius: 8px; padding: 14px 18px; margin: 28px 0; }
    .notice-title { font-size: 12px; font-weight: 700; color: #0f172a; margin: 0 0 4px; }
    .notice-text { font-size: 12px; color: #64748b; margin: 0; line-height: 1.5; }
    .fallback-section { border-top: 1px solid #e2e8f0; padding-top: 20px; margin-top: 28px; }
    .fallback-text { font-size: 12px; color: #64748b; margin-bottom: 8px; }
    .fallback-url { font-size: 11px; color: #2563eb; word-break: break-all; text-decoration: none; }
    .email-footer { background-color: #f8fafc; padding: 24px 32px; text-align: center; border-top: 1px solid #e2e8f0; }
    .footer-text { font-size: 11px; color: #94a3b8; margin: 0 0 6px; }
    .footer-copy { font-size: 10px; color: #cbd5e1; margin: 0; }
  </style>
</head>
<body>
  <div class="email-wrapper">
    <div class="email-container">
      <div class="email-header">
        <h1 class="brand-title">B3<span class="brand-accent"> Invoices</span></h1>
        <div class="brand-tagline">Smart Invoicing &amp; Customer Portal</div>
      </div>
      <div class="email-body">
        <h2 class="greeting">Hello, ${displayName}</h2>
        <p class="text-content">
          We received a request to reset the password for your B3 Invoices customer account. Click the button below to choose a new secure password.
        </p>

        <div class="cta-container">
          <a href="${resetUrl}" target="_blank" rel="noopener noreferrer" class="reset-btn">Reset My Password</a>
        </div>

        <div class="notice-box">
          <div class="notice-title">Security Information:</div>
          <p class="notice-text">
            &bull; This single-use reset link is valid for <strong>60 minutes</strong>.<br>
            &bull; If you did not request this password reset, please disregard this email. Your existing password will remain safe and unchanged.
          </p>
        </div>

        <div class="fallback-section">
          <div class="fallback-text">If the button above does not work, copy and paste this link into your browser:</div>
          <a href="${resetUrl}" target="_blank" rel="noopener noreferrer" class="fallback-url">${resetUrl}</a>
        </div>
      </div>
      <div class="email-footer">
        <p class="footer-text">This is an automated security message from B3 Invoices (B3 Fruit &amp; Veg LTD).</p>
        <p class="footer-copy">&copy; 2026 B3 Fruit &amp; Veg LTD. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Builds the plain text fallback body for the password reset email.
 */
function buildPasswordResetText({ recipientName, resetUrl }) {
  const displayName = recipientName ? recipientName.trim() : 'Valued Customer';
  return `Hello ${displayName},

We received a request to reset your password for your B3 Invoices customer account.

To reset your password, please open the following secure link in your browser:
${resetUrl}

Please Note:
- This password reset link is valid for 60 minutes only and can only be used once.
- If you did not request a password reset, no further action is required. Your account remains secure.

Best regards,
B3 Invoices Security Team
B3 Fruit & Veg LTD
`;
}

/**
 * Dispatches a password reset email using the official Resend API.
 *
 * @param {Object} options
 * @param {string} options.to - Recipient email address
 * @param {string} [options.name] - Recipient full name
 * @param {string} options.resetToken - Raw high-entropy reset token
 * @returns {Promise<{ success: boolean, messageId?: string }>}
 */
export async function sendPasswordResetEmail({ to, name, resetToken }) {
  if (!to || typeof to !== 'string') {
    const error = new Error('Recipient email address is required.');
    error.code = 'INVALID_RECIPIENT';
    throw error;
  }

  if (!resetToken || typeof resetToken !== 'string') {
    const error = new Error('Reset token is required to build the reset link.');
    error.code = 'INVALID_TOKEN';
    throw error;
  }

  const resend = getResendClient();

  const baseUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
  const resetUrl = `${baseUrl}/login?resetToken=${resetToken}`;
  const fromAddress = process.env.MAIL_FROM || 'B3 Invoices <onboarding@resend.dev>';

  const html = buildPasswordResetHtml({ recipientName: name, resetUrl });
  const text = buildPasswordResetText({ recipientName: name, resetUrl });

  try {
    const response = await resend.emails.send({
      from: fromAddress,
      to: [to.trim()],
      subject: 'Reset Your B3 Invoices Password',
      html,
      text,
    });

    if (response.error) {
      const err = new Error(response.error.message || 'Resend provider rejected the email request.');
      err.code = 'RESEND_API_ERROR';
      err.providerDetails = response.error;
      throw err;
    }

    return {
      success: true,
      messageId: response.data?.id,
    };
  } catch (error) {
    // Log failure securely server-side without exposing token, reset URL, or API key
    console.error(`[EmailService] Failed to deliver password reset email to recipient: ${error.message}`);
    throw error;
  }
}


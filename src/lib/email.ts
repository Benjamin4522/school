import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

interface SendOtpEmailOptions {
  email: string;
  otp: string;
}

export async function sendOtpEmail({ email, otp }: SendOtpEmailOptions): Promise<{ success: boolean; error?: string }> {
  try {
    const { data, error } = await resend.emails.send({
      from: "Beulrock <noreply@salbjork.web.id>",
      to: [email],
      subject: "Beulrock Serverside - Verification Code",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; background-color: #0a0a0a; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0a0a; min-height: 100vh;">
            <tr>
              <td align="center" style="padding: 40px 20px;">
                <table width="480" cellpadding="0" cellspacing="0" style="max-width: 480px; width: 100%;">
                  <!-- Logo -->
                  <tr>
                    <td align="center" style="padding-bottom: 30px;">
                      <h1 style="color: #e74c3c; font-size: 28px; margin: 0; letter-spacing: 2px;">
                        BEULROCK
                      </h1>
                      <p style="color: #666; font-size: 12px; margin: 4px 0 0; letter-spacing: 4px;">SERVERSIDE</p>
                    </td>
                  </tr>

                  <!-- Card -->
                  <tr>
                    <td style="background-color: #111; border: 1px solid #222; border-radius: 16px; padding: 40px 32px;">
                      <!-- Header -->
                      <h2 style="color: #fff; font-size: 20px; margin: 0 0 8px;">Verification Code</h2>
                      <p style="color: #a0a0a0; font-size: 14px; margin: 0 0 28px;">
                        Use the code below to verify your email address. This code expires in <span style="color: #e74c3c; font-weight: 600;">5 minutes</span>.
                      </p>

                      <!-- OTP Code -->
                      <table width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td align="center" style="background-color: #1a1a1a; border: 1px solid #333; border-radius: 12px; padding: 20px;">
                            <span style="color: #e74c3c; font-size: 36px; font-weight: 700; letter-spacing: 12px; font-family: 'Courier New', monospace;">
                              ${otp}
                            </span>
                          </td>
                        </tr>
                      </table>

                      <!-- Security Notice -->
                      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 28px;">
                        <tr>
                          <td style="background-color: #1a1a0a; border: 1px solid #332200; border-radius: 8px; padding: 12px 16px;">
                            <p style="color: #f39c12; font-size: 12px; margin: 0;">
                              <strong>Security Notice:</strong> If you did not request this code, please ignore this email. Never share your verification code with anyone.
                            </p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td align="center" style="padding-top: 24px;">
                      <p style="color: #555; font-size: 11px; margin: 0;">
                        This email was sent by Beulrock Serverside.<br>
                        &copy; ${new Date().getFullYear()} Beulrock. All rights reserved.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
    });

    if (error) {
      console.error("[Email] Resend API error:", error);
      return { success: false, error: error.message };
    }

    console.log(`[Email] OTP sent to ${email}, message ID: ${data?.id}`);
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Email] Failed to send OTP:", message);
    return { success: false, error: message };
  }
}

// Generic email sender for other use cases
export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await resend.emails.send({
      from: "Beulrock <noreply@salbjork.web.id>",
      to: [to],
      subject,
      html,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: message };
  }
}

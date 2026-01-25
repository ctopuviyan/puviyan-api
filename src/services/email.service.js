const nodemailer = require('nodemailer');
const { ApiError } = require('../middleware/error.middleware');
const { HTTP_STATUS, ERROR_CODES } = require('../config/constants');

/**
 * Create email transporter
 * For now using Gmail SMTP, but can be configured for other providers
 */
function createTransporter() {
  const emailConfig = {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER || 'cto@puviyan.com',
      pass: process.env.SMTP_PASSWORD,
    },
  };

  if (!emailConfig.auth.pass) {
    console.warn('⚠️ SMTP_PASSWORD not configured. Email sending will fail.');
  }

  return nodemailer.createTransport(emailConfig);
}

/**
 * Send signup link email
 * @param {boolean} isDirectInvite - true for direct admin invites, false for approved signup requests
 */
async function sendSignupLinkEmail({ to, name, signupUrl, orgName, isDirectInvite = true }) {
  try {
    const transporter = createTransporter();

    const mailOptions = {
      from: `"Puviyan Team" <${process.env.SMTP_USER || 'cto@puviyan.com'}>`,
      to,
      subject: 'Welcome to Puviyan - Complete Your Signup',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background-color: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; font-weight: 600; }
            .footer { text-align: center; margin-top: 30px; color: #6b7280; font-size: 14px; }
            .info-box { background-color: #d1fae5; border-left: 4px solid #10b981; padding: 15px; border-radius: 6px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div style="text-align: center; margin-bottom: 20px;">
                <img src="https://puviyan-partner-portal-stage-omzkebgc5q-uc.a.run.app/puviyan-logo.svg" alt="Puviyan" style="height: 50px; width: auto;" />
              </div>
              <h1>Welcome to Puviyan!</h1>
            </div>
            <div class="content">
              <p>Hi ${name},</p>
              
              <p>${isDirectInvite ? `You've been invited to join <strong>${orgName}</strong> on the Puviyan Partner Portal.` : `Great news! Your signup request has been approved. You've been invited to join <strong>${orgName}</strong> on the Puviyan Partner Portal.`}</p>
              
              <div class="info-box">
                <p><strong>What's next?</strong></p>
                <p>Click the button below to complete your account setup. This link is unique to you and can only be used once.</p>
              </div>
              
              <div style="text-align: center;">
                <a href="${signupUrl}" class="button">Complete Your Signup</a>
              </div>
              
              <p style="margin-top: 30px; font-size: 14px; color: #6b7280;">
                Or copy and paste this link into your browser:<br>
                <a href="${signupUrl}" style="color: #10b981; word-break: break-all;">${signupUrl}</a>
              </p>
              
              <p style="margin-top: 30px;">
                If you didn't request access to Puviyan, please ignore this email.
              </p>
              
              <p>
                Best regards,<br>
                <strong>The Puviyan Team</strong>
              </p>
            </div>
            <div class="footer">
              <p>This is an automated message. Please do not reply to this email.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
Hi ${name},

${isDirectInvite ? `You've been invited to join ${orgName} on the Puviyan Partner Portal.` : `Great news! Your signup request has been approved. You've been invited to join ${orgName} on the Puviyan Partner Portal.`}

Complete your signup by clicking this link:
${signupUrl}

This link is unique to you and can only be used once.

If you didn't request access to Puviyan, please ignore this email.

Best regards,
The Puviyan Team
      `.trim(),
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Signup email sent:', info.messageId);
    
    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (error) {
    console.error('❌ Failed to send signup email:', error);
    // Don't throw error - we don't want email failure to block the signup approval
    // The admin can still manually send the link
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Send rejection notification email
 */
async function sendRejectionEmail({ to, name, reason }) {
  try {
    const transporter = createTransporter();

    const mailOptions = {
      from: `"Puviyan Team" <${process.env.SMTP_USER || 'cto@puviyan.com'}>`,
      to,
      subject: 'Update on Your Puviyan Signup Request',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #dc2626; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background-color: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
            .footer { text-align: center; margin-top: 30px; color: #6b7280; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Signup Request Update</h1>
            </div>
            <div class="content">
              <p>Hi ${name},</p>
              
              <p>Thank you for your interest in Puviyan. Unfortunately, we're unable to approve your signup request at this time.</p>
              
              ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
              
              <p>If you believe this is an error or have questions, please contact our support team.</p>
              
              <p>
                Best regards,<br>
                <strong>The Puviyan Team</strong>
              </p>
            </div>
            <div class="footer">
              <p>This is an automated message. Please do not reply to this email.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
Hi ${name},

Thank you for your interest in Puviyan. Unfortunately, we're unable to approve your signup request at this time.

${reason ? `Reason: ${reason}` : ''}

If you believe this is an error or have questions, please contact our support team.

Best regards,
The Puviyan Team
      `.trim(),
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Rejection email sent:', info.messageId);
    
    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (error) {
    console.error('❌ Failed to send rejection email:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Send reward approval request email
 */
async function sendRewardApprovalEmail({ 
  to, 
  userName, 
  rewardTitle, 
  pointsReserved,
  redemptionId,
  orgName 
}) {
  try {
    const transporter = createTransporter();

    const mailOptions = {
      from: `"Puviyan Team" <${process.env.SMTP_USER || 'cto@puviyan.com'}>`,
      to,
      subject: `Reward Approval Request: ${rewardTitle}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { 
              font-family: 'Segoe UI Variable', Arial, sans-serif; 
              line-height: 1.6; 
              color: #FFFFFF; 
              background-color: #0A0A0A;
              margin: 0;
              padding: 0;
            }
            .container { 
              max-width: 849px; 
              margin: 40px auto; 
              background-color: #1A1A1A; 
              border-radius: 24px; 
              padding: 32px 24px;
            }
            .header { 
              display: flex;
              align-items: center;
              gap: 16px;
              padding-bottom: 24px;
              border-bottom: 1px solid rgba(5, 5, 5, 0.5);
            }
            .logo {
              width: 43px;
              height: 40px;
              background: linear-gradient(180deg, #FABB15 0%, #48C84F 50%, #63DEF3 100%);
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 24px;
            }
            .header-title {
              font-weight: 600;
              font-size: 32px;
              line-height: 40px;
              color: #E0F8FD;
            }
            .content { 
              padding: 24px 0;
            }
            .section {
              margin-bottom: 24px;
            }
            .section-title {
              font-weight: 600;
              font-size: 16px;
              line-height: 20px;
              margin-bottom: 16px;
            }
            .section-subtitle {
              font-weight: 400;
              font-size: 18px;
              line-height: 20px;
              margin-bottom: 16px;
            }
            .section-text {
              font-weight: 400;
              font-size: 16px;
              line-height: 24px;
              margin-bottom: 16px;
            }
            .info-item {
              font-weight: 400;
              font-size: 16px;
              line-height: 20px;
              margin: 8px 0;
            }
            .footer { 
              text-align: center; 
              padding-top: 32px;
              border-top: 1px solid rgba(5, 5, 5, 0.5);
            }
            .social-links {
              display: flex;
              justify-content: center;
              gap: 24px;
              margin-bottom: 10px;
            }
            .social-icon {
              width: 24px;
              height: 24px;
              color: #FFFFFF;
            }
            .footer-links {
              color: #CCCCCC;
              font-size: 14px;
              line-height: 22px;
              margin: 10px 0;
            }
            .footer-links a {
              color: #CCCCCC;
              text-decoration: none;
            }
            .footer-text {
              color: #CCCCCC;
              font-size: 14px;
              line-height: 22px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="logo">🌱</div>
              <div class="header-title">I am Puviyan</div>
            </div>
            
            <div class="content">
              <div class="section">
                <div class="section-title">Hi ${orgName || 'Team'},</div>
                <div class="section-subtitle">Reward Approval Request</div>
                <div class="section-text">
                  ${userName} has requested approval for the following reward:
                </div>
              </div>

              <div class="section">
                <div class="info-item"><strong>Reward:</strong> ${rewardTitle}</div>
                <div class="info-item"><strong>Points Reserved:</strong> ${pointsReserved} points</div>
                <div class="info-item"><strong>Redemption ID:</strong> ${redemptionId}</div>
              </div>

              <div class="section">
                <div class="section-text">
                  Please review this request and take appropriate action. The user's points have been reserved and will be released if the request is denied.
                </div>
                <div class="section-text">
                  If you have questions about this request, please contact the user or your HR representative.
                </div>
              </div>

              <div class="section">
                <div class="section-text">
                  Thanks for participating!<br>
                  I am Puviyan Team
                </div>
              </div>
            </div>

            <div class="footer">
              <div class="social-links">
                <span class="social-icon">𝕏</span>
                <span class="social-icon">f</span>
                <span class="social-icon">📷</span>
                <span class="social-icon">in</span>
              </div>
              <div class="footer-links">
                <a href="https://puviyan.com/terms">Terms of Service</a> | 
                <a href="https://puviyan.com/privacy">Privacy Policy</a>
              </div>
              <div class="footer-text">
                All rights reserved © 2025 Puviyan Digital Solutions Private Limited
              </div>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
Hi ${orgName || 'Team'},

Reward Approval Request

${userName} has requested approval for the following reward:

Reward: ${rewardTitle}
Points Reserved: ${pointsReserved} points
Redemption ID: ${redemptionId}

Please review this request and take appropriate action. The user's points have been reserved and will be released if the request is denied.

If you have questions about this request, please contact the user or your HR representative.

Thanks for participating!
I am Puviyan Team

---
Terms of Service | Privacy Policy
All rights reserved © 2025 Puviyan Digital Solutions Private Limited
      `.trim(),
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Reward approval email sent:', info.messageId);
    
    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (error) {
    console.error('❌ Failed to send reward approval email:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

module.exports = {
  sendSignupLinkEmail,
  sendRejectionEmail,
  sendRewardApprovalEmail,
};

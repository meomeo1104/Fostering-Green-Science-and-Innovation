const nodemailer = require('nodemailer');
const { smtp } = require('../config');
const { renderTemplate } = require('../utils/renderTemplate'); // import the template helper
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const transporter = nodemailer.createTransport({
  host: smtp.host,
  port: smtp.port,
  secure: false, // upgrade with STARTTLS if needed
  auth: {
    user: smtp.user,
    pass: smtp.pass,
  },
});

/**
 * Sends the ticket email.
 * @param {string} to      Recipient email address
 * @param {object} info    Template data and attachments
 *   - name: string           // User's name
 *   - code: string           // Ticket code
 *   - qrBuffer: Buffer       // QR code image buffer
 */
async function sendTicketEmail(to, info) {
  const googlePngBuffer = await sharp(
    path.join(__dirname, '../assets/google-wallet.svg')
  )
    .resize({ width: 240 })
    .png()
    .toBuffer();
  
  const applePngBuffer = await sharp(
    path.join(__dirname, '../assets/apple-wallet.svg')
  )
    .resize({ width: 240 })
    .png()
    .toBuffer();
  

  const attachments = [
    {
      filename: 'qrcode.png',
      content: info.qrBuffer,
      cid: 'qr',
      contentDisposition: 'inline'
    },
    {
      filename: 'google-wallet.png',
      content: googlePngBuffer,
      cid: 'googleBtn',
      contentDisposition: 'inline',
      contentType: 'image/png'
    },
    {
      filename: 'apple-wallet.png',
      content: applePngBuffer,
      cid: 'appleBtn',
      contentDisposition: 'inline',
      contentType: 'image/png'
    }
  ];

  const html = renderTemplate('ticket', {
    name: info.name,
    code: info.code,
    googleWalletUrl: info.googleWalletUrl,
    appleWalletUrl: info.appleWalletUrl
  });

  await transporter.sendMail({
    from: `"VGU - Industrial Relations and Technology Transfer Center" <${process.env.SMTP_USER}>`,
    to,
    subject: 'Fostering Green Science and Innovation',
    html,
    attachments,
  });
}

module.exports = { sendTicketEmail };

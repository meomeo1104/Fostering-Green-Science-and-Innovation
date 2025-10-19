// src/routes/ticket.js
const express = require('express');
const { body, validationResult } = require('express-validator');
const { sendTicketEmail } = require('../services/mailService');
const { createPassObject } = require('../services/googleWalletService');
const { createUniqueCode } = require('../utils/generateCode');
const QRCode = require('qrcode');
const admin = require('firebase-admin');
const { googleWallet } = require('../config');

admin.initializeApp();
const db = admin.firestore();
const issuerId = googleWallet.issuerId;

const router = express.Router();

function requireApiKey(req, res, next) {
  const apiKey = req.header('x-api-key');
  if (!apiKey || apiKey !== process.env.EMAIL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Apply the requireApiKey middleware to the email route
router.post(
  '/email',
  requireApiKey,
  [
    body('email').isEmail(),
    body('name').notEmpty(),
    body('code').optional().isAlphanumeric().isLength({ min: 6, max: 6 }),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { email, name, code: suppliedCode } = req.body;

      const existing = await db
        .collection('tickets')
        .where('email', '==', email)
        .limit(1)
        .get();

      let lookupCode;
      if (!existing.empty) {
        if (suppliedCode) {
          lookupCode = suppliedCode;
        } else {
          lookupCode = existing.docs[0].id;
        }
      } else {
        lookupCode = suppliedCode || await createUniqueCode(db);
      }

      const suffix = email.replace(/[^\w.-]/g, '_');
      const objectId = `${issuerId}.${suffix}`;
      const serial = suffix;

      await db.collection('tickets').doc(lookupCode).set({
        email,
        name,
        code: lookupCode,
        objectId,
        serial,
        boothVisited: 0,
      });

      // 4) generate the QR code
      const qrBuffer = await QRCode.toBuffer(lookupCode, {
        width: 500,
        scale: 10,
        color: { dark: '#000000', light: '#FFFFFF' }
      });

      // 5) (re-)create the Google Wallet pass
      const googleWalletUrl = await createPassObject(email, name, lookupCode);

      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.get('host');
      const baseUrl = `${protocol}://${host}`;

      const appleWalletUrl = `${baseUrl}/api/appleWallet/pass`
        + `?email=${encodeURIComponent(email)}`
        + `&name=${encodeURIComponent(name)}`
        + `&code=${encodeURIComponent(lookupCode)}`;

      await sendTicketEmail(email, {
        name,
        code: lookupCode,
        qrBuffer,
        googleWalletUrl,
        appleWalletUrl,
      });

      res.json({ success: true, message: 'Email sent!', code: lookupCode });
    } catch (err) {
      console.error('Failed to send ticket email:', err);
      next(err);
    }
  }
);

module.exports = router;

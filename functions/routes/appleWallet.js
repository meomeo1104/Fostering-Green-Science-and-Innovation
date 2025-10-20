const express = require('express');
const { createPassForUser } = require('../services/appleWalletService');
const admin = require('firebase-admin');

// admin.initializeApp();
const db = admin.firestore();
const router = express.Router();

router.get('/pass', async (req, res, next) => {
  try {
    const { email, name, code } = req.query;
    if (!email || !code || !name) {
      return res
        .status(400)
        .send('Missing parameters.');
    }
    const ticketSnap = await db.collection('tickets').doc(code).get();
    if (!ticketSnap.exists) {
      return res
        .status(404)
        .send('Ticket not found.');
    }
    const ticket = ticketSnap.data();

    if (ticket.email !== email || ticket.name !== name) {
      return res
        .status(403)
        .send('Provided email/name does not match our records.');
    }

    const passBuffer = await createPassForUser(email, name, code);

    res
      .status(200)
      .set({
        'Content-Type': 'application/vnd.apple.pkpass',
        'Content-Disposition': `attachment; filename="${code}.pkpass"`,
        'Cache-Control': 'no-store, no-cache'
      })
      .send(passBuffer);

  } catch (err) {
    console.error('❌ Error generating Apple pass:', err);
    next(err);
  }
});

module.exports = router;

const express = require('express');
const { body, validationResult } = require('express-validator');
const admin = require('firebase-admin');
const axios = require('axios');
const { createPassObject } = require('../services/googleWalletService');
const { appleWallet } = require('../config');
const { webServiceURL, passTypeIdentifier, authToken } = appleWallet;

if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();
const router = express.Router();

// Middleware to require API key
function requireApiKey(req, res, next) {
    const apiKey = req.header('x-api-key');
    if (!apiKey || apiKey !== process.env.EMAIL_API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

router.post(
    '/boothVisited',
    requireApiKey,
    [
        body('code')
            .isAlphanumeric().withMessage('code must be alphanumeric')
            .isLength({ min: 6, max: 6 }).withMessage('code must be 6 chars'),
        body('boothVisited')
            .isInt({ min: 0 }).withMessage('boothVisited must be a non-negative integer'),
    ],
    async (req, res, next) => {
        try {
            // 1) Validate request body
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }

            const { code, boothVisited } = req.body;

            // 2) Lookup ticket
            const ticketRef = db.collection('tickets').doc(code);
            const ticketSnap = await ticketRef.get();
            if (!ticketSnap.exists) {
                return res.status(404).json({ error: 'Ticket not found.' });
            }

            const { email, name, serial } = ticketSnap.data();

            // 3) Update ticket’s boothVisited
            await ticketRef.update({ boothVisited });

            // 4) Bump updatedAt on your “passes” doc so Wallet sees a change
            const { passTypeIdentifier, webServiceURL, authToken } = appleWallet;
            const passId = `${passTypeIdentifier}_${serial}`;
            await db
                .collection('passes')
                .doc(passId)
                .set(
                    { updatedAt: admin.firestore.FieldValue.serverTimestamp() },
                    { merge: true }
                );

            // 5) Update Google Wallet object (optional)
            await createPassObject(email, name, code, boothVisited);

            // 6) Notify Apple push service
            const pushUrl = `${webServiceURL}/v1/push/${passTypeIdentifier}`;
            const pushResponse = await axios.post(
                pushUrl,
                { serialNumbers: [serial] },
                {
                    headers: {
                        Authorization: `ApplePass ${authToken}`,
                        'Content-Type': 'application/json'
                    },
                    validateStatus: () => true
                }
            );

            console.log('⬅️ Push status:', pushResponse.status, pushResponse.data);

            if (pushResponse.status < 200 || pushResponse.status >= 300) {
                return res.status(502).json({
                    error: 'Failed to notify Apple push service',
                    status: pushResponse.status,
                    body: pushResponse.data
                });
            }

            // 7) Success
            return res.json({ success: true, boothVisited });

        } catch (err) {
            console.error('❌ /api/boothVisited error:', err);
            next(err);
        }
    }
);

module.exports = router;

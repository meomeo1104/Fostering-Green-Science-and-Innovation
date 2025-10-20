const express = require('express');
const admin = require('firebase-admin');
const path = require('path');
const { appleWallet } = require('../config');
const {
    initTemplate,
    createPassForUser
} = require('../services/appleWalletService');

const router = express.Router();
const db = admin.firestore();
const apn = require('@parse/node-apn');

const apnProvider = new apn.Provider({
    token: {
        key: path.resolve(__dirname, appleWallet.apnKeyPath),
        keyId: appleWallet.apnKeyId,
        teamId: appleWallet.teamIdentifier,
    },
    production: true
});

initTemplate().catch(err => {
    console.error('❌ Failed to initialize Apple pass template:', err);
    process.exit(1);
});

/**
 * Middleware per Apple’s spec:
 *   Authorization: ApplePass {authenticationToken}
 */
function requireAppleToken(req, res, next) {
    const auth = req.header('Authorization') || '';
    if (!auth.startsWith('ApplePass ')) {
        // Apple expects a WWW-Authenticate header on 401
        return res
            .status(401)
            .set('WWW-Authenticate', 'ApplePass')
            .send('Unauthorized');
    }
    const token = auth.slice('ApplePass '.length);
    if (token !== appleWallet.authToken) {
        return res
            .status(401)
            .set('WWW-Authenticate', 'ApplePass')
            .send('Unauthorized');
    }
    next();
}

/**
 * GET /v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier
 * Query-string: ?passesUpdatedSince=<UNIX-seconds>
 *
 * Responds with a JSON:
 * {
 *   serialNumbers: [ "…", "…" ],
 *   lastUpdated: 1351981923
 * }
 */
router.get(
    '/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier',
    // requireAppleToken, --> no need it here!
    async (req, res, next) => {
        try {
            const { deviceLibraryIdentifier, passTypeIdentifier } = req.params;
            const sinceParam = req.query.passesUpdatedSince;
            const sinceMs = sinceParam ? Number(sinceParam) * 1000 : 0;

            // 1) pull your registrations
            const regsSnap = await db
                .collection('registrations')
                .where('deviceLibraryIdentifier', '==', deviceLibraryIdentifier)
                .where('passTypeIdentifier', '==', passTypeIdentifier)
                .get();

            // If nothing registered, no matching passes → 204
            if (regsSnap.empty) {
                return res.status(204).send();
            }

            // 2) scan for passes updated since that tag
            let maxUpdatedMs = sinceMs;
            const serials = [];

            for (const doc of regsSnap.docs) {
                const { passTypeIdentifier: ptid, serialNumber } = doc.data();
                const passId = `${ptid}_${serialNumber}`;
                const passSnap = await db.collection('passes').doc(passId).get();
                if (!passSnap.exists) continue;

                const ts = passSnap.data().updatedAt?.toMillis?.();
                if (ts > sinceMs) {
                    serials.push(serialNumber);
                    maxUpdatedMs = Math.max(maxUpdatedMs, ts);
                }
            }

            // 3a) if any changed → 200 + JSON
            if (serials.length) {
                return res.status(200).json({
                    serialNumbers: serials,
                    lastUpdated: String(Math.floor(maxUpdatedMs / 1000))
                });
            }

            // 3b) otherwise → 204 no body
            return res.status(204).send();

        } catch (err) {
            next(err);
        }
    }
);



/**
 * GET /v1/passes/:passTypeIdentifier/:serialNumber
 * — Called by Apple devices to fetch or refresh a .pkpass
 */
router.get(
    '/v1/passes/:passTypeIdentifier/:serialNumber',
    requireAppleToken,
    async (req, res, next) => {
        try {
            const { passTypeIdentifier, serialNumber } = req.params;

            // 1) Find your pass in Firestore by its serialNumber
            const ticketQuery = await db
                .collection('tickets')
                .where('serial', '==', serialNumber)
                .limit(1)
                .get();

            if (ticketQuery.empty) {
                return res.status(404).send('Pass not found');
            }

            const ticket = ticketQuery.docs[0].data();
            // ticket.code      → barcode value
            // ticket.email     → derive serialNumber in template
            // ticket.name      → display name
            // ticket.boothVisited

            // 2) Regenerate the .pkpass
            const passBuffer = await createPassForUser(
                ticket.email,
                ticket.name,
                ticket.code,
                ticket.boothVisited
            );

            // 3) Send it back with the correct headers
            res.set({
                'Content-Type': 'application/vnd.apple.pkpass',
                'Content-Disposition': `attachment; filename="${serialNumber}.pkpass"`,
                'Cache-Control': 'no-cache, no-store'
            });
            return res.send(passBuffer);

        } catch (err) {
            next(err);
        }
    }
);

/**
 * POST /v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber
 *
 */
// --- Register a pass for updates ---
router.post(
    '/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber',
    requireAppleToken,
    async (req, res, next) => {
        try {
            const {
                deviceLibraryIdentifier,
                passTypeIdentifier,
                serialNumber
            } = req.params;
            const { pushToken } = req.body;

            if (!pushToken) {
                return res.status(400).send('Missing pushToken');
            }

            // 1) Ensure the pass exists in your Passes table
            const passId = `${passTypeIdentifier}_${serialNumber}`;
            await db
                .collection('passes')
                .doc(passId)
                .set(
                    {
                        passTypeIdentifier,
                        serialNumber,
                        // Optionally track a lastUpdated timestamp here.
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    },
                    { merge: true }
                );

            // 2) Upsert the device
            await db
                .collection('devices')
                .doc(deviceLibraryIdentifier)
                .set(
                    {
                        pushToken,
                        seenAt: admin.firestore.FieldValue.serverTimestamp()
                    },
                    { merge: true }
                );

            // 3) Create the registration mapping
            const regId = `${deviceLibraryIdentifier}_${passId}`;
            const regRef = db.collection('registrations').doc(regId);
            const regSnap = await regRef.get();

            if (regSnap.exists) {
                return res.status(200).send();
            }

            await regRef.set({
                deviceLibraryIdentifier,
                passId,
                passTypeIdentifier,
                serialNumber,
                registeredAt: admin.firestore.FieldValue.serverTimestamp()
            });

            return res.status(201).send();
        } catch (err) {
            next(err);
        }
    }
);

// --- Unregister a pass ---
router.delete(
    '/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber',
    requireAppleToken,
    async (req, res, next) => {
        try {
            const {
                deviceLibraryIdentifier,
                passTypeIdentifier,
                serialNumber
            } = req.params;

            const passId = `${passTypeIdentifier}_${serialNumber}`;
            const regId = `${deviceLibraryIdentifier}_${passId}`;
            await db.collection('registrations').doc(regId).delete();

            const remaining = await db
                .collection('registrations')
                .where('deviceLibraryIdentifier', '==', deviceLibraryIdentifier)
                .limit(1)
                .get();
            if (remaining.empty) {
                await db.collection('devices').doc(deviceLibraryIdentifier).delete();
            }

            const stillUsed = await db
                .collection('registrations')
                .where('passId', '==', passId)
                .limit(1)
                .get();
            if (stillUsed.empty) {
                await db.collection('passes').doc(passId).delete();
            }

            return res.status(200).send();
        } catch (err) {
            next(err);
        }
    }
);

/**
 * POST /v1/push/:passTypeIdentifier
 * 
 * Header:
 *   Authorization: ApplePass <authenticationToken>
 * 
 * Body:
 *   { serialNumbers: [ "<serial1>", "<serial2>", … ] }
 *
 * Response:
 *   { success: true, pushed: <number of tokens sent> }
 */
router.post(
    '/v1/push/:passTypeIdentifier',
    requireAppleToken,
    async (req, res, next) => {
        try {
            const { passTypeIdentifier } = req.params;
            const { serialNumbers } = req.body;

            // 0) Validate input
            if (
                !Array.isArray(serialNumbers) ||
                serialNumbers.length === 0
            ) {
                return res
                    .status(400)
                    .send('`serialNumbers` must be a non-empty array');
            }

            const deviceSet = new Set();
            for (let i = 0; i < serialNumbers.length; i += 10) {
                const chunk = serialNumbers.slice(i, i + 10);
                const regsSnap = await db
                    .collection('registrations')
                    .where('passTypeIdentifier', '==', passTypeIdentifier)
                    .where('serialNumber', 'in', chunk)
                    .get();

                regsSnap.forEach(doc => {
                    deviceSet.add(doc.data().deviceLibraryIdentifier);
                });
            }

            if (deviceSet.size === 0) {
                return res.json({ success: true, pushed: 0 });
            }

            // 2) Lookup each device’s stored pushToken
            const tokens = [];
            for (const deviceId of deviceSet) {
                const devSnap = await db
                    .collection('devices')
                    .doc(deviceId)
                    .get();
                if (!devSnap.exists) continue;

                const pushToken = devSnap.data().pushToken;
                if (typeof pushToken === 'string' && pushToken.length > 0) {
                    tokens.push(pushToken);
                }
            }

            if (tokens.length === 0) {
                return res.json({ success: true, pushed: 0 });
            }

            // 3) Build & send the silent APN notification
            const note = new apn.Notification({
                topic: appleWallet.passTypeIdentifier,
                pushType: 'background',
                contentAvailable: true,
                payload: {}
            });

            const result = await apnProvider.send(note, tokens);
            console.log('APNs result:', JSON.stringify(result));

            for (const failure of result.failed) {
                const badToken = failure.device;
                const status = failure.status;
                const reason = failure.response?.reason;

                if (
                    [400, 410].includes(status) ||
                    ['BadDeviceToken', 'Unregistered'].includes(reason)
                ) {
                    // Find the offending device record
                    const badDevSnap = await db
                        .collection('devices')
                        .where('pushToken', '==', badToken)
                        .limit(1)
                        .get();

                    if (!badDevSnap.empty) {
                        const badId = badDevSnap.docs[0].id;
                        // Delete the device
                        await db.collection('devices').doc(badId).delete();
                        // Delete all its registrations
                        const regsToDel = await db
                            .collection('registrations')
                            .where('deviceLibraryIdentifier', '==', badId)
                            .get();
                        regsToDel.forEach(d => d.ref.delete());
                    }
                }
            }

            return res.json({ success: true, pushed: result.sent.length });
        } catch (err) {
            next(err);
        }
    }
);


/**
 * POST /v1/push/:passTypeIdentifier/:serialNumber
 * 
 * Header:
 *   Authorization: ApplePass <authenticationToken>
 * 
 * Path params:
 *   passTypeIdentifier – your passType ID
 *   serialNumber       – the single serial to update
 *
 * Response:
 *   { success: true, pushed: <number of tokens sent> }
 */
router.post(
    '/v1/push/:passTypeIdentifier/:serialNumber',
    requireAppleToken,
    async (req, res, next) => {
        try {
            const { passTypeIdentifier, serialNumber } = req.params;

            // 1) Find all registrations for that one serial
            const regsSnap = await db
                .collection('registrations')
                .where('passTypeIdentifier', '==', passTypeIdentifier)
                .where('serialNumber', '==', serialNumber)
                .get();

            if (regsSnap.empty) {
                // No devices have registered that pass
                return res.json({ success: true, pushed: 0 });
            }

            // 2) Collect unique deviceLibraryIdentifiers
            const deviceIds = new Set(
                regsSnap.docs.map(d => d.data().deviceLibraryIdentifier)
            );

            // 3) Lookup each device’s pushToken
            const tokens = [];
            for (const deviceId of deviceIds) {
                const devSnap = await db.collection('devices').doc(deviceId).get();
                if (!devSnap.exists) continue;
                const pushToken = devSnap.data().pushToken;
                if (typeof pushToken === 'string' && pushToken) {
                    tokens.push(pushToken);
                }
            }

            if (tokens.length === 0) {
                return res.json({ success: true, pushed: 0 });
            }

            // 4) Build & send the silent APN notification
            const note = new apn.Notification({
                topic: appleWallet.passTypeIdentifier,
                pushType: 'background',
                contentAvailable: true,
                payload: {}
            });
            const result = await apnProvider.send(note, tokens);
            console.log('Selective APNs result:', JSON.stringify(result));

            // 5) Cleanup any invalid tokens (same as before)
            for (const failure of result.failed) {
                const badToken = failure.device;
                const status = failure.status;
                const reason = failure.response?.reason;

                if (
                    [400, 410].includes(status) ||
                    ['BadDeviceToken', 'Unregistered'].includes(reason)
                ) {
                    const badDevSnap = await db
                        .collection('devices')
                        .where('pushToken', '==', badToken)
                        .limit(1)
                        .get();

                    if (!badDevSnap.empty) {
                        const badId = badDevSnap.docs[0].id;
                        await db.collection('devices').doc(badId).delete();
                        const regsToDel = await db
                            .collection('registrations')
                            .where('deviceLibraryIdentifier', '==', badId)
                            .get();
                        regsToDel.forEach(d => d.ref.delete());
                    }
                }
            }

            // 6) Return how many pushes succeeded
            return res.json({ success: true, pushed: result.sent.length });
        } catch (err) {
            next(err);
        }
    }
);



module.exports = router;

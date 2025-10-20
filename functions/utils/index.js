const functions = require('firebase-functions');
const express = require('express');

const ticketRouter = require('./routes/ticket');
const appleWalletRouter = require('./routes/appleWallet');
const updateRouter = require('./routes/updateBoothVisited');
const appleWalletWebServiceRouter = require('./routes/appleWalletWebService');
const errorHandler = require('./middleware/errorHandler');
const { createPassClass } = require('./services/googleWalletService');
const { initTemplate } = require('./services/appleWalletService');

const app = express();
app.use(express.json());

// Routes
app.use('/api/tickets', ticketRouter);
app.use('/api/appleWallet', appleWalletRouter);
app.use('/api', updateRouter);
app.use('/', appleWalletWebServiceRouter);

// Health check
app.get('/__ping', (req, res) => res.status(200).send('pong'));

// Error handling middleware (must come after routes)
app.use(errorHandler);

// Cold start preparation — only runs once per container
const ready = Promise.all([
  createPassClass().then(() => {
    console.log('✅ Google Wallet class ready');
  }).catch(err => {
    console.error('❌ Google Wallet init error:', err);
  }),

  initTemplate().then(() => {
    console.log('✅ Apple Wallet template ready');
  }).catch(err => {
    console.error('❌ Apple Wallet init error:', err);
  }),
]);

// Function handler
exports.ticket = functions.https.onRequest(async (req, res) => {
  console.log('📬 Request:', req.method, req.url);
  await ready;
  return app(req, res);
});

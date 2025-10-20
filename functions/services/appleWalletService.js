const fs = require('fs');
const path = require('path');
const { PKPass } = require('passkit-generator');

const { appleWallet } = require('../config');
const { auth } = require('firebase-admin');
const {
  wwdrPath,
  signerCertPath,
  signerKeyPath,
  signerKeyPassphrase,
  teamIdentifier,
  passTypeIdentifier,
  templateFolder,
  webServiceURL,
  authToken
} = appleWallet;

const certificates = {
  wwdr: fs.readFileSync(path.resolve(__dirname, wwdrPath)),
  signerCert: fs.readFileSync(path.resolve(__dirname, signerCertPath)),
  signerKey: fs.readFileSync(path.resolve(__dirname, signerKeyPath)),
  signerKeyPassphrase
};

const baseProps = {
  teamIdentifier,
  passTypeIdentifier,
  organizationName: "VGU Career Services",
  description: "Entrance ticket for Career Fair and Industrial Exploration Day 2025",
  webServiceURL,
  authenticationToken: authToken,
};

let passTemplate = null;

/**
 * Load your .pass folder into a PKPass instance.
 * Call this once, at server startup.
 */
async function initTemplate() {
  const modelPath = path.resolve(__dirname, templateFolder);
  passTemplate = await PKPass.from(
    { model: modelPath, certificates },
    baseProps
  );
  console.log('✅ Apple Wallet template initialized.');
}

/**
 * Generate a user-specific .pkpass buffer.
 *
 * @param {string} email     – user’s email (to derive serialNumber)
 * @param {string} fullName  – to display on the pass
 * @param {string} code      – QR code / barcode value
 * @returns {Buffer}         – raw .pkpass data
 */
async function createPassForUser(email, fullName, code, booth_visited = 0) {
  if (!passTemplate) {
    throw new Error('Template not initialized! Call initTemplate() first.');
  }

  const serialNumber = email.replace(/[^\w.-]/g, '_');

  const pass = await PKPass.from(
    passTemplate,
    {
      serialNumber
    }
  );
  pass.setBarcodes(code);
  pass.secondaryFields.push(
    {
      "key": "name",
      "label": "Attendee",
      "value": fullName,
      "textAlignment": "PKTextAlignmentLeft"
    },
    {
      "key": "boothVisited",
      "label": "Booth Visited",
      "value": booth_visited,
      "textAlignment": "PKTextAlignmentRight"
    }
  );

  return pass.getAsBuffer();
}

module.exports = {
  initTemplate,
  createPassForUser
};

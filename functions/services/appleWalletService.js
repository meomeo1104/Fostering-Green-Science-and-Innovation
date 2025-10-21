const fs = require('fs');
const path = require('path');
const { PKPass } = require('passkit-generator');

const { appleWallet } = require('../config');

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
  organizationName: "Industrial Relations and Technology Transfer Center",
  description: "Entrance ticket for Fostering Green Science and Innovation 2025",
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
  console.log('✅ Apple Wallet template initialized for FGSI 2025.');
}

/**
 * Generate a user-specific .pkpass buffer.
 *
 * @param {string} fullName  – attendee’s full name
 * @param {string} studentId – attendee’s ID (also used for QR/barcode)
 * @returns {Buffer}         – raw .pkpass data
 */
async function createPassForUser(fullName, studentId) {
  if (!passTemplate) {
    throw new Error('Template not initialized! Call initTemplate() first.');
  }

  const serialNumber = studentId.replace(/[^\w.-]/g, '_');

  const pass = await PKPass.from(passTemplate, { serialNumber });

  // Set barcode (QR)
  pass.setBarcodes(studentId);

  // Add text fields
  pass.secondaryFields.push(
    {
      key: "full_name",
      label: "Name",
      value: fullName,
      textAlignment: "PKTextAlignmentLeft"
    },
    {
      key: "student_id",
      label: "ID",
      value: studentId,
      textAlignment: "PKTextAlignmentRight"
    }
  );

  return pass.getAsBuffer();
}

module.exports = {
  initTemplate,
  createPassForUser
};

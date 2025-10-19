require('dotenv').config();


const { auth } = require('firebase-admin');
const Joi = require('joi');


const schema = Joi.object({
  SMTP_HOST: Joi.string().required(),
  SMTP_PORT: Joi.number().required(),
  SMTP_USER: Joi.string().required(),
  SMTP_PASS: Joi.string().required(),
  GW_SERVICE_ACCOUNT: Joi.string().required(),
  GW_ISSUER_ID: Joi.string().required(),
  AW_WWDR_PATH: Joi.string().required(),
  AW_SIGNER_CERT_PATH: Joi.string().required(),
  AW_SIGNER_KEY_PATH: Joi.string().required(),
  AW_SIGNER_KEY_PASSPHRASE: Joi.string().required(),
  AW_TEAM_ID: Joi.string().length(10).required(),
  AW_PASS_TYPE_ID: Joi.string().required(),
  AW_TEMPLATE_FOLDER: Joi.string().required(),          // e.g. './templates/cfied.pass'
  AW_WEB_SERVICE_URL: Joi.string().uri().optional(),
  AW_APN_KEY_PATH: Joi.string().optional(),         // e.g. './AuthKey_XXXXXXXX.p8'
  AW_APN_KEY_ID: Joi.string().optional(),
  APPLE_AUTH_TOKEN: Joi.string().optional()      // e.g. 'XXXXXXXXXX' from Apple Dev
})
  .unknown()  // allow other ENV vars
  .required();


const { error, value: env } = schema.validate(process.env);
if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}


module.exports = {
  smtp: {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
  },
  googleWallet: {
    serviceAccount: env.GW_SERVICE_ACCOUNT,
    issuerId: env.GW_ISSUER_ID,
  },
  appleWallet: {
    wwdrPath: env.AW_WWDR_PATH,
    signerCertPath: env.AW_SIGNER_CERT_PATH,
    signerKeyPath: env.AW_SIGNER_KEY_PATH,
    signerKeyPassphrase: env.AW_SIGNER_KEY_PASSPHRASE,
    teamIdentifier: env.AW_TEAM_ID,
    passTypeIdentifier: env.AW_PASS_TYPE_ID,
    templateFolder: env.AW_TEMPLATE_FOLDER,
    webServiceURL: env.AW_WEB_SERVICE_URL,  // may be undefined
    apnKeyPath: env.AW_APN_KEY_PATH,
    apnKeyId: env.AW_APN_KEY_ID,
    authToken: env.APPLE_AUTH_TOKEN,
  },
};


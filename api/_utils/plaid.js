const { Configuration, PlaidApi, PlaidEnvironments, Products } = require("plaid");
const { plaidConfig } = require("./env");

let client;

function plaid() {
  if (client) return client;
  const config = plaidConfig();
  const basePath = PlaidEnvironments[config.environment] || PlaidEnvironments.production;
  client = new PlaidApi(new Configuration({
    basePath,
    baseOptions: { headers: { "PLAID-CLIENT-ID": config.clientId, "PLAID-SECRET": config.secret } },
  }));
  return client;
}

function plaidOptions() {
  return plaidConfig();
}

module.exports = { plaid, plaidOptions, Products };

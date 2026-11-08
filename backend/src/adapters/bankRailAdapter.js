const crypto = require('crypto');
const axios = require('axios');

class BankRailAdapter {
  constructor(config) {
    this.config = config;
  }

  generateRequestSignature(payload) {
    return crypto
      .createHmac('sha256', this.config.secret)
      .update(JSON.stringify(payload))
      .digest('hex');
  }

  async sendTransfer({ from, to, amount, reference }) {
    if (typeof reference !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(reference)) throw new Error('INVALID_TRANSFER_REFERENCE');
    const payload = {
      from,
      to,
      amount,
      reference,
      timestamp: Date.now()
    };

    const signature = this.generateRequestSignature(payload);

    const response = await axios.post(
      this.config.endpoint,
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': reference,
          'x-api-key': this.config.apiKey,
          'x-signature': signature
        },
        timeout: 15000,
        maxRedirects: 0
      }
    );

    return {
  ok: true,
  rail: this.config.name,
  status: "TRANSFER_SENT",
  reference:
    response.data.reference ||
    response.data.transaction_reference ||
    response.data.id ||
    null,
    response: response.data
    };
  }
}

module.exports = BankRailAdapter;

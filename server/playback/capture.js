'use strict';
const { KB_API } = require('../constants');

function createCaptureTip({ getSecret, getStreamerId, logger, testHook }) {
  if (typeof testHook === 'function') {
    return testHook;
  }

  return async function captureTip(t) {
    const secret = getSecret();
    const streamerId = getStreamerId();
    try {
      const r = await fetch(`${KB_API}/api/capture_tip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({
          stripe_pi_id: t.stripe_pi_id,
          secret_id: secret,
          streamer_id: streamerId,
          is_replay: !!t.is_replay,
          is_test: !!t.is_test
        })
      });
      if (r.status >= 500 || r.status === 429) {
        logger.warn('capture_tip: HTTP ' + r.status + ' from KickBot', { id: t.stripe_pi_id, name: t.tipper_name });
        return 'retry';
      }
      const j = await r.json();
      logger.info('capture_tip', { success: j.success, payment_success: j.payment_success });
      return j.payment_success === true ? 'ok' : 'failed';
    } catch (e) {
      logger.warn('capture_tip failed', e.name === 'TimeoutError' ? 'timeout' : e.message);
      return 'retry';
    }
  };
}

module.exports = {
  createCaptureTip
};

'use strict';

const net = require('node:net');

// Windows can reserve broad port ranges for Hyper-V or VPN software. Let the OS
// select a usable loopback port for each HTTP integration fixture.
async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

module.exports = { freePort };

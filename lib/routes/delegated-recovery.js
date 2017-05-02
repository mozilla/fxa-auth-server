/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict';

const error = require('../error')
const P = require('../promise')
const fs = require('fs');

module.exports = function (log, config) {

  const kps = fs.readFileSync(config.get('delegated_recovery.public_key_path'), 'utf-8');
  let tokensignPubkeysSecp256r1 = [];

  for (let i = 0; i < kps.length; i++) {
    tokensignPubkeysSecp256r1.push(kps[i]);
  }

  var routes = [
    {
      method: 'GET',
      path: '/.well-known/delegated-account-recovery/configuration',
      handler: function (request, reply) {
        log.begin('well-known.delegated-account-recovery.configuration', request)

        let maxAge = config.get('delegated_recovery.max_page') === null ? 3600 // one hour
          : config.get('delegated_recovery.max_page');
        res.set('Cache-Control', `public, max-age=${maxAge}`);
        res.set('Access-Control-Allow-Origin', '*');
        res.json({
          'issuer': 'https://' + config.get('delegated_recovery.issue_origin'),
          'tokensign-pubkeys-secp256r1': tokensignPubkeysSecp256r1,
          'recover-account-return': `https://${request.headers.host + config.get('delegated_recovery.recover_account_return')}`,
          'save-token-return': `https://${request.headers.host + config.get('delegated_recovery.save_token_return')}`,
          'privacy-policy': `https://${request.headers.host + config.get('delegated_recovery.privacy_policy')}`,
          'icon-152px': `https://${request.headers.host + config.get('delegated_recovery.icon_152x')}`,
        });

      }
    }
  ]

  return routes
}

// module.exports = function (config) {
//   const fs = require('fs');
//   const route = {};
//   route.method = 'get';
//   route.path = '/.well-known/delegated-account-recovery/configuration';
//
//   let kps = fs.readFileSync(config.get('delegated_recovery.public_key_path'), 'utf-8');
//   let tokensignPubkeysSecp256r1 = [];
//
//   for (let i = 0; i < kps.length; i++) {
//     tokensignPubkeysSecp256r1.push(kps[i]);
//   }
//
//   route.process = function (req, res) {
//
//     let maxAge = config.get('delegated_recovery.max_page') === null ? 3600 // one hour
//       : config.get('delegated_recovery.max_page');
//     res.set('Cache-Control', `public, max-age=${maxAge}`);
//     res.set('Access-Control-Allow-Origin', '*');
//     res.json({
//       'issuer': 'https://' + config.get('delegated_recovery.issue_origin'),
//       'tokensign-pubkeys-secp256r1': tokensignPubkeysSecp256r1,
//       'recover-account-return': `https://${req.headers.host + config.get('delegated_recovery.recover_account_return')}`,
//       'save-token-return': `https://${req.headers.host + config.get('delegated_recovery.save_token_return')}`,
//       'privacy-policy': `https://${req.headers.host + config.get('delegated_recovery.privacy_policy')}`,
//       'icon-152px': `https://${req.headers.host + config.get('delegated_recovery.icon_152x')}`,
//     });
//   };
//
//   return route;
// };

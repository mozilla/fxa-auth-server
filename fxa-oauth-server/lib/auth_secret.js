/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const config = require('./config');
const AppError = require('./error');
const logger = require('./logging')('server.auth');

exports.AUTH_SCHEME = 'sharedSecret';

exports.strategy = function(server, options) {
  const {secretName} = options;
  return {
    async authenticate(req, h) {
      const auth = req.headers.authorization;
      logger.debug('check.auth', { header: auth });
      if (! auth || auth.indexOf('FxA-Shared-Secret ') !== 0) {
        throw AppError.unauthorized('Shared secret not provided');
      }
      const secret = auth.split(' ')[1];
      if (secret !== config.get(`sharedSecrets.${secretName}`)) {
        throw AppError.unauthorized('Incorrect secret');
      }
      logger.info('success');
      return h.authenticated({credentials: {}});
    }
  };
};

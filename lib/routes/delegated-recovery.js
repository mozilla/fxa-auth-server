/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict';

const error = require('../error')
const P = require('../promise')
const fs = require('fs');
const fbDelegatedRecoveryUtils = require('./utils/delegated_recovery')
const RecoveryToken = fbDelegatedRecoveryUtils.RecoveryToken
const crypto = require('crypto')

module.exports = function (log, config) {

  const recoveryConfig = config['delegated_recovery']
  const keyPath = recoveryConfig['public_key_path']
  const privateKeyPath = recoveryConfig['private_key_path']
  const maxAge = recoveryConfig['max_age']
  const issueOrigin = 'https://' + recoveryConfig['issue_origin']
  const recoverAccountReturn = recoveryConfig['recover_account_return']
  const saveTokenReturn = recoveryConfig['save_token_return']
  const privacyPolicy = recoveryConfig['privacy_policy']
  const icon = recoveryConfig['icon_152x']

  const FB_DELEGATED_RECOVERY = 'https://www.facebook.com'
  const cachedRecoveryProvider = fbDelegatedRecoveryUtils.fetchConfiguration(FB_DELEGATED_RECOVERY)

  const privateKey = fs.readFileSync(privateKeyPath, 'utf-8')

  const kps = fs.readFileSync(keyPath, 'utf-8')
  let tokensignPubkeysSecp256r1 = []

  for (let i = 0; i < kps.length; i++) {
    tokensignPubkeysSecp256r1.push(kps[i])
  }

  const tokenRecords = []

  const routes = [
    {
      method: 'GET',
      path: '/.well-known/delegated-account-recovery/configuration',
      handler: function (request, reply) {
        log.begin('well-known.delegated-account-recovery.configuration', request)

        // const response = request.response
        // if (response.header) {
        //   response.header('Cache-Control', `public, max-age=${maxAge}`)
        //   response.header('Access-Control-Allow-Origin', '*')
        // }

        reply({
          'issuer': issueOrigin,
          'tokensign-pubkeys-secp256r1': tokensignPubkeysSecp256r1,
          'recover-account-return': issueOrigin + recoverAccountReturn,
          'save-token-return': issueOrigin + saveTokenReturn,
          'privacy-policy': issueOrigin + privacyPolicy,
          'icon-152px': issueOrigin + icon
        })
      }
    },
    {
      method: 'GET',
      path: '/delegated-recovery/generate-token',
      // config: {
      //   auth: {
      //     strategy: 'sessionToken'
      //   }
      // },
      handler: function (request, reply) {
        log.begin('delegated-recovery.generate-token', request)

        const sessionToken = request.auth.credentials
        // const uid = sessionToken.uid
        const uid = '1'

        return cachedRecoveryProvider
          .then((providerConfig) => {
            const id = crypto.randomBytes(16);
            const token = new RecoveryToken(
              privateKey,
              id,
              RecoveryToken.STATUS_REQUESTED_FLAG,
              issueOrigin,
              providerConfig.issuer,
              new Date().toISOString(),
              new Buffer(0),
              new Buffer(0)
            )

            tokenRecords.push({
              status: 'provisional',
              username: uid,
              id: id.toString('hex'),
              issuer: config.issuer,
              hash: fbDelegatedRecoveryUtils.sha256(new Buffer(token.encoded, 'base64'))
            });

            return reply({
              'encoded-token': token.encoded,
              'username': uid,
              'state': id.toString('hex'),
              'save-token': providerConfig['save-token']
            })
          }, reply)
      }
    },
    {
      method: 'GET',
      path: '/delegated-recovery/recovery_save_token',
      handler: function (request, reply) {
        log.begin('delegated-recovery.generate-token', request)

        const id = request.query.state;
        // find and update our pending token record to confirmed status
        const tokenRecord = tokenRecords.find((record) => record.id === id);
        if (tokenRecord === undefined) {
          reply({
            message: 'failed to find token ' + id
          })
        } else if (request.query.status === 'save-success') {
          tokenRecord.status = 'confirmed'
          reply({message: 'Token saved!'})
        } else {
          // remove from list of pending tokens if failed to save
          tokenRecords.splice(tokenRecords.findIndex((record) => record.id === id), 1);
          reply({message: 'failed to save token ' + id})
        }
      }
    }
  ]

  return routes
}
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const errors = require('../error')
const validators = require('./validators')

module.exports = (log, db, Password, verifierVersion, customs) => {
  return [
    {
      method: 'POST',
      path: '/recoveryKeys',
      config: {
        auth: {
          strategy: 'sessionToken'
        },
        validate: {
          payload: {
            recoveryKeyId: validators.recoveryKeyId,
            recoveryData: validators.recoveryData
          }
        }
      },
      handler(request, reply) {
        log.begin('createRecoveryKey', request)

        const uid = request.auth.credentials.uid
        const sessionToken = request.auth.credentials
        const {recoveryKeyId, recoveryData} = request.payload

        createRecoveryKey()
          .then(emitMetrics)
          .then(() => reply({}), reply)

        function createRecoveryKey() {
          if (sessionToken.tokenVerificationId) {
            throw errors.unverifiedSession()
          }

          return db.createRecoveryKey(uid, recoveryKeyId, recoveryData)
        }

        function emitMetrics() {
          log.info({
            op: 'account.recoveryKey.created',
            uid
          })

          return request.emitMetricsEvent('recoveryKey.created', {uid})
        }
      }
    },
    {
      method: 'GET',
      path: '/recoveryKeys/{recoveryKeyId}',
      config: {
        auth: {
          strategy: 'accountResetToken'
        },
        validate: {
          params: {
            recoveryKeyId: validators.recoveryKeyId
          }
        }
      },
      handler(request, reply) {
        log.begin('getRecoveryKey', request)

        const uid = request.auth.credentials.uid
        const ip = request.app.clientAddress
        const recoveryKeyId = request.params.recoveryKeyId
        let recoveryData

        customs.checkAuthenticated('getRecoveryKey', ip, uid)
          .then(getRecoveryKey)
          .then(() => reply({recoveryData}), reply)

        function getRecoveryKey() {
          return db.getRecoveryKey(uid, recoveryKeyId)
            .then((res) => recoveryData = res.recoveryData)
        }
      }
    }
  ]
}

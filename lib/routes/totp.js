/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const errors = require('../error')
const isA = require('joi')
const P = require('../promise')
const otplib = require('otplib')
const qrcode = require('qrcode')

module.exports = (log, db, customs, config) => {

  // TODO: Pull into own file
  otplib.authenticator.options = {
    encoding: 'hex',
    step: config.step
  }

  P.promisify(qrcode.toDataURL)

  return [
    {
      method: 'POST',
      path: '/totp/create',
      config: {
        auth: {
          strategy: 'sessionToken'
        },
        response: {
          schema: isA.object({
            qrCodeUrl: isA.string().required()
          })
        }
      },
      handler(request, reply) {
        log.begin('totp.create', request)

        const sessionToken = request.auth.credentials
        const uid = sessionToken.uid

        // TODO: Use correct rate limiting
        customs.check(request, 'totpCreate')
          .then(createTotpToken)
          .then(createResponse, reply)

        let secret = config.sharedSecret
        if (! config.sharedSecret) {
          // Generate a new shared secret for this user if nothing
          // was set in config
          secret = otplib.authenticator.generateSecret()
        }

        function createTotpToken() {
          if (sessionToken.tokenVerificationId) {
            throw errors.unverifiedSession()
          }

          return db.createTotpToken(uid, secret, 0)
        }

        function createResponse() {
          const otpauth = otplib.authenticator.keyuri(sessionToken.email, config.serviceName, secret)
          const qrCodeOtps = {
            errorCorrectionLevel: 'H',
            rendererOpts: {
              quality: 1.0
            }
          }
          return qrcode.toDataURL(otpauth, qrCodeOtps)
            .then((qrCodeUrl) => {
              reply({qrCodeUrl})
            })
        }
      }
    },
    {
      method: 'POST',
      path: '/totp/destroy',
      config: {
        auth: {
          strategy: 'sessionToken'
        },
        response: {}
      },
      handler(request, reply) {
        log.begin('totp.destroy', request)

        const sessionToken = request.auth.credentials
        const uid = sessionToken.uid

        // TODO: Use correct rate limiting
        customs.check(request, 'totpDestroy')
          .then(deleteTotpToken)
          .then(() => reply({}), reply)


        function deleteTotpToken() {
          if (sessionToken.tokenVerificationId) {
            throw errors.unverifiedSession()
          }

          return db.deleteTotpToken(uid)
        }
      }
    },
    {
      method: 'POST',
      path: '/session/verify/totp',
      config: {
        auth: {
          strategy: 'sessionToken'
        },
        validate: {
          payload: {
            code: isA.string().max(32).required()
          }
        },
        response: {}
      },
      handler(request, reply) {
        log.begin('session.verify.totp', request)

        const code = request.payload.code
        const sessionToken = request.auth.credentials
        let sharedSecret, isValid

        // TODO: Use correct rate limiting
        customs.check(request, 'totpCheck')
          .then(getTotpToken)
          .then(checkTotpCode)
          .then(verifySession)
          .then(() => reply({success: isValid}), reply)

        function getTotpToken() {
          return db.getTotpToken(sessionToken.uid)
            .then((token) => {
              sharedSecret = token.sharedSecret
            })
        }

        function checkTotpCode() {
          if (sessionToken.tokenVerificationId) {
            throw errors.unverifiedSession()
          }

          isValid = otplib.authenticator.check(code, sharedSecret)
        }

        function verifySession() {
          // TODO Do verify session stuff
        }
      }
    }
  ]
}


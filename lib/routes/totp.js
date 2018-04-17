/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const errors = require('../error')
const validators = require('./validators')
const isA = require('joi')
const P = require('../promise')
const otplib = require('otplib')
const qrcode = require('qrcode')
const METRICS_CONTEXT_SCHEMA = require('../metrics/context').schema

module.exports = (log, db, mailer, customs, config) => {

  // Default options for TOTP
  otplib.authenticator.options = {
    encoding: 'hex',
    step: config.step,
    window: config.window
  }

  // Currently, QR codes are rendered with the highest possible
  // error correction, which should in theory allow clients to
  // scan the image better.
  // Ref: https://github.com/soldair/node-qrcode#error-correction-level
  const qrCodeOptions = {errorCorrectionLevel: 'H'}

  const RECOVERY_CODE_COUNT = config.recoveryCodes && config.recoveryCodes.codeCount || 8

  P.promisify(qrcode.toDataURL)

  return [
    {
      method: 'POST',
      path: '/totp/create',
      config: {
        auth: {
          strategy: 'sessionToken'
        },
        validate: {
          payload: {
            metricsContext: METRICS_CONTEXT_SCHEMA
          }
        },
        response: {
          schema: isA.object({
            qrCodeUrl: isA.string().required(),
            secret: isA.string().required()
          })
        }
      },
      handler(request, reply) {
        log.begin('totp.create', request)

        let response
        const sessionToken = request.auth.credentials
        const uid = sessionToken.uid

        customs.check(request, sessionToken.email, 'totpCreate')
          .then(createTotpToken)
          .then(emitMetrics)
          .then(createResponse)
          .then(() => reply(response), reply)

        const authenticator = new otplib.authenticator.Authenticator()
        authenticator.options = otplib.authenticator.options
        const secret = authenticator.generateSecret()

        function createTotpToken() {
          if (sessionToken.tokenVerificationId) {
            throw errors.unverifiedSession()
          }

          return db.createTotpToken(uid, secret, 0)
        }

        function createResponse() {
          const otpauth = authenticator.keyuri(sessionToken.email, config.serviceName, secret)

          return qrcode.toDataURL(otpauth, qrCodeOptions)
            .then((qrCodeUrl) => {
              response = {
                qrCodeUrl,
                secret
              }
            })
        }

        function emitMetrics() {
          log.info({
            op: 'totpToken.created',
            uid: uid
          })
          return request.emitMetricsEvent('totpToken.created', {uid: uid})
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
        let hasEnabledToken = false

        customs.check(request, sessionToken.email, 'totpDestroy')
          .then(checkTotpToken)
          .then(deleteTotpToken)
          .then(sendEmailNotification)
          .then(() => reply({}), reply)

        function checkTotpToken() {
          // If a TOTP token is not verified, we should be able to safely delete regardless of session
          // verification state.
          return db.totpToken(uid)
            .then((result) => {
              if (result && result.verified && result.enabled) {
                hasEnabledToken = true
                return
              }
            }, (err) => {
              if (err.errno === errors.ERRNO.TOTP_TOKEN_NOT_FOUND) {
                return
              }
              throw err
            })
        }

        function deleteTotpToken() {
          if (hasEnabledToken && (sessionToken.tokenVerificationId || sessionToken.authenticatorAssuranceLevel <= 1)) {
            throw errors.unverifiedSession()
          }

          return db.deleteTotpToken(uid)
            .then(() => {
              return log.notifyAttachedServices('profileDataChanged', request, {
                uid: sessionToken.uid
              })
            })
        }

        function sendEmailNotification() {
          if (! hasEnabledToken) {
            return
          }

          return db.account(sessionToken.uid)
            .then((account) => {
              const geoData = request.app.geo
              const ip = request.app.clientAddress
              const emailOptions = {
                acceptLanguage: request.app.acceptLanguage,
                ip: ip,
                location: geoData.location,
                timeZone: geoData.timeZone,
                uaBrowser: request.app.ua.browser,
                uaBrowserVersion: request.app.ua.browserVersion,
                uaOS: request.app.ua.os,
                uaOSVersion: request.app.ua.osVersion,
                uaDeviceType: request.app.ua.deviceType,
                uid: sessionToken.uid
              }

              mailer.sendPostRemoveTwoStepAuthNotification(account.emails, account, emailOptions)
            })
        }
      }
    },
    {
      method: 'GET',
      path: '/totp/exists',
      config: {
        auth: {
          strategy: 'sessionToken'
        },
        response: {
          schema: isA.object({
            exists: isA.boolean()
          })
        }
      },
      handler(request, reply) {
        log.begin('totp.exists', request)

        const sessionToken = request.auth.credentials
        let exists = false

        return getTotpToken()
          .then(() => reply({exists}), reply)

        function getTotpToken() {
          return P.resolve()
            .then(() => {
              if (sessionToken.tokenVerificationId) {
                throw errors.unverifiedSession()
              }

              return db.totpToken(sessionToken.uid)
            })

            .then((token) => {
              // If the token is not verified, lets delete it and report that
              // it doesn't exist. This will help prevent some edge
              // cases where the user started creating a token but never completed.
              if (! token.verified) {
                return db.deleteTotpToken(sessionToken.uid)
                  .then(() => {
                    exists = false
                  })
              } else {
                exists = true
              }
            }, (err) => {
              if (err.errno === errors.ERRNO.TOTP_TOKEN_NOT_FOUND) {
                exists = false
                return
              }
              throw err
            })
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
            code: isA.string().max(32).regex(validators.DIGITS).required(),
            metricsContext: METRICS_CONTEXT_SCHEMA,
            service: validators.service
          }
        },
        response: {
          schema: {
            success: isA.boolean().required(),
            recoveryCodes: isA.array().items(isA.string()).optional()
          }
        }
      },
      handler(request, reply) {
        log.begin('session.verify.totp', request)

        const code = request.payload.code
        const sessionToken = request.auth.credentials
        const uid = sessionToken.uid
        const email = sessionToken.email
        let sharedSecret, isValidCode, tokenVerified, recoveryCodes

        customs.check(request, email, 'verifyTotpCode')
          .then(getTotpToken)
          .then(verifyTotpCode)
          .then(verifyTotpToken)
          .then(replaceRecoveryCodes)
          .then(verifySession)
          .then(emitMetrics)
          .then(sendEmailNotification)
          .then(() => {
            const response = {
              success: isValidCode
            }

            if (recoveryCodes) {
              response.recoveryCodes = recoveryCodes
            }

            return reply(response)
          }, reply)

        function getTotpToken() {
          return db.totpToken(sessionToken.uid)
            .then((token) => {
              sharedSecret = token.sharedSecret
              tokenVerified = token.verified
            })
        }

        function verifyTotpCode() {
          const authenticator = new otplib.authenticator.Authenticator()
          authenticator.options = Object.assign({}, otplib.authenticator.options, {secret: sharedSecret})
          isValidCode = authenticator.check(code, sharedSecret)
        }

        // Once a valid TOTP code has been detected, the token becomes verified
        // and enabled for the user.
        function verifyTotpToken() {
          if (isValidCode && ! tokenVerified) {
            return db.updateTotpToken(sessionToken.uid, {
              verified: true,
              enabled: true
            }).then(() => {
              return log.notifyAttachedServices('profileDataChanged', request, {
                uid: sessionToken.uid
              })
            })
          }
        }

        // If this is a new registration, replace and generate recovery codes
        function replaceRecoveryCodes() {
          if (isValidCode && ! tokenVerified) {
            return db.replaceRecoveryCodes(uid, RECOVERY_CODE_COUNT)
              .then((result) => recoveryCodes = result)
          }
        }

        // If a valid code was sent, this verifies the session using the `totp-2fa` method.
        function verifySession() {
          if (isValidCode && sessionToken.authenticatorAssuranceLevel <= 1) {
            return db.verifyTokensWithMethod(sessionToken.id, 'totp-2fa')
          }
        }

        function emitMetrics() {
          if (isValidCode) {
            log.info({
              op: 'totp.verified',
              uid: uid
            })
            request.emitMetricsEvent('totpToken.verified', {uid: uid})
          } else {
            log.info({
              op: 'totp.unverified',
              uid: uid
            })
            request.emitMetricsEvent('totpToken.unverified', {uid: uid})
          }
        }

        function sendEmailNotification() {
          return db.account(sessionToken.uid)
            .then((account) => {
              const geoData = request.app.geo
              const ip = request.app.clientAddress
              const service = request.payload.service || request.query.service
              const emailOptions = {
                acceptLanguage: request.app.acceptLanguage,
                ip: ip,
                location: geoData.location,
                service: service,
                timeZone: geoData.timeZone,
                uaBrowser: request.app.ua.browser,
                uaBrowserVersion: request.app.ua.browserVersion,
                uaOS: request.app.ua.os,
                uaOSVersion: request.app.ua.osVersion,
                uaDeviceType: request.app.ua.deviceType,
                uid: sessionToken.uid
              }

              // Check to see if this token was just verified, if it is, then this means
              // the user has enabled two step authentication, otherwise send new device
              // login email.
              if (isValidCode && ! tokenVerified) {
                return mailer.sendPostAddTwoStepAuthNotification(account.emails, account, emailOptions)
              }

              // All accounts that have a TOTP token, force the session to be verified, therefore
              // we can not check `session.mustVerify=true` to determine sending the new device
              // login email. Instead, lets perform a basic check that the service is `sync`, otherwise
              // don't send.
              if (service === 'sync') {
                return mailer.sendNewDeviceLoginNotification(account.emails, account, emailOptions)
              }
            })
        }
      }
    }
  ]
}


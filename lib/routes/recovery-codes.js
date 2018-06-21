/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const errors = require('../error')
const isA = require('joi')
const BASE_36 = require('./validators').BASE_36
const METRICS_CONTEXT_SCHEMA = require('../metrics/context').schema
const RECOVERY_CODE_SANE_MAX_LENGTH = 20

module.exports = (log, db, config, customs, mailer) => {
  const codeConfig = config.recoveryCodes
  const RECOVERY_CODE_COUNT = codeConfig && codeConfig.count || 8

  return [
    {
      method: 'GET',
      path: '/recoveryCodes',
      options: {
        auth: {
          strategy: 'sessionToken'
        },
        response: {
          schema: {
            recoveryCodes: isA.array().items(isA.string())
          }
        }
      },
      handler: async function (request, h) {
        log.begin('replaceRecoveryCodes', request)

        const uid = request.auth.credentials.uid
        const sessionToken = request.auth.credentials
        const geoData = request.app.geo
        const ip = request.app.clientAddress
        let codes

        await customs.check(request, 'replaceRecoveryCodes')
        await replaceRecoveryCodes()
        await sendEmailNotification()
        await emitMetrics()
        return {recoveryCodes: codes}

        function replaceRecoveryCodes() {
          if (sessionToken.tokenVerificationId) {
            throw errors.unverifiedSession()
          }

          return db.replaceRecoveryCodes(uid, RECOVERY_CODE_COUNT)
            .then((result) => {
              return codes = result
            })
        }

        function sendEmailNotification() {
          return db.account(sessionToken.uid)
            .then((account) => {
              return mailer.sendPostNewRecoveryCodesNotification(account.emails, account, {
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
              })
            })
        }

        function emitMetrics() {
          log.info({
            op: 'account.recoveryCode.replaced',
            uid: uid
          })

          return request.emitMetricsEvent('recoveryCode.replaced', {uid: uid})

        }
      }
    },
    {
      method: 'POST',
      path: '/session/verify/recoveryCode',
      options: {
        auth: {
          strategy: 'sessionToken'
        },
        validate: {
          payload: {
            code: isA.string().max(RECOVERY_CODE_SANE_MAX_LENGTH).regex(BASE_36).required(),
            metricsContext: METRICS_CONTEXT_SCHEMA
          }
        },
        response: {
          schema: {
            remaining: isA.number()
          }
        }
      },
      handler: async function (request, h) {
        log.begin('session.verify.recoveryCode', request)

        const code = request.payload.code
        const uid = request.auth.credentials.uid
        const sessionToken = request.auth.credentials
        const geoData = request.app.geo
        const ip = request.app.clientAddress


        await customs.check(request, 'verifyRecoveryCode')
        const remainingRecoveryCodes = await consumeRecoveryCode()
        await verifySession()
        await sendEmailNotification()
        await emitMetrics()
        return {remaining: remainingRecoveryCodes}

        async function consumeRecoveryCode() {
          const result = await db.consumeRecoveryCode(uid, code)
          if (result.remaining === 0) {
            log.info({
              op: 'account.recoveryCode.consumedAllCodes',
              uid
            })
          }
          return result.remaining
        }

        function verifySession() {
          if (sessionToken.tokenVerificationId) {
            return db.verifyTokensWithMethod(sessionToken.id, 'recovery-code')
          }
        }

        function sendEmailNotification() {
          return db.account(sessionToken.uid)
            .then((account) => {

               mailer.sendPostConsumeRecoveryCodeNotification(account.emails, account, {
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
              })
              .then(() => {
                if (remainingRecoveryCodes <= codeConfig.notifyLowCount) {
                  log.info({
                    op: 'account.recoveryCode.notifyLowCount',
                    uid,
                    remaining: remainingRecoveryCodes
                  })
                  return mailer.sendLowRecoveryCodeNotification(account.emails, account, {
                    acceptLanguage: request.app.acceptLanguage,
                    uid: sessionToken.uid
                  })
                }
                return
              })

          })
        }

        function emitMetrics() {
          log.info({
            op: 'account.recoveryCode.verified',
            uid: uid
          })

          return request.emitMetricsEvent('recoveryCode.verified', {uid: uid})

        }
      }
    }
  ]
}

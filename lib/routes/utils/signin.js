/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const isA = require('joi')
const validators = require('../validators')
const P = require('../../promise')
const butil = require('../../crypto/butil')
const error = require('../../error')
const requestHelper = require('./request_helper')

const BASE_36 = validators.BASE_36

// An arbitrary, but very generous, limit on the number of active sessions.
// Currently only for metrics purposes, not enforced.
const MAX_ACTIVE_SESSIONS = 200

module.exports = (log, config, customs, db, mailer)  => {

  const unblockCodeLifetime = config.signinUnblock && config.signinUnblock.codeLifetime || 0
  const unblockCodeLen = config.signinUnblock && config.signinUnblock.codeLength || 8

  return {

    validators: {
      UNBLOCK_CODE: isA.string().regex(BASE_36).length(unblockCodeLen).optional()
    },

    /**
     * Check if the password a user entered matches the one on
     * file for the account. If it does not, flag the account with
     * customs. Higher level code will take care of
     * returning an error to the user.
     */
    checkPassword(emailRecord, password, clientAddress) {
      if (butil.buffersAreEqual(emailRecord.authSalt, butil.ONES)) {
        return customs.flag(clientAddress, {
          email: emailRecord.email,
          errno: error.ERRNO.ACCOUNT_RESET
        }).then(() => {
          throw error.mustResetAccount(emailRecord.email)
        })
      }
      return password.verifyHash()
        .then(verifyHash => {
          return db.checkPassword(emailRecord.uid, verifyHash)
        })
        .then(match => {
          if (match) {
            return match
          }
          return customs.flag(clientAddress, {
            email: emailRecord.email,
            errno: error.ERRNO.INCORRECT_PASSWORD
          }).then(() => {
            match
          })
        })
    },

    /**
     * Check if user is allowed a password-checking attempt.
     * This asks the customs-server for its assessment, and applies any unblock
     * code that the user may have submitted to bypass customs-server blocks.
     * It returns an object with the following information about the process:
     *
     *  {
     *    didSigninUnblock:  whether an unblock code was successfully used
     *  }
     */
    checkCustomsRules(request, email) {
      let didSigninUnblock = false
      return P.resolve().then(() => {
        // For testing purposes, some email addresses are forced
        // to go through signin unblock on every login attempt.
        const forced = config.signinUnblock && config.signinUnblock.forcedEmailAddresses
        if (forced && forced.test(email)) {
          return P.reject(error.requestBlocked(true))
        }
        return customs.check(request, email, 'accountLogin')
      }).catch((e) => {
        // Non-customs-related errors get thrown straight back to the caller.
        if (e.errno !== error.ERRNO.REQUEST_BLOCKED && e.errno !== error.ERRNO.THROTTLED) {
          throw e
        }
        const customsError = e
        return request.emitMetricsEvent('account.login.blocked').then(() => {
          // If this customs error cannot be bypassed with email confirmation,
          // throw it straight back to the caller.
          var verificationMethod = e.output.payload.verificationMethod
          if (verificationMethod !== 'email-captcha' || ! request.payload.unblockCode) {
            throw customsError
          }
          // Check for a valid unblockCode, to allow the request to proceed.
          const unblockCode = request.payload.unblockCode.toUpperCase()
          return db.consumeUnblockCodeForEmail(email, unblockCode).then((code) => {
            if (Date.now() - code.createdAt > unblockCodeLifetime) {
              log.info({
                op: 'Account.login.unblockCode.expired',
                email: email
              })
              throw error.invalidUnblockCode()
            }
          })
        }).catch((e) => {
          // For any error other than INVALID_UNBLOCK_CODE, we re-throw
          // the original customs error in order to avoid acidentally leaking
          // additional state to a caller that's been blocked.
          if (e.errno !== error.ERRNO.INVALID_UNBLOCK_CODE) {
            throw customsError
          }
          return request.emitMetricsEvent('account.login.invalidUnblockCode').then(() => {
            customs.flag(request.app.clientAddress, {
              email: email,
              errno: e.errno
            })
            throw e
          })
        }).then(() => {
          didSigninUnblock = true
          return request.emitMetricsEvent('account.login.confirmedUnblockCode')
        })
      }).then(() => {
        return { didSigninUnblock }
      })
    },

    /**
    * Send all the various notifications that result from a new signin.
    * This includes emailing the user, logging metrics events, and
    * notifying attached services.
    */
    sendSigninNotifications(request, accountRecord, sessionToken, verificationMethod) {
      const service = request.payload.service || request.query.service
      const redirectTo = request.payload.redirectTo
      const resume = request.payload.resume
      const ip = request.app.clientAddress

      let sessions

      // Store flowId and flowBeginTime to send in email
      let flowId, flowBeginTime
      if (request.payload.metricsContext) {
        flowId = request.payload.metricsContext.flowId
        flowBeginTime = request.payload.metricsContext.flowBeginTime
      }

      // If the email itself is unverified, we'll re-send the "verify your account email" rather
      // than sending one of the "confirm this signin" email variants.
      const doSigninConfirmation = sessionToken.mustVerify && accountRecord.primaryEmail.isVerified

      // The final event to complete the login flow depends on the details
      // of the flow being undertaken, so prepare accordingly.
      let flowCompleteSignal
      if (service === 'sync') {
        flowCompleteSignal = 'account.signed'
      } else if (doSigninConfirmation) {
        flowCompleteSignal = 'account.confirmed'
      } else {
        flowCompleteSignal = 'account.login'
      }
      request.setMetricsFlowCompleteSignal(flowCompleteSignal, 'login')

      return stashMetricsContext()
        .then(checkNumberOfActiveSessions)
        .then(emitLoginEvent)
        .then(sendVerifyAccountEmail)
        .then(sendNewDeviceLoginEmail)
        .then(sendVerifySessionEmail)
        .then(recordSecurityEvent)

      function stashMetricsContext() {
        return request.stashMetricsContext(sessionToken)
          .then(() => {
            if (doSigninConfirmation) {
              // There is no session token when we emit account.confirmed
              // so stash the data against a synthesized "token" instead.
              return request.stashMetricsContext({
                uid: accountRecord.uid,
                id: sessionToken.tokenVerificationId
              })
            }
          })
      }

      function checkNumberOfActiveSessions () {
        return db.sessions(accountRecord.uid)
          .then(s => {
            sessions = s
            if (sessions.length > MAX_ACTIVE_SESSIONS) {
              // There's no spec-compliant way to error out
              // as a result of having too many active sessions.
              // For now, just log metrics about it.
              log.error({
                op: 'Account.login',
                uid: accountRecord.uid,
                userAgent: request.headers['user-agent'],
                numSessions: sessions.length
              })
            }
          })
      }

      function emitLoginEvent () {
        return request.emitMetricsEvent('account.login', {
          uid: accountRecord.uid
        }).then(() => {
          if (service === 'sync' && request.payload.reason === 'signin') {
            return log.notifyAttachedServices('login', request, {
              service: 'sync',
              uid: accountRecord.uid,
              email: accountRecord.primaryEmail.email,
              deviceCount: sessions.length,
              userAgent: request.headers['user-agent']
            })
          }
        })
      }

      function sendVerifyAccountEmail() {
        if (! accountRecord.primaryEmail.isVerified) {

          // If the session doesn't require verification,
          // fall back to the account-level email code for the link.
          const emailCode = sessionToken.tokenVerificationId || accountRecord.primaryEmail.emailCode

          return mailer.sendVerifyCode([], accountRecord, {
            code: emailCode,
            service,
            redirectTo,
            resume,
            acceptLanguage: request.app.acceptLanguage,
            flowId,
            flowBeginTime,
            ip,
            location: request.app.geo.location,
            uaBrowser: sessionToken.uaBrowser,
            uaBrowserVersion: sessionToken.uaBrowserVersion,
            uaOS: sessionToken.uaOS,
            uaOSVersion: sessionToken.uaOSVersion,
            uaDeviceType: sessionToken.uaDeviceType,
            uid: sessionToken.uid
          }).then(() => {
            request.emitMetricsEvent('email.verification.sent')
          })
        }
      }

      function sendNewDeviceLoginEmail() {
        // New device notification emails should only be sent when requesting keys.
        // They're not sent if performing a sign-in confirmation
        // (in which case you get the sign-in confirmation email)
        const shouldSendNewDeviceLoginEmail = requestHelper.wantsKeys(request)
          && ! doSigninConfirmation
          && accountRecord.primaryEmail.isVerified
        const geoData = request.app.geo
        if (shouldSendNewDeviceLoginEmail) {
          mailer.sendNewDeviceLoginNotification(
            accountRecord.emails,
            accountRecord,
            {
              acceptLanguage: request.app.acceptLanguage,
              flowId: flowId,
              flowBeginTime: flowBeginTime,
              ip: ip,
              location: geoData.location,
              service,
              timeZone: geoData.timeZone,
              uaBrowser: sessionToken.uaBrowser,
              uaBrowserVersion: sessionToken.uaBrowserVersion,
              uaOS: sessionToken.uaOS,
              uaOSVersion: sessionToken.uaOSVersion,
              uaDeviceType: sessionToken.uaDeviceType,
              uid: sessionToken.uid
            }
          )
          .catch(e => {
            // If we couldn't email them, no big deal. Log
            // and pretend everything worked.
            log.trace({
              op: 'Account.login.sendNewDeviceLoginNotification.error',
              error: e
            })
          })
        }
      }

      function sendVerifySessionEmail() {
        // If this login requires a confirmation, check to see if a specific method was specified in
        // the request. If none was specified, use the `email` verficationMethod.
        if (doSigninConfirmation) {
          if (verificationMethod === 'email') {
            // Sends an email containing a link to verify login
            return sendVerifyLoginEmail()
          } else if (verificationMethod === 'email-2fa') {
            // Sends an email containing a code that can verify a login
            return sendVerifyLoginCodeEmail()
          } else if (verificationMethod === 'email-captcha') {
            // `email-captcha` is a custom verification method used only for
            // unblock codes. We do not need to send a verification email
            // in this case.
          } else {
            return sendVerifyLoginEmail()
          }
        }
      }

      function sendVerifyLoginEmail() {
        log.info({
          op: 'account.signin.confirm.start',
          uid: accountRecord.uid,
          tokenVerificationId: sessionToken.tokenVerificationId
        })

        const geoData = request.app.geo
        return mailer.sendVerifyLoginEmail(
          accountRecord.emails,
          accountRecord,
          {
            acceptLanguage: request.app.acceptLanguage,
            code: sessionToken.tokenVerificationId,
            flowId: flowId,
            flowBeginTime: flowBeginTime,
            ip: ip,
            location: geoData.location,
            redirectTo: redirectTo,
            resume: resume,
            service: service,
            timeZone: geoData.timeZone,
            uaBrowser: sessionToken.uaBrowser,
            uaBrowserVersion: sessionToken.uaBrowserVersion,
            uaOS: sessionToken.uaOS,
            uaOSVersion: sessionToken.uaOSVersion,
            uaDeviceType: sessionToken.uaDeviceType,
            uid: sessionToken.uid
          }
        )
        .then(() => request.emitMetricsEvent('email.confirmation.sent'))
      }

      function sendVerifyLoginCodeEmail() {
        log.info({
          op: 'account.token.code.start',
          uid: accountRecord.uid
        })

        const geoData = request.app.geo
        return mailer.sendVerifyLoginCodeEmail(
          accountRecord.emails,
          accountRecord,
          {
            acceptLanguage: request.app.acceptLanguage,
            code: sessionToken.tokenVerificationCode,
            flowId: flowId,
            flowBeginTime: flowBeginTime,
            ip: ip,
            location: geoData.location,
            redirectTo: redirectTo,
            resume: resume,
            service: service,
            timeZone: geoData.timeZone,
            uaBrowser: sessionToken.uaBrowser,
            uaBrowserVersion: sessionToken.uaBrowserVersion,
            uaOS: sessionToken.uaOS,
            uaOSVersion: sessionToken.uaOSVersion,
            uaDeviceType: sessionToken.uaDeviceType,
            uid: sessionToken.uid
          }
        )
        .then(() => request.emitMetricsEvent('email.tokencode.sent'))
      }

      function recordSecurityEvent() {
        db.securityEvent({
          name: 'account.login',
          uid: accountRecord.uid,
          ipAddr: ip,
          tokenId: sessionToken && sessionToken.id
        })
      }
    },

    createKeyFetchToken(accountRecord, password, sessionToken) {
      return password.unwrap(accountRecord.wrapWrapKb)
        .then(wrapKb => {
          return db.createKeyFetchToken({
            uid: accountRecord.uid,
            kA: accountRecord.kA,
            wrapKb: wrapKb,
            emailVerified: accountRecord.primaryEmail.isVerified,
            tokenVerificationId: sessionToken.tokenVerificationId
          })
        })
    },

    getSessionVerificationStatus(sessionToken, verificationMethod) {
      if (! sessionToken.emailVerified) {
        return {
          verified: false,
          verificationMethod: 'email',
          verificationReason: 'signup'
        }
      }
      if (sessionToken.mustVerify && ! sessionToken.tokenVerified) {
        return {
          verified: false,
          // Override the verification method if it was explicitly specified in the request.
          verificationMethod: verificationMethod || 'email',
          verificationReason: 'login'
        }
      }
      return { verified: true }
    },

  }
}

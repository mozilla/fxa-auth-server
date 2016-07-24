/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var P = require('./promise')
var error = require('./error')
var createMailer = require('fxa-auth-mailer')

module.exports = function (config, log) {
  var defaultLanguage = config.i18n.defaultLanguage

  function wrapMailerResult(result) {
    return P.resolve(result)
      .catch(
        function (err) {
          // XXX TODO: how can we tell whether it failed
          // due to problem with the email, vs operation reasons?
          log.error({ op: 'mailer.send.error', err: err })
          throw error.emailRejected()
        }
      )
  }

  return createMailer(
    log,
    {
      locales: config.i18n.supportedLanguages,
      defaultLanguage: defaultLanguage,
      mail: config.smtp
    }
  )
  .then(
    function (mailer) {
      mailer.sendVerifyCode = function (account, code, opts) {
        return wrapMailerResult(mailer.verifyEmail(
          {
            email: account.email,
            uid: account.uid.toString('hex'),
            code: code.toString('hex'),
            service: opts.service,
            redirectTo: opts.redirectTo,
            resume: opts.resume,
            acceptLanguage: opts.acceptLanguage || defaultLanguage
          }
        ))
      }
      mailer.sendVerifyLoginEmail = function (account, code, opts) {
        return wrapMailerResult(mailer.verifyLoginEmail(
          {
            acceptLanguage: opts.acceptLanguage || defaultLanguage,
            code: code.toString('hex'),
            email: account.email,
            redirectTo: opts.redirectTo,
            resume: opts.resume,
            service: opts.service,
            uaBrowser: opts.uaBrowser,
            uaBrowserVersion: opts.uaBrowserVersion,
            uaOS: opts.uaOS,
            uaOSVersion: opts.uaOSVersion,
            uid: account.uid.toString('hex')
          }
        ))
      }
      mailer.sendRecoveryCode = function (token, code, opts) {
        return wrapMailerResult(mailer.recoveryEmail(
          {
            email: token.email,
            token: token.data.toString('hex'),
            code: code.toString('hex'),
            service: opts.service,
            redirectTo: opts.redirectTo,
            resume: opts.resume,
            acceptLanguage: opts.acceptLanguage || defaultLanguage
          }
        ))
      }
      mailer.sendUnlockCode = function (account, code, opts) {
        return wrapMailerResult(mailer.unlockEmail(
          {
            email: account.email,
            uid: account.uid.toString('hex'),
            code: code.toString('hex'),
            service: opts.service,
            redirectTo: opts.redirectTo,
            resume: opts.resume,
            acceptLanguage: opts.acceptLanguage || defaultLanguage
          }
        ))
      }
      mailer.sendPasswordChangedNotification = function (email, opts) {
        return wrapMailerResult(mailer.passwordChangedEmail(
          {
            email: email,
            acceptLanguage: opts.acceptLanguage || defaultLanguage
          }
        ))
      }
      mailer.sendPasswordResetNotification = function (email, opts) {
        return wrapMailerResult(mailer.passwordResetEmail(
          {
            email: email,
            acceptLanguage: opts.acceptLanguage || defaultLanguage
          }
        ))
      }
      mailer.sendNewDeviceLoginNotification = function (email, opts) {
        return wrapMailerResult(mailer.newDeviceLoginEmail(
          {
            email: email,
            acceptLanguage: opts.acceptLanguage || defaultLanguage,
            uaBrowser: opts.uaBrowser,
            uaBrowserVersion: opts.uaBrowserVersion,
            uaOS: opts.uaOS,
            uaOSVersion: opts.uaOSVersion,
            timestamp: opts.timestamp
          }
        ))
      }
      mailer.sendPostVerifyEmail = function (email, opts) {
        return wrapMailerResult(mailer.postVerifyEmail(
          {
            email: email,
            acceptLanguage: opts.acceptLanguage || defaultLanguage
          }
        ))
      }
      return mailer
    }
  )
}

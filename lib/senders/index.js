/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// XXX: ES6 features aren't currently allowed in this file.

// This indirection exists to accommodate different config properties
// in the old auth mailer. If/when the two config files are merged and
// there's nothing left that imports mailer/config, it is safe to merge
// legacy_index.js and this file into one.
var createSenders = require('./legacy_index')

module.exports = function (log, config, error, bounces, translator, sender) {
  var defaultLanguage = config.i18n.defaultLanguage

  return createSenders(
    log,
    {
      mail: config.smtp,
      sms: config.sms
    },
    translator,
    sender
  )
  .then(function (senders) {
    var ungatedMailer = senders.email

    function getSafeMailer(email) {
      return bounces.check(email)
        .return(ungatedMailer)
        .catch(function (err) {
          log.info({
            op: 'mailer.blocked',
            errno: err.errno
          })
          throw err
        })
    }

    senders.email = {
      sendVerifyCode: function (account, code, opts) {
        return getSafeMailer(account.email)
          .then(function (mailer) {
            return mailer.verifyEmail({
              email: account.email,
              flowId: opts.flowId,
              flowBeginTime: opts.flowBeginTime,
              uid: account.uid.toString('hex'),
              code: code.toString('hex'),
              service: opts.service,
              redirectTo: opts.redirectTo,
              resume: opts.resume,
              acceptLanguage: opts.acceptLanguage || defaultLanguage,
              ip: opts.ip,
              location: opts.location,
              uaBrowser: opts.uaBrowser,
              uaBrowserVersion: opts.uaBrowserVersion,
              uaOS: opts.uaOS,
              uaOSVersion: opts.uaOSVersion
            })
          })
      },
      sendVerifyLoginEmail: function (account, code, opts) {
        return getSafeMailer(account.email)
          .then(function (mailer) {
            return mailer.verifyLoginEmail({
              acceptLanguage: opts.acceptLanguage || defaultLanguage,
              code: code.toString('hex'),
              email: account.email,
              ip: opts.ip,
              flowId: opts.flowId,
              flowBeginTime: opts.flowBeginTime,
              location: opts.location,
              redirectTo: opts.redirectTo,
              resume: opts.resume,
              service: opts.service,
              timeZone: opts.timeZone,
              uaBrowser: opts.uaBrowser,
              uaBrowserVersion: opts.uaBrowserVersion,
              uaOS: opts.uaOS,
              uaOSVersion: opts.uaOSVersion,
              uid: account.uid.toString('hex')
            })
          })
      },
      sendRecoveryCode: function (token, code, opts) {
        return getSafeMailer(token.email)
          .then(function (mailer) {
            return mailer.recoveryEmail({
              email: token.email,
              flowId: opts.flowId,
              flowBeginTime: opts.flowBeginTime,
              token: token.data.toString('hex'),
              code: code.toString('hex'),
              service: opts.service,
              redirectTo: opts.redirectTo,
              resume: opts.resume,
              acceptLanguage: opts.acceptLanguage || defaultLanguage,
              ip: opts.ip,
              location: opts.location,
              timeZone: opts.timeZone,
              uaBrowser: opts.uaBrowser,
              uaBrowserVersion: opts.uaBrowserVersion,
              uaOS: opts.uaOS,
              uaOSVersion: opts.uaOSVersion
            })
          })
      },
      sendPasswordChangedNotification: function (email, opts) {
        return getSafeMailer(email)
          .then(function (mailer) {
            return mailer.passwordChangedEmail({
              email: email,
              acceptLanguage: opts.acceptLanguage || defaultLanguage,
              ip: opts.ip,
              location: opts.location,
              uaBrowser: opts.uaBrowser,
              uaBrowserVersion: opts.uaBrowserVersion,
              uaOS: opts.uaOS,
              uaOSVersion: opts.uaOSVersion
            })
          })
      },
      sendPasswordResetNotification: function (email, opts) {
        return getSafeMailer(email)
          .then(function (mailer) {
            return mailer.passwordResetEmail({
              email: email,
              acceptLanguage: opts.acceptLanguage || defaultLanguage,
              flowId: opts.flowId,
              flowBeginTime: opts.flowBeginTime,
            })
          })
      },
      sendNewDeviceLoginNotification: function (email, opts) {
        return getSafeMailer(email)
          .then(function (mailer) {
            return mailer.newDeviceLoginEmail({
              acceptLanguage: opts.acceptLanguage || defaultLanguage,
              flowId: opts.flowId,
              flowBeginTime: opts.flowBeginTime,
              email: email,
              ip: opts.ip,
              location: opts.location,
              timeZone: opts.timeZone,
              uaBrowser: opts.uaBrowser,
              uaBrowserVersion: opts.uaBrowserVersion,
              uaOS: opts.uaOS,
              uaOSVersion: opts.uaOSVersion
            })
          })
      },
      sendPostVerifyEmail: function (email, opts) {
        return getSafeMailer(email)
          .then(function (mailer) {
            return mailer.postVerifyEmail({
              email: email,
              acceptLanguage: opts.acceptLanguage || defaultLanguage
            })
          })
      },
      sendUnblockCode: function (account, unblockCode, opts) {
        return getSafeMailer(account.email)
          .then(function (mailer) {
            return mailer.unblockCodeEmail({
              acceptLanguage: opts.acceptLanguage || defaultLanguage,
              flowId: opts.flowId,
              flowBeginTime: opts.flowBeginTime,
              email: account.email,
              ip: opts.ip,
              location: opts.location,
              timeZone: opts.timeZone,
              uaBrowser: opts.uaBrowser,
              uaBrowserVersion: opts.uaBrowserVersion,
              uaOS: opts.uaOS,
              uaOSVersion: opts.uaOSVersion,
              uid: account.uid.toString('hex'),
              unblockCode: unblockCode
            })
          })
      },
      translator: function () {
        return ungatedMailer.translator.apply(ungatedMailer, arguments)
      },
      stop: function () {
        return ungatedMailer.stop()
      },
      _ungatedMailer: ungatedMailer
    }
    return senders
  })
}

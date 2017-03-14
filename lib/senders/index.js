/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

var P = require('../promise')
// This indirection exists to accommodate different config properties
// in the old auth mailer. If/when the two config files are merged and
// there's nothing left that imports mailer/config, it is safe to merge
// legacy_index.js and this file into one.
var createSenders = require('./legacy_index')

module.exports = function (log, config, translator, sender) {
  var defaultLanguage = config.i18n.defaultLanguage

  // Helper function that gets all the users emails and
  // sends the corresponding template from `mailerFunc` to
  // all verified email addresses.
  function sendToEmails(mailFunc, mailer, opts) {
    const mailPromises = []
    return P.resolve()
      .then(() => {
        if (opts.db && opts.uid) {
          return opts.db.accountEmails(Buffer.from(opts.uid, 'hex'))
            .then((emails) => {
              emails.forEach((email) => {

                // Only send to verified and primary emails.
                if (email.isVerified || email.isPrimary) {
                  opts.email = email.email
                  mailPromises.push(mailFunc.bind(mailer, opts)())
                }
              })
            })
        } else {
          mailPromises.push(mailFunc.bind(mailer, opts)())
        }
      })
      .then(() => {
        if (mailPromises.length > 0) {
          return P.all(mailPromises)
        }

        return P.resolve()
      })
  }

  return createSenders(
    log,
    {
      mail: config.smtp,
      sms: config.sms
    },
    translator,
    sender
  )
  .then(
    function (senders) {
      var mailer = senders.email
      mailer.sendVerifyCode = function (account, code, opts) {
        return P.resolve(mailer.verifyEmail(
          {
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
          }
        ))
      }
      mailer.sendVerifyLoginEmail = function (account, code, opts) {
        return sendToEmails(mailer.verifyLoginEmail,
          mailer,
          {
            db: opts.db,
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
          }
        )
      }
      mailer.sendVerifySecondaryEmail = function (account, code, opts) {
        return P.resolve(mailer.verifySecondaryEmail(
          {
            acceptLanguage: opts.acceptLanguage || defaultLanguage,
            code: code.toString('hex'),
            email: opts.email,
            ip: opts.ip,
            location: opts.location,
            redirectTo: opts.redirectTo,
            resume: opts.resume,
            service: opts.service,
            timeZone: opts.timeZone,
            uaBrowser: opts.uaBrowser,
            uaBrowserVersion: opts.uaBrowserVersion,
            uaOS: opts.uaOS,
            uaOSVersion: opts.uaOSVersion,
            uid: account.uid.toString('hex'),
            userEmail: account.email
          }
        ))
      }
      mailer.sendRecoveryCode = function (token, code, opts) {
        return P.resolve(mailer.recoveryEmail(
          {
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
          }
        ))
      }
      mailer.sendPasswordChangedNotification = function (email, opts) {
        return sendToEmails(mailer.passwordChangedEmail,
          mailer,
          {
            db: opts.db,
            uid: opts.uid.toString('hex'),
            email: email,
            acceptLanguage: opts.acceptLanguage || defaultLanguage,
            ip: opts.ip,
            location: opts.location,
            uaBrowser: opts.uaBrowser,
            uaBrowserVersion: opts.uaBrowserVersion,
            uaOS: opts.uaOS,
            uaOSVersion: opts.uaOSVersion
          }
        )
      }
      mailer.sendPasswordResetNotification = function (email, opts) {
        return P.resolve(mailer.passwordResetEmail(
          {
            email: email,
            acceptLanguage: opts.acceptLanguage || defaultLanguage,
            flowId: opts.flowId,
            flowBeginTime: opts.flowBeginTime,
          }
        ))
      }
      mailer.sendNewDeviceLoginNotification = function (email, opts) {
        return sendToEmails(mailer.newDeviceLoginEmail,
          mailer,
          {
            db: opts.db,
            uid: opts.uid.toString('hex'),
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
          }
        )
      }
      mailer.sendPostVerifyEmail = function (email, opts) {
        return P.resolve(mailer.postVerifyEmail(
          {
            email: email,
            acceptLanguage: opts.acceptLanguage || defaultLanguage
          }
        ))
      }
      mailer.sendUnblockCode = function (account, unblockCode, opts) {
        return sendToEmails(mailer.unblockCodeEmail,
          mailer,
          {
            db: opts.db,
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
          }
        )
      }
      return senders
    }
  )
}

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var P = require('./promise')
var request = require('./requestp')

module.exports = function (mailerUrl, log) {

  function Mailer(baseUrl) {
    this.baseUrl = baseUrl
  }

  // Sends a verification email to the user.
  //
  // - account : the account containing account.email and account.uid
  // - code : the code which proves the user got the email
  // - opts : object of options:
  //   - service : the service we came from
  //   - redirectTo : where to redirect the user once clicked
  //   - acceptLanguage : the preferred language of the user
  Mailer.prototype.sendVerifyCode = function (account, code, opts) {
    log.trace({ op: 'mailer.sendVerifyCode', email: account.email, uid: account.uid })
    return request(
      {
        method: 'POST',
        url: this.baseUrl + '/send',
        json: {
          type: 'verifyEmail',
          email: account.email,
          uid: account.uid,
          code: code.toString('hex'),
          service: opts.service,
          redirectTo: opts.redirectTo,
          acceptLanguage: opts.acceptLanguage || 'en-US'
        }
      }
    )
  }

  // Sends an account recovery email to the user.
  //
  // - token : the token containing token.email and token.data
  // - code : the code which proves the user got the email
  // - opts : object of options:
  //   - service : the service we came from
  //   - redirectTo : where to redirect the user once clicked
  //   - acceptLanguage : the preferred language of the user
  Mailer.prototype.sendRecoveryCode = function (token, code, opts) {
    log.trace({ op: 'mailer.sendRecoveryCode', email: token.email })
    return request(
      {
        method: 'POST',
        url: this.baseUrl + '/send',
        json: {
          type: 'recoveryEmail',
          email: token.email,
          token: token.data.toString('hex'),
          code: code.toString('hex'),
          service: opts.service,
          redirectTo: opts.redirectTo,
          acceptLanguage: opts.acceptLanguage || 'en-US'
        }
      }
    )
  }

  return P(new Mailer(mailerUrl))
}

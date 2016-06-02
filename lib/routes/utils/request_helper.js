/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Returns `true` if request has a keys=true query param.
 *
 * @param request
 * @returns {boolean}
 */
function wantsKeys (request) {
  return request.query.keys === 'true' || request.query.keys === true
}

/**
 * Returns whether or not to perform a signin verification email.
 *
 * @param account
 * @param config
 * @param request
 * @returns {boolean}
 */
function shouldEnableSigninConfirmation(account, config, request) {

  var confirmLogin = config.signinConfirmation && config.signinConfirmation.enabled
  if (confirmLogin) {

    var uid = account.uid.toString('hex')
    var email = account.email

    // If feature enabled, always enable for these emails
    var emailDomain = account.email.substring(email.indexOf('@'), email.length).toLocaleLowerCase()
    var isValidEmail = config.signinConfirmation.allowEmails.indexOf(emailDomain) > -1
    if (isValidEmail) {
      return true
    }

    // Check for valid context
    var context = request.payload && request.payload.metricsContext && request.payload.metricsContext.context
    var isValidContext = context && (config.signinConfirmation.allowClients.indexOf(context) > -1)

    // Check to see if in sample
    var uidNum = parseInt(uid.substr(0, 4), 16) % 100
    var isInSampleRate =  uidNum < (config.signinConfirmation.sample_rate * 100)

    if (isValidContext && isInSampleRate) {
      return true
    } else {
      return false
    }

  } else {
    return false
  }
}

module.exports = {
  wantsKeys: wantsKeys,
  shouldEnableSigninConfirmation: shouldEnableSigninConfirmation
}

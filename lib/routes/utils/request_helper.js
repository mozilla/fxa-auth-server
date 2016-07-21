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
  return request.query.keys === 'true'
}

/**
 * Returns whether or not to perform a sign-in verification email.
 *
 * @param account
 * @param config
 * @param request
 * @returns {boolean}
 */
function shouldEnableSigninConfirmation(account, config, request) {

  var confirmLogin = config.signinConfirmation && config.signinConfirmation.enabled
  if (!confirmLogin) {
    return false
  }

  // For legacy devices that make direct API requests
  // (and hence don't submit metrics) we always do sign-in confirmation.
  if (!request.payload || !request.payload.metricsContext) {
    return true
  }

  // For devices that log in via web-content, only do sign-in confirmation
  // if they're within in roll-out sample cohort.  We make this check
  // deterministic by basing it on the userid.
  var uid = account.uid.toString('hex')
  var uidNum = parseInt(uid.substr(0, 4), 16) % 100
  return uidNum < (config.signinConfirmation.sample_rate * 100)
}

module.exports = {
  wantsKeys: wantsKeys,
  shouldEnableSigninConfirmation: shouldEnableSigninConfirmation
}

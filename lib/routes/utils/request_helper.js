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
 * Currently, the uid is converted to a number between 0-100 which corresponds to the
 * sign-in confirmation sample rate.
 *
 * @param uid
 * @returns {boolean}
 */
function shouldEnableSigninConfirmation(uid, config) {
  // Sign-in confirmation is determined by whether the feature is enabled and
  // if the user's first two uid digits fall within the config sample rate.
  if (config.signinConfirmation && config.signinConfirmation.enabled) {

    // Returns the first 2 integers of uid
    var uidNum = parseInt(uid.substr(0, 4), 16) % 100

    return uidNum < (config.signinConfirmation.sample_rate * 100)
  } else {
    return false
  }
}

module.exports = {
  wantsKeys: wantsKeys,
  shouldEnableSigninConfirmation: shouldEnableSigninConfirmation
}

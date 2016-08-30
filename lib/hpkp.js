/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Hapi middleware to append HPKP headers to all responses.
 *
 * @param maxAge
 * @param sha256Pins
 * @param includeSubdomains
 * @returns {Function}
 */
module.exports = function (maxAge, sha256Pins, includeSubdomains) {

  var hpkpParts = []

  sha256Pins.forEach(function (pinSha) {
    hpkpParts.push('pin-sha256="' + pinSha + '"')
  })

  hpkpParts.push('max-age=' + maxAge)

  if (includeSubdomains) {
    hpkpParts.push('includeSubdomains')
  }

  var hpkpHeader = hpkpParts.join('; ')

  return function (request, reply) {
    var response = request.response

    if (response.header) {
      response.header('Public-Key-Pins', hpkpHeader)
    }

    return reply.continue()
  }
}

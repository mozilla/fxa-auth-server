/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var jwtool = require('fxa-jwtool')

module.exports = function (secretKeyFile, domain) {

  var key = jwtool.JWK.fromFile(secretKeyFile, {iss: domain })

  return {
    sign: function (data) {
      var now = Date.now()
      return key.sign(
        {
          'public-key': data.publicKey,
          principal: {
            email: data.email
          },
          iat: now - (10 * 1000),
          exp: now + data.duration,
          'fxa-generation': data.generation,
          'fxa-lastAuthAt': data.lastAuthAt,
          'fxa-verifiedEmail': data.verifiedEmail,
          'fxa-deviceId': data.deviceId
        }
      )
      .then(
        function (cert) {
          return { cert: cert }
        }
      )
    }
  }
}

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var requestModule = require('request')

module.exports = function (log, config, isA, customs, error) {
  var RECAPTCHA_SECRET = config.captcha.secret
  var RECAPTCHA_ENDPOINT = 'https://www.google.com/recaptcha/api/siteverify'

  var routes = [
    {
      method: 'POST',
      path: '/captcha/validate',
      config: {
        validate: {
          payload: {
            email: isA.string().required(),
            recaptchaResponse: isA.string().required()
          }
        }
      },
      handler: function validateCaptcha(request, reply) {
        var form = request.payload

        requestModule.post({
          url: RECAPTCHA_ENDPOINT,
          json: true,
          data: {
            secret: RECAPTCHA_SECRET,
            response: form.recaptchaResponse
          }
        }, function (err, response) {
          var success = response.body.success
          // if valid captcha
          if (success === true) {
            return customs.resetEntry(request.app.clientAddress, form.email)
              .done(
                function () {
                  reply({})
                },
                reply
              )
          } else {
            return reply({ err: 'Bad Captcha' }).code(400)
          }
        })
      }
    }
  ]

  return routes
}

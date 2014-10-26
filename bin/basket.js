/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*/

This process reads fxa 'verified' auth-server events and sends them
to the [basket API](https://github.com/mozilla/basket) for user engagement.

/*/

var request = require('request')
var config = require('../config').root()
var log = require('../log')(config.log.level, 'basket')
var Sink = require('fxa-notifier-aws').Sink

var basketQueue = new Sink(config.basket.region, config.basket.queueUrl)
basketQueue.on(
  'data',
  function basketRequest(message) {
    log.trace({ op: 'basketRequest', sqs: message })
    if (message.event === 'verified') {
      request(
        {
          url: config.basket.apiUrl + '/fxa-register/',
          strictSSL: true,
          method: 'POST',
          headers: {
            'X-API-Key': config.basket.apiKey
          },
          form: {
            fxa_id: message.uid,
            email: message.email,
            accept_lang: message.locale
          }
        },
        function (err, res, body) {
          if (err) {
            return log.error({ op: 'basketRequest', err: err })
          }
          log.info({ op: 'basketRequest', status: res.statusCode, body: body })
          message.del()
        }
      )
    }
    else {
      message.del()
    }
  }
)
basketQueue.on('error', function (err) { log.error({ op: 'queueError', err: err })})
basketQueue.fetch()

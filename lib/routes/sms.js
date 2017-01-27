/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const validators = require('./validators')

const METRICS_CONTEXT_SCHEMA = require('../metrics/context').schema

module.exports = (log, isA) => {
  return [
    {
      method: 'POST',
      path: '/sms',
      config: {
        auth: {
          strategy: 'sessionToken'
        },
        validate: {
          payload: {
            phoneNumber: isA.string().regex(validators.NANP_NUMBER).required(),
            messageId: isA.number().positive().required(),
            metricsContext: METRICS_CONTEXT_SCHEMA
          }
        }
      },
      handler (request, reply) {
        log.begin('sms.send', request)
        request.validateMetricsContext()
        reply()
      }
    }
  ]
}

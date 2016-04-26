/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

var crypto = require('crypto')
var isA = require('joi')
var bufferEqualConstantTime = require('buffer-equal-constant-time')
var HEX = require('../routes/validators').HEX_STRING
var P = require('../promise')
var Memcached = require('memcached')
P.promisifyAll(Memcached.prototype)

var FLOW_ID_LENGTH = 64

var SCHEMA = isA.object({
  flowId: isA.string().length(64).regex(HEX).optional(),
  flowBeginTime: isA.number().integer().positive().optional(),
  context: isA.string().optional(),
  entrypoint: isA.string().optional(),
  migration: isA.string().optional(),
  service: isA.string().optional(),
  utmCampaign: isA.string().optional(),
  utmContent: isA.string().optional(),
  utmMedium: isA.string().optional(),
  utmSource: isA.string().optional(),
  utmTerm: isA.string().optional()
}).and('flowId', 'flowBeginTime').optional()

module.exports = function (log, config) {
  var _memcached

  return {
    schema: SCHEMA,
    save: save,
    copy: copy,
    remove: remove,
    validate: validate
  }

  /**
   * Saves metrics context metadata against a token.
   *
   * @param token    token to save the metadata against
   * @param metadata metrics context metadata
   */
  function save (token, metadata) {
    if (! token || ! metadata) {
      return P.resolve()
    }

    var memcached = getMemcached()
    return memcached.setAsync(token.tokenId.toString('hex'), metadata, 0)
      .catch(function (err) {
        log.error({ op: 'metricsContext.save', err: err })
      })
  }

  function getMemcached () {
    try {
      if (! _memcached) {
        _memcached = new Memcached(config.memcache.address, {
          timeout: 500,
          retries: 1,
          retry: 1000,
          reconnect: 1000,
          idle: config.memcache.idle,
          namespace: 'fxa-metrics~'
        })
      }

      return _memcached
    } catch (err) {
      log.error({ op: 'metricsContext.getMemcached', err: err })

      return {
        delAsync: nop,
        getAsync: nop,
        setAsync: nop
      }
    }
  }

  function nop () {
    return P.resolve()
  }

  /**
   * Copies metrics context metadata to data, using either metadata
   * passed in from a request or previously-saved metadata for a
   * token.
   *
   * @param data       target object
   * @param metadata   metrics context metadata passed in from request
   * @param token      token for reading previously-saved metadata
   * @param doNotTrack flag indicating whether DNT request header was
   *                   specified
   */
  function copy (data, metadata, token, doNotTrack) {
    return P.resolve()
      .then(function () {
        if (metadata) {
          return metadata
        }

        if (token) {
          return restore(token)
        }
      })
      .catch(function (err) {
        log.error({ op: 'metricsContext.copy', err: err })
      })
      .then(function (metadata) {
        if (metadata) {
          data.time = Date.now()
          data.flow_id = metadata.flowId
          data.flow_time = calculateFlowTime(data.time, metadata.flowBeginTime)
          data.context = metadata.context
          data.entrypoint = metadata.entrypoint
          data.migration = metadata.migration
          data.service = metadata.service

          if (doNotTrack === false) {
            data.utm_campaign = metadata.utmCampaign
            data.utm_content = metadata.utmContent
            data.utm_medium = metadata.utmMedium
            data.utm_source = metadata.utmSource
            data.utm_term = metadata.utmTerm
          }
        }

        return data
      })
  }

  function restore (token) {
    var memcached = getMemcached()
    return memcached.getAsync(token.tokenId.toString('hex'))
      .catch(function (err) {
        log.error({ op: 'metricsContext.restore', err: err })
      })
  }

  /**
   * Removes metrics context metadata for a token.
   *
   * @param token
   */
  function remove (token) {
    if (! token) {
      return P.resolve()
    }

    var memcached = getMemcached()
    return memcached.delAsync(token.tokenId.toString('hex'))
      .catch(function (err) {
        log.error({ op: 'metricsContext.remove', err: err })
      })
  }

  /**
   * Validates flowId and flowBeginTime from a request.
   *
   * @param request
   */
  function validate(request) {
    var metadata = request.payload.metricsContext

    if (!metadata) {
      return logInvalidContext(request, 'missing context')
    }
    if (!metadata.flowId) {
      return logInvalidContext(request, 'missing flowId')
    }
    if (!metadata.flowBeginTime) {
      return logInvalidContext(request, 'missing flowBeginTime')
    }

    if (Date.now() - metadata.flowBeginTime > config.metrics.flow_id_expiry) {
      return logInvalidContext(request, 'expired flowBeginTime')
    }

    // The first half of the id is random bytes, the second half is a HMAC of
    // additional contextual information about the request.  It's a simple way
    // to check that the metrics came from the right place, without having to
    // share state between content-server and auth-server.
    var flowSignature = metadata.flowId.substr(FLOW_ID_LENGTH / 2, FLOW_ID_LENGTH)
    var flowSignatureBytes = new Buffer(flowSignature, 'hex')
    var expectedSignatureBytes = calculateFlowSignatureBytes(request, metadata)
    if (! bufferEqualConstantTime(flowSignatureBytes, expectedSignatureBytes)) {
      return logInvalidContext(request, 'invalid signature')
    }

    log.info({
      op: 'metrics.context.validate',
      valid: true,
      agent: request.headers['user-agent']
    })
    log.increment('metrics.context.valid')
    return true
  }

  function logInvalidContext(request, reason) {
    log.warn({
      op: 'metrics.context.validate',
      valid: false,
      reason: reason,
      agent: request.headers['user-agent']
    })
    log.increment('metrics.context.invalid')
    return false
  }

  function calculateFlowSignatureBytes(request, metadata) {
    // We want a digest that's half the length of a flowid,
    // and we want the length in bytes rather than hex.
    var signatureLength = FLOW_ID_LENGTH / 2 / 2
    var key = config.metrics.flow_id_key
    return crypto.createHmac('sha256', key)
      .update([
        metadata.flowId.substr(0, FLOW_ID_LENGTH / 2),
        metadata.flowBeginTime.toString(16),
        request.headers['user-agent']
      ].join('\n'))
      .digest()
      .slice(0, signatureLength)
  }
}

function calculateFlowTime (time, flowBeginTime) {
  if (time <= flowBeginTime) {
    return 0
  }

  return time - flowBeginTime
}

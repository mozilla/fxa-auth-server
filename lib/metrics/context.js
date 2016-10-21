/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const crypto = require('crypto')
const isA = require('joi')
const bufferEqualConstantTime = require('buffer-equal-constant-time')
const HEX = require('../routes/validators').HEX_STRING
const P = require('../promise')
const Memcached = require('memcached')
P.promisifyAll(Memcached.prototype)

const FLOW_ID_LENGTH = 64

const SCHEMA = isA.object({
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

const NOP = function () {
  return P.resolve()
}

const NULL_MEMCACHED = {
  delAsync: NOP,
  getAsync: NOP,
  setAsync: NOP
}

module.exports = function (log, config) {
  let _memcached

  return {
    stash: stash,
    gather: gather,
    clear: clear,
    validate: validate,
    setFlowCompleteSignal: setFlowCompleteSignal
  }

  /**
   * Stashes metrics context metadata using a key derived from a token.
   * Asynchronous, returns a promise.
   *
   * @name stashMetricsContext
   * @this request
   * @param token    token to stash the metadata against
   */
  function stash (token) {
    const metadata = this.payload && this.payload.metricsContext

    if (! metadata) {
      return P.resolve()
    }

    return P.resolve()
      .then(() => getMemcached().setAsync(getKey(token), metadata, config.memcached.lifetime))
      .catch(err => log.error({ op: 'metricsContext.stash', err: err, token: token }))
  }

  function getMemcached () {
    if (_memcached) {
      return _memcached
    }

    try {
      if (config.memcached.address !== 'none') {
        _memcached = new Memcached(config.memcached.address, {
          timeout: 500,
          retries: 1,
          retry: 1000,
          reconnect: 1000,
          idle: config.memcached.idle,
          namespace: 'fxa-metrics~'
        })

        return _memcached
      }
    } catch (err) {
      log.error({ op: 'metricsContext.getMemcached', err: err })
    }

    return NULL_MEMCACHED
  }

  /**
   * Gathers metrics context metadata onto data, using either metadata
   * passed in with a request or previously-stashed metadata for a
   * token. Asynchronous, returns a promise that resolves to data, with
   * metrics context metadata copied to it.
   *
   * @name gatherMetricsContext
   * @this request
   * @param data target object
   */
  function gather (data) {
    const metadata = this.payload && this.payload.metricsContext
    const doNotTrack = this.headers && this.headers.dnt === '1'
    let token

    return P.resolve()
      .then(() => {
        if (metadata) {
          return metadata
        }

        token = getToken(this)

        return getMemcached().getAsync(getKey(token))
      })
      .then(metadata => {
        if (metadata) {
          data.time = Date.now()
          data.flow_id = metadata.flowId
          data.flow_time = calculateFlowTime(data.time, metadata.flowBeginTime)
          data.flowCompleteSignal = metadata.flowCompleteSignal
          data.context = metadata.context
          data.entrypoint = metadata.entrypoint
          data.migration = metadata.migration
          data.service = metadata.service

          if (! doNotTrack) {
            data.utm_campaign = metadata.utmCampaign
            data.utm_content = metadata.utmContent
            data.utm_medium = metadata.utmMedium
            data.utm_source = metadata.utmSource
            data.utm_term = metadata.utmTerm
          }
        }
      })
      .catch(err => log.error({ op: 'metricsContext.gather', err: err, token: token }))
      .then(() => data)
  }

  function getToken (request) {
    if (request.auth && request.auth.credentials) {
      return request.auth.credentials
    }

    if (request.payload && request.payload.uid && request.payload.code) {
      return {
        uid: Buffer(request.payload.uid, 'hex'),
        id: request.payload.code
      }
    }

    throw new Error('Invalid credentials')
  }

  /**
   * Attempt to clear previously-stashed metrics context metadata.
   *
   * @name clearMetricsContext
   * @this request
   */
  function clear () {
    return P.resolve()
      .then(() => getMemcached().delAsync(getKey(getToken(this))))
      .catch(() => {})
  }

  /**
   * Checks whether a request's flowId and flowBeginTime are valid.
   * Returns a boolean, `true` if the request is valid, `false` if
   * it's invalid.
   *
   * @name validateMetricsContext
   * @this request
   */
  function validate() {
    const metadata = this.payload.metricsContext

    if (!metadata) {
      return logInvalidContext(this, 'missing context')
    }
    if (!metadata.flowId) {
      return logInvalidContext(this, 'missing flowId')
    }
    if (!metadata.flowBeginTime) {
      return logInvalidContext(this, 'missing flowBeginTime')
    }

    if (Date.now() - metadata.flowBeginTime > config.metrics.flow_id_expiry) {
      return logInvalidContext(this, 'expired flowBeginTime')
    }

    // The first half of the id is random bytes, the second half is a HMAC of
    // additional contextual information about the request.  It's a simple way
    // to check that the metrics came from the right place, without having to
    // share state between content-server and auth-server.
    const flowSignature = metadata.flowId.substr(FLOW_ID_LENGTH / 2, FLOW_ID_LENGTH)
    const flowSignatureBytes = new Buffer(flowSignature, 'hex')
    const expectedSignatureBytes = calculateFlowSignatureBytes(this, metadata)
    if (! bufferEqualConstantTime(flowSignatureBytes, expectedSignatureBytes)) {
      return logInvalidContext(this, 'invalid signature')
    }

    log.info({
      op: 'metrics.context.validate',
      valid: true,
      agent: this.headers['user-agent']
    })
    log.increment('metrics.context.valid')
    return true
  }

  function logInvalidContext(request, reason) {
    if (request.payload.metricsContext) {
      delete request.payload.metricsContext.flowId
      delete request.payload.metricsContext.flowBeginTime
    }
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
    const signatureLength = FLOW_ID_LENGTH / 2 / 2
    const key = config.metrics.flow_id_key
    return crypto.createHmac('sha256', key)
      .update([
        metadata.flowId.substr(0, FLOW_ID_LENGTH / 2),
        metadata.flowBeginTime.toString(16),
        request.headers['user-agent']
      ].join('\n'))
      .digest()
      .slice(0, signatureLength)
  }

  /**
   * Sets the event name that will signal completion of the current flow.
   *
   * @name setMetricsFlowCompleteSignal
   * @this request
   * @param {String} flowCompleteSignal
   */
  function setFlowCompleteSignal (flowCompleteSignal) {
    if (this.payload && this.payload.metricsContext) {
      this.payload.metricsContext.flowCompleteSignal = flowCompleteSignal
    }
  }
}

function getKey (token) {
  if (! token || ! token.uid || ! token.id) {
    const err = new Error('Invalid token')
    throw err
  }

  const hash = crypto.createHash('sha256')
  hash.update(token.uid)
  hash.update(token.id)

  return hash.digest('base64')
}

function calculateFlowTime (time, flowBeginTime) {
  if (time <= flowBeginTime) {
    return 0
  }

  return time - flowBeginTime
}

module.exports.schema = SCHEMA


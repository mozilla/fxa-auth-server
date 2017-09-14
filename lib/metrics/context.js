/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const bufferEqualConstantTime = require('buffer-equal-constant-time')
const crypto = require('crypto')
const HEX_STRING = require('../routes/validators').HEX_STRING
const isA = require('joi')
const P = require('../promise')

const FLOW_ID_LENGTH = 64

const SCHEMA = isA.object({
  // The metrics context device id is a client-generated property
  // that is entirely separate to the devices table in our db.
  // All clients can generate a metrics context device id, whereas
  // only Sync creates records in the devices table.
  deviceId: isA.string().length(32).regex(HEX_STRING).optional(),
  flowId: isA.string().length(64).regex(HEX_STRING).optional(),
  flowBeginTime: isA.number().integer().positive().optional(),
  utmCampaign: isA.string().optional(),
  utmContent: isA.string().optional(),
  utmMedium: isA.string().optional(),
  utmSource: isA.string().optional(),
  utmTerm: isA.string().optional()
})
  .unknown(false)
  .and('flowId', 'flowBeginTime')

module.exports = function (log, config) {
  const cache = require('../cache')(log, config, 'fxa-metrics~')

  return {
    stash,
    gather,
    clear,
    validate,
    setFlowCompleteSignal
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
      .then(() => cache.set(getKey(token), metadata))
      .catch(err => log.error({
        op: 'metricsContext.stash',
        err: err,
        hasToken: !! token,
        hasId: !! (token && token.id),
        hasUid: !! (token && token.uid)
      }))
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
    let token

    return P.resolve()
      .then(() => {
        const metadata = this.payload && this.payload.metricsContext

        if (metadata) {
          return metadata
        }

        token = getToken(this)
        if (token) {
          return cache.get(getKey(token))
        }
      })
      .then(metadata => {
        if (metadata) {
          data.time = Date.now()
          data.device_id = metadata.deviceId
          data.flow_id = metadata.flowId
          data.flow_time = calculateFlowTime(data.time, metadata.flowBeginTime)
          data.flowBeginTime = metadata.flowBeginTime
          data.flowCompleteSignal = metadata.flowCompleteSignal
          data.flowType = metadata.flowType

          const doNotTrack = this.headers && this.headers.dnt === '1'
          if (! doNotTrack) {
            data.utm_campaign = metadata.utmCampaign
            data.utm_content = metadata.utmContent
            data.utm_medium = metadata.utmMedium
            data.utm_source = metadata.utmSource
            data.utm_term = metadata.utmTerm
          }
        }
      })
      .catch(err => log.error({
        op: 'metricsContext.gather',
        err: err,
        hasToken: !! token,
        hasId: !! (token && token.id),
        hasUid: !! (token && token.uid)
      }))
      .then(() => data)
  }

  function getToken (request) {
    if (request.auth && request.auth.credentials) {
      return request.auth.credentials
    }

    if (request.payload && request.payload.uid && request.payload.code) {
      return {
        uid: request.payload.uid,
        id: request.payload.code
      }
    }
  }

  /**
   * Attempt to clear previously-stashed metrics context metadata.
   *
   * @name clearMetricsContext
   * @this request
   */
  function clear () {
    return P.resolve()
      .then(() => {
        const token = getToken(this)
        if (token) {
          return cache.del(getKey(token))
        }
      })
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
    if (! this.payload) {
      return logInvalidContext(this, 'missing payload')
    }

    const metadata = this.payload.metricsContext

    if (! metadata) {
      return logInvalidContext(this, 'missing context')
    }
    if (! metadata.flowId) {
      return logInvalidContext(this, 'missing flowId')
    }
    if (! metadata.flowBeginTime) {
      return logInvalidContext(this, 'missing flowBeginTime')
    }

    const age = Date.now() - metadata.flowBeginTime
    if (age > config.metrics.flow_id_expiry || age <= 0) {
      return logInvalidContext(this, 'expired flowBeginTime')
    }

    if (! HEX_STRING.test(metadata.flowId)) {
      return logInvalidContext(this, 'invalid flowId')
    }

    // The first half of the id is random bytes, the second half is a HMAC of
    // additional contextual information about the request.  It's a simple way
    // to check that the metrics came from the right place, without having to
    // share state between content-server and auth-server.
    const flowSignature = metadata.flowId.substr(FLOW_ID_LENGTH / 2, FLOW_ID_LENGTH)
    const flowSignatureBytes = Buffer.from(flowSignature, 'hex')
    const expectedSignatureBytes = calculateFlowSignatureBytes(this, metadata)
    if (! bufferEqualConstantTime(flowSignatureBytes, expectedSignatureBytes)) {
      return logInvalidContext(this, 'invalid signature')
    }

    log.info({
      op: 'metrics.context.validate',
      valid: true,
      agent: this.headers['user-agent']
    })
    return true
  }

  function logInvalidContext(request, reason) {
    if (request.payload && request.payload.metricsContext) {
      delete request.payload.metricsContext.flowId
      delete request.payload.metricsContext.flowBeginTime
    }
    log.warn({
      op: 'metrics.context.validate',
      valid: false,
      reason: reason,
      agent: request.headers['user-agent']
    })
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
  function setFlowCompleteSignal (flowCompleteSignal, flowType) {
    if (this.payload && this.payload.metricsContext) {
      this.payload.metricsContext.flowCompleteSignal = flowCompleteSignal
      this.payload.metricsContext.flowType = flowType
    }
  }
}

function calculateFlowTime (time, flowBeginTime) {
  if (time <= flowBeginTime) {
    return 0
  }

  return time - flowBeginTime
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

// HACK: Force the API docs to expand SCHEMA inline
module.exports.SCHEMA = SCHEMA
module.exports.schema = SCHEMA.optional()
module.exports.requiredSchema = SCHEMA.required()


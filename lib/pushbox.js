/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * Pushbox allows its customers to store and retrieve durable payloads (~1 MB)
 * up to a certain amount of time.
 * FxA proxies Pushbox because it is already "well-known" by the current Firefox
 * implementations and it integrates well with the "devices" concept of FxA.
 */

'use strict'

const isA = require('joi')
const error = require('./error')
const Pool = require('./pool')
const P = require('./promise')
const {URL} = require('url')
const validators = require('./routes/validators')

const LOG_OP_RETRIEVE = 'pushbox.retrieve'
const LOG_OP_STORE = 'pushbox.store'

const TOPICS_TTL = {
  sendtab: 30 * 24 * 3600 // 30 days.
}

const PUSHBOX_RETRIEVE_SCHEMA = isA.alternatives().try(
  // common case
  isA.object({
    last: isA.boolean().required(),
    index: isA.number().required(),
    messages: isA.array().items(isA.object({
      index: isA.number().required(),
      data: isA.string().regex(validators.URL_SAFE_BASE_64).required(),
    })).optional(),
  }),
  // limit == 0 only returns the last index.
  isA.object({
    index: isA.number().required(),
  }),
  // error case
  isA.object({
    error: isA.string().required(),
    status: isA.number().required(),
  })
)
const validateSchema = P.promisify(PUSHBOX_RETRIEVE_SCHEMA.validate,
  {context: PUSHBOX_RETRIEVE_SCHEMA})

module.exports = function (log, config) {
  if (! config.pushbox.enabled) {
    return {
      retrieve() {
        return Promise.reject(error.featureNotEnabled())
      },
      store() {
        return Promise.reject(error.featureNotEnabled())
      }
    }
  }
  const pool = new Pool(config.pushbox.url, { timeout: 15000 })
  const SafeUrl = require('./safe-url')(log)

  return {
    /**
     * Retrieves messages for a specific device. Relays the request to Pushbox.
     *
     * @param {String} uid - Firefox Account uid
     * @param {String} deviceId
     * @param {Object} options
     * @param {Number} limit
     * @param {String} [index]
     * @returns {Promise}
     */
    retrieve (uid, deviceId, limit, index) {
      log.trace({
        op: LOG_OP_RETRIEVE,
        uid,
        deviceId,
        index,
        limit
      })
      const query = {
        limit: limit.toString()
      }
      if (index) {
        query.index = index
      }
      const headers = {Authorization: `FxA-Server-Key ${config.pushbox.key}`}
      const path = new SafeUrl('/v1/store/:uid/:deviceId')
      const params = {uid, deviceId}
      return pool.get(path, params, {query, headers})
      .then(body => validateSchema(body).catch(e => {
        throw new Error('Invalid Pushbox response')
      }))
    },

    /**
     * Store a message for a specific device
     *
     * @param {String} uid - Firefox Account uid
     * @param {String} deviceId
     * @param {string} topic
     * @param {String} data - Base64 string of the payload
     * @returns {Promise} direct url to the stored message
     */
    store (uid, deviceId, topic, data) {
      const ttl = TOPICS_TTL[topic]
      log.trace({
        op: LOG_OP_STORE,
        uid,
        deviceId,
        topic
      })
      const headers = {Authorization: `FxA-Server-Key ${config.pushbox.key}`}
      const body = {data, ttl}
      const path = new SafeUrl('/v1/store/:uid/:deviceId')
      const params = {uid, deviceId}
      return pool.post(path, params, body, {headers})
      .then(({index}) => {
        const msgPath = path.render(params)
        const url = new URL(msgPath, config.pushbox.url)
        url.searchParams.set('index', index)
        url.searchParams.set('limit', 1)
        return url.href
      })
    }
  }
}

module.exports.RETRIEVE_SCHEMA = PUSHBOX_RETRIEVE_SCHEMA

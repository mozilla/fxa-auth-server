/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// This module presents a "safe" interface to redis/pool and redis/connection,
// where "safe" means "always acquires a new connection and always releases that
// connection back to the pool at the end, regardless of any errors that may have
// occurred". You do not need to worry about acquiring or releasing connections
// yourself.
//
// Usage:
//
//   const redis = require('./redis')
//
//   redis.get(key)
//     .then(value => {
//       // :)
//     })
//     .catch(error => {
//       // :(
//     })
//
//   redis.set(key, value)
//     .then(() => {
//       // :)
//     })
//     .catch(error => {
//       // :(
//     })
//
//   redis.del(key)
//     .then(() => {
//       // :)
//     })
//     .catch(error => {
//       // :(
//     })
//
//   redis.update(key, value => updatedValue)
//     .then(value => {
//       // :)
//     })
//     .catch(error => {
//       // :(
//     })

'use strict'

const P = require('../promise')

const REDIS_COMMANDS = [ 'get', 'set', 'del', 'update' ]

module.exports = (config, log) => {
  if (! config.enabled) {
    log.info({ op: 'redis.disabled' })
    return
  }

  log.info({ op: 'redis.enabled', config })

  const pool = require('./pool')(config, log)

  return REDIS_COMMANDS.reduce((result, name) => {
    result[name] = (...args) => P.using(pool.acquire(), connection => connection[name](...args))
    return result
  }, {})
}


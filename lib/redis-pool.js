/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const genericPool = require('generic-pool')
const P = require('./promise')
const redis = require('redis')
const redisConnection = require('./redis-connection')

P.promisifyAll(redis.RedisClient.prototype)
P.promisifyAll(redis.Multi.prototype)

module.exports = (config, log) => {
  if (! config.redis.enabled) {
    log.info({ op: 'redis.disabled' })
    return
  }

  const redisConfig = {
    host: config.redis.host,
    port: config.redis.port,
    prefix: config.redis.sessionsKeyPrefix,
    // Prefer redis to fail fast than wait indefinitely for reconnection
    enable_offline_queue: false
  }

  log.info({ op: 'redis.enabled', config: redisConfig })

  const redisFactory = {
    create () {
      return new P(resolve => {
        const client = redis.createClient(redisConfig)
        client.on('ready', () => resolve(redisConnection(log, client)))
        client.on('error', err => log.error({
          op: 'redis.error',
          err: err.message,
          stack: err.stack
        }))
      })
    },

    destroy (client) {
      return new P(resolve => {
        client.quit()
        client.on('end', resolve)
      })
    }
  }

  return genericPool.createPool(redisFactory, {
    max: config.redis.maxConnections,
    // Always keep at least two connections, one for simple reads/writes
    // and the other for update operations
    min: 2,
    maxWaitingClients: config.redis.maxPending,
    acquireTimeoutMillis: config.redis.timeout,
    autostart: true,
    Promise: P
  })
}


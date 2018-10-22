/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const {URL} = require('url')
const AppError = require('../error');
const error = require('../error')
const isA = require('joi')
const ScopeSet = require('fxa-shared').oauth.scopes

// Assign a default TTL for well-known commands if a request didn't specify it.
const DEFAULT_COMMAND_TTL = new Map([
  ['https://identity.mozilla.com/cmd/open-uri', 30 * 24 * 3600], // 30 days
])

module.exports = (log, db, config, customs, clients, pushbox, push) => {
  const routes = [
    {
      method: 'GET',
      path: '/clients_instances',
      options: {
        auth: {
          strategies: [
            'sessionToken',
            'oauthToken'
          ]
        },
        response: {
          schema: isA.array().items(isA.object({
            id: isA.string().required(),
            clientId: isA.string().required(),
            name: isA.string().required().allow(null),
            pushEndpoint: isA.string().required().allow(null),
            pushPublicKey: isA.string().required().allow(null),
            pushAuthKey: isA.string().required().allow(null),
            availableCommands: isA.object().required(),
          }))
        }
      },
      async handler(request) {
        log.begin('ClientsInstances', request)
        if (request.auth.strategy === 'oauthToken' &&
            ! ScopeSet.fromArray(request.auth.credentials.scope).contains('clients:read')) {
          throw AppError.invalidToken('Invalid token scope');
        }
        const {uid, clientAddress: ip} = request.app
        await customs.checkAuthenticated('clientsInstances', ip, uid)
        const clientInstances = await clients.getClientsInstances(uid)
        const devicesInstances = await getDevicesAsClientInstances(uid)
        return [...clientInstances, ...devicesInstances]
      }
    },
    {
      method: 'GET',
      path: '/client_instance',
      options: {
        auth: {
          strategy: 'refreshToken'
        },
        response: {
          schema: isA.object({
            id: isA.string().required(),
            clientId: isA.string().required(),
            name: isA.string().required().allow(null),
            pushEndpoint: isA.string().required().allow(null),
            pushPublicKey: isA.string().required().allow(null),
            pushAuthKey: isA.string().required().allow(null),
            availableCommands: isA.object().required(),
          })
        }
      },
      async handler(request) {
        log.begin('ClientInstance', request)
        const {uid, clientAddress: ip} = request.app
        await customs.checkAuthenticated('clientInstance', ip, uid)
        const {instance_id: instanceId, client_id: clientId} = request.auth.credentials
        return clientInstance(uid, instanceId, clientId)
      }
    },
    {
      // TODO: In the doc, make sure to say that a null value means "clear that metadata field".
      // Undefined will be filtered.
      method: 'POST',
      path: '/client_instance',
      options: {
        auth: {
          strategy: 'refreshToken'
        },
        validate: {
          // TODO: better validation.
          payload: isA.object({
            name: isA.string().optional().allow(null),
            pushEndpoint: isA.string().optional().allow(null),
            pushPublicKey: isA.string().optional().allow(null),
            pushAuthKey: isA.string().optional().allow(null),
            availableCommands: isA.object().optional().allow(null),
          })
          .or('name', 'type', 'pushEndpoint', 'pushPublicKey', 'pushAuthKey', 'availableCommands')
          .and('pushPublicKey', 'pushAuthKey')
        },
        response: {
          schema: isA.object({
            id: isA.string().required(),
            clientId: isA.string().required(),
            name: isA.string().required().allow(null),
            pushEndpoint: isA.string().required().allow(null),
            pushPublicKey: isA.string().required().allow(null),
            pushAuthKey: isA.string().required().allow(null),
            availableCommands: isA.object().required(),
          })
        }
      },
      async handler(request) {
        log.begin('ClientInstance.upsert', request)
        const {uid, clientAddress: ip} = request.app
        await customs.checkAuthenticated('upsertClientInstance', ip, uid)
        const {instance_id: instanceId, client_id: clientId} = request.auth.credentials
        const existingMetadata = await clientInstance(uid, instanceId, clientId)
        const toUpdateMetadata = filterUndefinedValues(request.payload)
        const metadata = {
          ...existingMetadata,
          ...toUpdateMetadata,
        }
        await db.upsertClientInstance(uid, instanceId, clientId, metadata)
        return metadata
      }
    },
    {
      method: 'DELETE',
      path: '/client_instance',
      options: {
        auth: {
          strategy: 'refreshToken'
        }
      },
      async handler(request) {
        log.begin('ClientInstance.delete', request)
        const {uid} = request.app
        const {instance_id: instanceId} = request.auth.credentials
        await db.deleteClientInstance(uid, instanceId)
        return {}
      }
    },
    {
      method: 'PATCH',
      path: '/client_instance/commands',
      options: {
        auth: {
          strategy: 'refreshToken'
        },
        validate: {
          // TODO doc: Format should be https://tools.ietf.org/html/rfc7396 - AKA NULL equals delete
          payload: isA.object().required() // TODO better validation
        },
        response: {
          schema: isA.object({
            id: isA.string().required(),
            clientId: isA.string().required(),
            name: isA.string().required().allow(null),
            pushEndpoint: isA.string().required().allow(null),
            pushPublicKey: isA.string().required().allow(null),
            pushAuthKey: isA.string().required().allow(null),
            availableCommands: isA.object().required(),
          })
        }
      },
      async handler(request) {
        log.begin('ClientInstance.patchCommands', request)
        const {uid, clientAddress: ip} = request.app
        await customs.checkAuthenticated('patchClientInstanceCommands', ip, uid)
        const {instance_id: instanceId, client_id: clientId} = request.auth.credentials
        const instance = await clientInstance(uid, instanceId, clientId)
        for (const [command, value] of Object.entries(request.payload)) {
          if (value !== null) {
            instance.availableCommands[command] = value
          } else {
            delete instance.availableCommands[command]
          }
        }
        await db.upsertClientInstance(uid, instanceId, clientId, instance)
        return instance
      }
    },
    {
      method: 'GET',
      path: '/client_instance/pending_commands',
      options: {
        validate: {
          query: {
            index: isA.number().optional(),
            limit: isA.number().optional().min(0).max(100).default(100),
          }
        },
        auth: {
          strategy: 'refreshToken'
        },
        response: {
          schema: isA.object({
            index: isA.number().required(),
            last: isA.boolean().optional(),
            messages: isA.array().items(isA.object({
              index: isA.number().required(),
              data: isA.object({
                command: isA.string().max(255).required(),
                payload: isA.object().required(),
                sender: isA.string().optional() /*TODO: factorize instanceID schema*/
              }).required()
            })).optional()
          }).and('last', 'messages')
        }
      },
      async handler(request) {
        log.begin('ClientInstance.pendingCommands', request)
        const {uid, clientAddress: ip} = request.app
        await customs.checkAuthenticated('fetchPendingCommands', ip, uid)
        const {instance_id: instanceId} = request.auth.credentials
        const {index, limit} = request.query || {}
        const response = await pushbox.retrieve(uid, instanceId, limit, index)
        log.info({op: 'commands.fetch', response})
        return response;
      }
    },
    {
      method: 'POST',
      path: '/clients_instances/invoke_command',
      options: {
        auth: {
          strategy: 'oauthToken'
        },
        validate: {
          payload: {
            target: isA.string().required(), /*TODO: factorize instanceID schema*/
            command: isA.string().required(),
            payload: isA.object().required(),
            ttl: isA.number().integer().min(0).max(10000000).optional()
          }
        },
        response: {
          schema: {}
        }
      },
      async handler(request) {
        log.begin('ClientsInstances.invokeCommand', request)
        if (! ScopeSet.fromArray(request.auth.credentials.scope).contains('commands:write')) {
          throw AppError.invalidToken('Invalid token scope');
        }

        const {target: targetId, command, payload} = request.payload
        let {ttl} = request.payload
        const {uid, clientAddress: ip} = request.app
        await customs.checkAuthenticated('invokeClientCommand', ip, uid)
        const {instance_id: sender} = request.auth.credentials
        const target = await clients.findClientInstanceOrDevice(uid, targetId)
        const targetIsADevice = target.hasOwnProperty('type')
        if (! target.availableCommands.hasOwnProperty(command)) {
          throw error.unavailableDeviceCommand()
        }
        // 0 is perfectly acceptable TTL, hence the strict equality check.
        if (ttl === undefined && DEFAULT_COMMAND_TTL.has(command)) {
          ttl = DEFAULT_COMMAND_TTL.get(command);
        }
        const data = {
          command,
          payload,
          sender,
        }
        const {index} = await pushbox.store(uid, targetId, data, ttl)
        const path = targetIsADevice ? 'v1/account/device/commands' : 'v1/client_instance/pending_commands'
        const url = new URL(path, config.publicUrl)
        url.searchParams.set('index', index)
        url.searchParams.set('limit', 1)
        await push.notifyCommandReceived(uid, target, command, sender, index, url.href, ttl)
        return {};
      }
    },
  ]

  // Never returns null compared to calling `db.clientInstance`
  // directly.
  async function clientInstance(uid, instanceId, clientId) {
    let metadata = await db.clientInstance(uid, instanceId)
    if (! metadata) {
      metadata = {
        id: instanceId,
        clientId,
        name: null,
        pushEndpoint: null,
        pushPublicKey: null,
        pushAuthKey: null,
        availableCommands: {},
      }
    }
    return metadata
  }

  async function getDevicesAsClientInstances(uid) {
    const sessions = await db.sessions(uid);
    return sessions.filter(({deviceId}) => !! deviceId).map(deviceSession => {
      const clientId = getClientIdForSession(deviceSession)
      return {
        id: deviceSession.deviceId,
        clientId,
        name: deviceSession.deviceName,
        pushEndpoint: deviceSession.deviceCallbackURL,
        pushPublicKey: deviceSession.deviceCallbackPublicKey,
        pushAuthKey: deviceSession.deviceCallbackAuthKey,
        availableCommands: deviceSession.deviceAvailableCommands,
      }
    });
  }

  return routes
}

const LEGACY_CLIENTS_CLIENT_IDS = {
  'android': '3332a18d142636cb',
  'ios': '1b1a3e44c54fbb58',
  'desktop': '5882386c6d801776',
}

function getClientIdForSession({uaOS}) {
  if (uaOS.includes('iOS') || uaOS.includes('iPad')) {
    return LEGACY_CLIENTS_CLIENT_IDS['ios']
  } else if (uaOS.includes('Android')) {
    return LEGACY_CLIENTS_CLIENT_IDS['android']
  } else {
    return LEGACY_CLIENTS_CLIENT_IDS['desktop']
  }
}

function filterUndefinedValues(obj) {
  obj = {...obj}; // Shallow copy of the original object.
  Object.keys(obj).forEach(key => {
    if (obj[key] === undefined) {
      delete obj[key]
    }
  })
  return obj
}

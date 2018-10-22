/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const sinon = require('sinon')
const assert = { ...sinon.assert, ...require('chai').assert }
const getRoute = require('../../routes_helpers').getRoute
const error = require('../../../lib/error')
const mocks = require('../../mocks')
const isA = require('joi')

const UID = 'myuid'
const INSTANCE_ID = 'instanceId'
const CLIENT_ID = 'clientId'

let log, db, config, customs, routes, route, request, clients, pushbox, push

function runTest(routePath, requestOptions, method = null) {
  routes = require('../../../lib/routes/clients-instances')(log, db, config, customs, clients, pushbox, push)
  route = getRoute(routes, routePath, method)
  request = mocks.mockRequest(requestOptions)
  return route.handler(request)
}

const sessions = [
  {
    deviceId: 'mydevice1',
    deviceName: 'Firefox for iOS',
    deviceCallbackURL: 'deviceCallbackURL',
    deviceCallbackPublicKey: 'deviceCallbackPublicKey',
    deviceCallbackAuthKey: 'deviceCallbackAuthKey',
    deviceAvailableCommands: {'foo': 'bar'},
    uaOS: 'iPad'
  },
  {
    // Not a device.
    name: 'Web Session',
  }
]

const clientsInstances = [
  {
    id: 'instance1',
    clientId: 'oneclientid',
    name: 'First',
    pushEndpoint: null,
    pushPublicKey: null,
    pushAuthKey: null,
    availableCommands: {},
  },
  {
    id: 'instance2',
    clientId: 'anotherclientid',
    name: 'Second',
    pushEndpoint: null,
    pushPublicKey: null,
    pushAuthKey: null,
    availableCommands: {'bogusCommandName': 'oh', 'https://identity.mozilla.com/cmd/open-uri': 'heh'},
  },
  {
    id: INSTANCE_ID,
    clientId: CLIENT_ID,
    name: 'My own instance',
    pushEndpoint: 'https://foo.bar',
    pushPublicKey: null,
    pushAuthKey: null,
    availableCommands: {'foo': 'bar', 'mycmd': 'myval'},
  },
]

describe('clients instances', () => {

  beforeEach(() => {
    log = mocks.mockLog()
    db = mocks.mockDB({sessions, clientsInstances})
    config = {publicUrl: 'https://public.url'}
    customs = mocks.mockCustoms()
    clients = mocks.mockClients({
      getClientsInstances: sinon.spy(async () => clientsInstances),
      findClientInstanceOrDevice: sinon.spy(async (uid, id) => clientsInstances.find((i => i.id === id)))
    })
    pushbox = mocks.mockPushbox()
    push = mocks.mockPush()
  })

  describe('/clients_instances', () => {
    it('lists clients instances and devices', async () => {
      const res = await runTest('/clients_instances', {
        credentials: {
          uid: UID,
          instance_id: INSTANCE_ID,
          client_id: CLIENT_ID
        }
      })
      assert.deepEqual(res, [...clientsInstances, {
        id: 'mydevice1',
        name: 'Firefox for iOS',
        clientId: '1b1a3e44c54fbb58', // Infered from uaOS.
        pushEndpoint: 'deviceCallbackURL',
        pushPublicKey: 'deviceCallbackPublicKey',
        pushAuthKey: 'deviceCallbackAuthKey',
        availableCommands: {'foo': 'bar'},
      }])
    })
  })

  describe('GET /client_instance', () => {
    it('lists own client metadata', async () => {
      const res = await runTest('/client_instance', {
        credentials: {
          uid: UID,
          instance_id: INSTANCE_ID,
          client_id: CLIENT_ID
        }
      }, 'GET')
      assert.deepEqual(res, {
        id: INSTANCE_ID,
        name: 'My own instance',
        clientId: CLIENT_ID,
        pushEndpoint: 'https://foo.bar',
        pushPublicKey: null,
        pushAuthKey: null,
        availableCommands: {foo: 'bar', mycmd: 'myval'},
      })
    })

    it('returns default metadata if we do not have it', async () => {
      const instanceId = 'unknowninstanceid'
      const res = await runTest('/client_instance', {
        credentials: {
          uid: UID,
          instance_id: instanceId,
          client_id: CLIENT_ID
        }
      }, 'GET')
      assert.deepEqual(res, {
        id: instanceId,
        name: null,
        clientId: CLIENT_ID,
        pushEndpoint: null,
        pushPublicKey: null,
        pushAuthKey: null,
        availableCommands: {},
      })
    })
  })

  describe('POST /client_instance', () => {
    it('updates own metadata', async () => {
      const payload = {
        name: 'New name',
        pushEndpoint: null,
      }
      const res = await runTest('/client_instance', {
        credentials: {
          uid: UID,
          instance_id: INSTANCE_ID,
          client_id: CLIENT_ID
        },
        payload,
      }, 'POST')
      assert.deepEqual(res, {
        id: INSTANCE_ID,
        name: 'New name',
        clientId: CLIENT_ID,
        pushEndpoint: null, // Reset because null
        pushPublicKey: null,
        pushAuthKey: null,
        availableCommands: {'mycmd': 'myval', 'foo': 'bar'}, // Unchanged
      })
    })

    it('creates own metadata if does not exist', async () => {
      const instanceId = 'unknowninstanceid'
      const payload = {
        name: 'My name',
      }
      const res = await runTest('/client_instance', {
        credentials: {
          uid: UID,
          instance_id: instanceId,
          client_id: CLIENT_ID
        },
        payload,
      }, 'POST')
      assert.deepEqual(res, {
        id: instanceId,
        name: 'My name',
        clientId: CLIENT_ID,
        pushEndpoint: null,
        pushPublicKey: null,
        pushAuthKey: null,
        availableCommands: {}
      })
    })
  })

  describe('PATCH /client_instance/commands', () => {
    it('modifies registered commands', async () => {
      const payload = {
        'foo': 'baz', // Modify an existing command.
        'foo2': 'bar2', // Add a existing command.
        'mycmd': null, // Delete an existing command.
        'unknown': null, // Delete an unknown command.
      }
      const res = await runTest('/client_instance/commands', {
        credentials: {
          uid: UID,
          instance_id: INSTANCE_ID,
          client_id: CLIENT_ID
        },
        payload,
      }, 'PATCH')
      assert.deepEqual(res, {
        id: INSTANCE_ID,
        name: 'My own instance',
        clientId: CLIENT_ID,
        pushEndpoint: 'https://foo.bar',
        pushPublicKey: null,
        pushAuthKey: null,
        availableCommands: {
          'foo': 'baz',
          'foo2': 'bar2'
        }
      })
    })
  })

  describe('/client_instance/pending_commands', function () {
    it('retrieves messages using the pushbox service', async () => {
      const mockResponse = {
        last: true,
        index: 4,
        messages: [
          { index: 3, data: { number: 'three' } },
          { index: 4, data: { number: 'four'} }
        ]
      }
      pushbox = mocks.mockPushbox({
        retrieve: sinon.spy(async () => mockResponse)
      })

      let query = {index: 2}
      // validate() populates the limit default (100).
      query = isA.validate(query, getRoute(routes, '/client_instance/pending_commands', 'GET').options.validate.query).value
      const response = await runTest('/client_instance/pending_commands', {
        credentials: {
          uid: UID,
          instance_id: INSTANCE_ID,
          client_id: CLIENT_ID
        },
        query
      })
      assert.equal(pushbox.retrieve.callCount, 1, 'pushbox was called')
      assert.calledWithExactly(pushbox.retrieve, UID, INSTANCE_ID, 100, 2)
      assert.deepEqual(response, mockResponse)
    })

    it('accepts a custom limit parameter', async () => {
      await runTest('/client_instance/pending_commands', {
        credentials: {
          uid: UID,
          instance_id: INSTANCE_ID,
          client_id: CLIENT_ID
        },
        query: {
          index: 2,
          limit: 12
        }
      })
      assert.equal(pushbox.retrieve.callCount, 1, 'pushbox was called')
      assert.calledWithExactly(pushbox.retrieve, UID, INSTANCE_ID, 12, 2)
    })

    it('relays errors from the pushbox service', async () => {
      pushbox = mocks.mockPushbox({
        retrieve() {
          const error = new Error()
          error.message = 'Boom!'
          error.statusCode = 500
          return Promise.reject(error)
        }
      })
      try {
        await runTest('/client_instance/pending_commands', {
          credentials: {
            uid: UID,
            instance_id: INSTANCE_ID,
            client_id: CLIENT_ID
          },
          query: {
            index: 2
          }
        })
        assert(false, 'should have thrown')
      } catch (err) {
        assert.equal(err.message, 'Boom!')
        assert.equal(err.statusCode, 500)
      }
    })
  })

  describe('/clients_instances/invoke_command', () => {
    it('stores commands using the pushbox service and sends a notification', async () => {
      const command = 'bogusCommandName'
      pushbox = mocks.mockPushbox({
        store: sinon.spy(async () => ({ index: 15 }))
      })
      const target = 'instance2'
      const sender = INSTANCE_ID
      const payload = { 'bogus': 'payload' }
      const requestPayload = {
        target,
        command,
        payload
      }

      await runTest('/clients_instances/invoke_command', {
        credentials: {
          uid: UID,
          instance_id: INSTANCE_ID,
          client_id: CLIENT_ID,
          scope: ['commands:write']
        },
        payload: requestPayload
      })

      assert.equal(clients.findClientInstanceOrDevice.callCount, 1, 'client instance was fetched')
      assert.calledWithExactly(clients.findClientInstanceOrDevice, UID, target)

      assert.equal(pushbox.store.callCount, 1, 'pushbox was called')
      assert.calledWithExactly(pushbox.store, UID, target, {
        command,
        payload,
        sender,
      }, undefined)

      assert.equal(push.notifyCommandReceived.callCount, 1, 'notifyCommandReceived was called')
      assert.calledWithExactly(push.notifyCommandReceived,
        UID,
        clientsInstances[1],
        command,
        sender,
        15,
        'https://public.url/v1/client_instance/pending_commands?index=15&limit=1',
        undefined
      )
    })

    it('sends back a different URL if the target is a device', async () => {
      const command = 'bogusCommandName'
      pushbox = mocks.mockPushbox({
        store: sinon.spy(async () => ({ index: 15 }))
      })
      const target = 'deviceid1'
      const sender = INSTANCE_ID
      const payload = { 'bogus': 'payload' }
      const requestPayload = {
        target,
        command,
        payload
      }
      const device = {
        id: 'deviceid1',
        name: 'Firefox Desktop',
        type: 'mobile',
        pushCallback: 'https://foo.bar',
        availableCommands: {
          [command]: 'bar'
        }
      }
      clients = mocks.mockClients({
        findClientInstanceOrDevice: sinon.spy(async (uid, id) => device)
      })

      await runTest('/clients_instances/invoke_command', {
        credentials: {
          uid: UID,
          instance_id: INSTANCE_ID,
          client_id: CLIENT_ID,
          scope: ['commands:write']
        },
        payload: requestPayload
      })

      assert.equal(clients.findClientInstanceOrDevice.callCount, 1, 'client instance was fetched')
      assert.calledWithExactly(clients.findClientInstanceOrDevice, UID, target)

      assert.equal(pushbox.store.callCount, 1, 'pushbox was called')
      assert.calledWithExactly(pushbox.store, UID, target, {
        command,
        payload,
        sender,
      }, undefined)

      assert.equal(push.notifyCommandReceived.callCount, 1, 'notifyCommandReceived was called')
      assert.calledWithExactly(push.notifyCommandReceived,
        UID,
        device,
        command,
        sender,
        15,
        'https://public.url/v1/account/device/commands?index=15&limit=1',
        undefined
      )
    })

    it('uses a default TTL for send-tab commands with no TTL specified', async () => {
      const THIRTY_DAYS_IN_SECS = 30 * 24 * 3600;
      const command = 'https://identity.mozilla.com/cmd/open-uri'
      pushbox = mocks.mockPushbox({
        store: sinon.spy(async () => ({ index: 15 }))
      })
      const target = 'instance2'
      const sender = INSTANCE_ID
      const payload = { 'bogus': 'payload' }
      const requestPayload = {
        target,
        command,
        payload
      }

      await runTest('/clients_instances/invoke_command', {
        credentials: {
          uid: UID,
          instance_id: INSTANCE_ID,
          client_id: CLIENT_ID,
          scope: ['commands:write']
        },
        payload: requestPayload
      })

      assert.equal(clients.findClientInstanceOrDevice.callCount, 1, 'client instance was fetched')
      assert.calledWithExactly(clients.findClientInstanceOrDevice, UID, target)

      assert.equal(pushbox.store.callCount, 1, 'pushbox was called')
      assert.calledWithExactly(pushbox.store, UID, target, {
        command,
        payload,
        sender,
      }, THIRTY_DAYS_IN_SECS)

      assert.equal(push.notifyCommandReceived.callCount, 1, 'notifyCommandReceived was called')
      assert.calledWithExactly(push.notifyCommandReceived,
        UID,
        clientsInstances[1],
        command,
        sender,
        15,
        'https://public.url/v1/client_instance/pending_commands?index=15&limit=1',
        THIRTY_DAYS_IN_SECS
      )
    })

    it('rejects if sending to an unknown device', async () => {
      const target = 'unknowndevice'
      const payload = { 'bogus': 'payload' }
      const requestPayload = {
        target,
        command: 'nonexistentCommandName',
        payload
      }
      clients.findClientInstanceOrDevice = sinon.spy(async () => {throw error.unknownDevice()})

      try {
        await runTest('/clients_instances/invoke_command', {
          credentials: {
            uid: UID,
            instance_id: INSTANCE_ID,
            client_id: CLIENT_ID,
            scope: ['commands:write']
          },
          payload: requestPayload
        })
        assert(false, 'should have thrown')
      } catch (err) {
        assert.equal(err.errno, 123, 'Unknown device')
        assert.equal(pushbox.store.callCount, 0, 'pushbox was not called')
        assert.equal(push.notifyCommandReceived.callCount, 0, 'notifyMessageReceived was not called')
      }
    })

    it('relays errors from the pushbox service', async () => {
      const command = 'bogusCommandName'
      pushbox = mocks.mockPushbox({
        store: sinon.spy(() => {
          const error = new Error()
          error.message = 'Boom!'
          error.statusCode = 500
          return Promise.reject(error)
        })
      })
      const target = 'instance2'
      const payload = { 'bogus': 'payload' }
      const requestPayload = {
        target,
        command,
        payload
      }

      try {
        await runTest('/clients_instances/invoke_command', {
          credentials: {
            uid: UID,
            instance_id: INSTANCE_ID,
            client_id: CLIENT_ID,
            scope: ['commands:write']
          },
          payload: requestPayload
        })
        assert(false, 'should have thrown')
      } catch (err) {
        assert.equal(pushbox.store.callCount, 1, 'pushbox was called')
        assert.equal(err.message, 'Boom!')
        assert.equal(err.statusCode, 500)
        assert.equal(push.notifyCommandReceived.callCount, 0,
          'notifyMessageReceived was not called')
      }
    })
  })
})

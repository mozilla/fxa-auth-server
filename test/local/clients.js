/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const { assert } = require('chai')
const crypto = require('crypto')
const mocks = require('../mocks')
const proxyquire = require('proxyquire')
const sinon = require('sinon')

const MODULE_PATH = '../../lib/clients'

describe('lib/clients:', () => {
  it('should export the correct interface', () => {
    assert.equal(typeof require(MODULE_PATH), 'function')
    assert.equal(require(MODULE_PATH).length, 3)
  })

  describe('instantiate:', () => {
    const clientId = crypto.randomBytes(8).toString('hex')
    const instance1 = crypto.randomBytes(16).toString('hex')
    const instance2 = crypto.randomBytes(16).toString('hex')
    const instance3 = crypto.randomBytes(16).toString('hex')
    const refreshTokens = [{
      token: crypto.randomBytes(32).toString('hex'),
      clientId,
      instanceId: instance1,
    }, { // Duplicate token w/ same instance id.
      token: crypto.randomBytes(32).toString('hex'),
      clientId,
      instanceId: instance1,
    }, {
      token: crypto.randomBytes(32).toString('hex'),
      clientId,
      instanceId: instance2, // Known only from the OAuth server.
    }]
    const clientsInstances = [{
      id: instance1,
      clientId,
      name: 'Lockbox',
      pushEndpoint: 'https://foo.bar',
      pushPublicKey: null,
      pushAuthKey: null,
      availableCommands: {},
    }, {
      id: instance3,
      clientId,
      name: 'Immaclient',
      pushEndpoint: null,
      pushPublicKey: null,
      pushAuthKey: null,
      availableCommands: {},
    }]
    const devices = [{
      id: crypto.randomBytes(16).toString('hex'),
    }, {
      id: instance3, // Hu oh, that's the same ID as an actual client instance!
      name: 'Immadevice',
    }]
    const config = {oauth: {url: 'http://foo.bar', sharedSecretKey: 'secretkey'}}
    function MockPool() {}
    MockPool.prototype.get = sinon.spy(() => refreshTokens)
    let log, db, clients
    beforeEach(() => {
      log = mocks.mockLog()
      db = mocks.mockDB({
        clientsInstances,
        devices
      })
      clients = proxyquire(MODULE_PATH, {
        './pool': MockPool
      })(log, db, config)
    })

    it('returns the expected interface', () => {
      assert.equal(typeof clients, 'object')
      assert.equal(Object.keys(clients).length, 4)

      assert.equal(typeof clients.getClientsInstances, 'function')
      assert.equal(clients.getClientsInstances.length, 1)

      assert.equal(typeof clients.findDeviceOrClientInstance, 'function')
      assert.equal(clients.findDeviceOrClientInstance.length, 2)

      assert.equal(typeof clients.findClientInstanceOrDevice, 'function')
      assert.equal(clients.findClientInstanceOrDevice.length, 2)

      assert.equal(typeof clients.accountPushClientsAndDevices, 'function')
      assert.equal(clients.accountPushClientsAndDevices.length, 1)
    })

    describe('getClientsInstances', () => {
      it('combines refresh tokens and known clients instances metadata', () => {
        return clients.getClientsInstances('myuid').then(instances => {
          assert.deepEqual(instances, [{
            id: instance1,
            clientId,
            name: 'Lockbox',
            pushEndpoint: 'https://foo.bar',
            pushPublicKey: null,
            pushAuthKey: null,
            availableCommands: {},
          }, {
            // Default empty instance metadata since the Auth server doesn't have stored metadata.
            id: instance2,
            clientId,
            name: null,
            pushAuthKey: null,
            pushEndpoint: null,
            pushPublicKey: null,
            availableCommands: {}
          }])
        })
      })
    })

    describe('findDeviceOrClientInstance', () => {
      it('finds a device', () => {
        return clients.findDeviceOrClientInstance('myuid', devices[0].id).then(device => {
          assert.equal(device.id, devices[0].id)
        })
      })

      it('finds a client instance if device cannot be found', () => {
        return clients.findDeviceOrClientInstance('myuid', instance1.toString('hex')).then(i => {
          assert.equal(i.id, clientsInstances[0].id)
        })
      })

      it('prioritizes the device if there is a client instance with the same id', () => {
        return clients.findDeviceOrClientInstance('myuid', instance3.toString('hex')).then(device => {
          assert.equal(device.id, devices[1].id)
          assert.equal(device.name, 'Immadevice')
        })
      })

      it('throws if we cannot find a device or a client instance', () => {
        return clients.findDeviceOrClientInstance('myuid', 'unknownid').then(() => {
          assert.ok(false, 'should not happen')
        }, (err) => {
          assert.equal(err.errno, 123)
        })
      })
    })

    describe('findClientInstanceOrDevice', () => {
      it('finds a client instance', () => {
        return clients.findClientInstanceOrDevice('myuid', instance1.toString('hex')).then(i => {
          assert.equal(i.id, clientsInstances[0].id)
        })
      })

      it('finds a device if the client instance cannot be found', () => {
        return clients.findClientInstanceOrDevice('myuid', devices[0].id).then(device => {
          assert.equal(device.id, devices[0].id)
        })
      })

      it('prioritizes the client instance if there is a device with the same id', () => {
        return clients.findClientInstanceOrDevice('myuid', instance3.toString('hex')).then(i => {
          assert.equal(i.id, clientsInstances[1].id)
          assert.equal(i.name, 'Immaclient')
        })
      })

      it('throws if we cannot find a device or a client instance', () => {
        return clients.findClientInstanceOrDevice('myuid', 'unknownid').then(() => {
          assert.ok(false, 'should not happen')
        }, (err) => {
          assert.equal(err.errno, 123)
        })
      })
    })
  })
})

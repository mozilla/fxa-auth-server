/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * How a signup process is made through the API
 *
 * Do not use in production, only as a "as simple as it gets"
 * create account use-case using the fxa-auth-server API.
 *
 * After running
 *
 *     nodejs signup.js
 *
 * You should get a new user with matching `email` and `password`.
 */

    /**
     * Some random email address
     *
     * @type {String} User-entered email, anything goes
     */
var email = 'më@example.com',

    /**
     * Some random password
     *
     * @type {String} User-entered password
     */
    password = 'verySecurePassword',

    /**
     * fxa-auth-server listen IP and port
     *
     * Make sure it matches the same configuration
     * otherwise the hashing validation will fail with
     * "Bad mac" error message.
     *
     * See config/config.js in listen section.
     *
     * @type {String} FXA Auth server HTTP endpoint to make calls against
     */
    instanceEndpoint = 'http://127.0.0.1:9000',

    /**
     * Options object
     */
    options = { preVerified: true };


/** Magic happens here **/
    /**
     * Basic requirements
     */
var fs = require('fs'),

    /**
     * Read the public key we generate anyway (no need to hardcode).
     */
    publicKey = JSON.parse(fs.readFileSync('../config/public-key.json')),

    /**
     * Client API
     */
    Client = require('../client'),
    duration = 1000 * 60 * 60 * 24,
    client = null;

Client.create(instanceEndpoint, email, password, options)
  .then(
    function (x) {
      client = x
      return client.keys()
    }
  )
  .then(
    function (keys) {
      console.log('my kA:', keys.kA.toString('hex'))
      console.log('my kB:', keys.kB.toString('hex'))
      console.log('my wrapKb:', keys.wrapKb.toString('hex'))
    }
  )
  .then(
    function () {
      return client.sign(publicKey, duration)
    }
  )
  .then(
    function (cert) {
      console.log('my cert:', cert)
      return 'done'
    }
  )
  .done(console.log, console.error)


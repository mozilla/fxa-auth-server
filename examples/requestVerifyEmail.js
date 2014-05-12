/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * How to know if current user has confirmed his email
 *
 * Sample API call against auth server. Provided a successful
 * call, we are handed a instance of Client described in
 * fxa-js-client.
 */

    /**
     * User to test against email address
     *
     * @type {String} User-entered email, anything goes
     */
var email = 'më@example.com',

    /**
     * User to test against password
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
    instanceEndpoint = 'http://127.0.0.1:9000';


/** Magic happens here **/

var  Client = require('../client');

Client.login(instanceEndpoint, email, password)
  .then(
    function (clientInstance) {
      return clientInstance;
    }
  )
  .then(
    function (clientInstance) {
      clientInstance.requestVerifyEmail();

      return clientInstance;
    }
  )
  .done(console.log)

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * How to validate a user password
 *
 * Sample API call against auth server. Provided a successful
 * call, we are handed a instance of Client described in
 * fxa-js-client.
 *
 * After this call, you should be able to know whether the
 * login was successful, and what data would be kept in a Session
 * object.
 */

    /**
     * New user email address
     *
     * @type {String} User-entered email, anything goes
     */
var email = 'më@example.com',

    /**
     * New user password
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

var Client = require('../client');

Client.login(instanceEndpoint, email, password)
  .then(
    function (accountData) {
        // See: fxa-js-client at signIn function
        var updatedSessionData = {
          email: accountData.email,
          uid: accountData.uid,
          unwrapBKey: accountData.unwrapBKey,
          keyFetchToken: accountData.keyFetchToken,
          sessionToken: accountData.sessionToken
        };

        console.log('Login successful, web app would create a session using:', updatedSessionData);
    }
  )
  .fail(
    function(x){
        console.log('Login failed, message: ', x.message || x);
    }
  )
  .done()
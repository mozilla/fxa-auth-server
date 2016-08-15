/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var userAgent = require('./userAgent')

module.exports = function (config, log, db) {

  return {
    evalulateRequest: function (uid, request) {

      return db.securityEvents(uid)
        .then(function (events) {

          var response = {}

          // Check to see if ip address has been previously seen
          var seenIpAddress = events.some(function (event) {
            if (request.app.clientAddress === event.ipAddr) {
              return true
            }
          })
          response.seenIpAddress = seenIpAddress

          // To to see if this agent has been previously seen
          // Do a simple string compare on the agent
          var seenAgent = events.some(function (event) {
            if (request.headers['user-agent'] === event.userAgent) {
              return true
            }
          })
          response.seenAgent = seenAgent

          // Consider using userAgent obj to parse into individual components
          // Maybe be useful to have weighted values for matching different components of the user agent
          // verses just matching string


          // Currently, profiler will give a recommendation based on the
          // &'ed values
          response.isSuspicious = !(seenAgent && seenIpAddress)

          return response
        })
    }
  }
}

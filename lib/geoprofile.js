/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

module.exports = function (config, log, db, geodb) {

  var ACCEPT_RADIUS_KM = config.geoProfile.acceptRadius

  // Use the Haversine formula for calculating the distance between
  // two points on a sphere. Returns distance in km.
  // Based on https://rosettacode.org/wiki/Haversine_formula#JavaScript
  function getDistance(lat1, lon1, lat2, lon2) {
    // Convert to radians
    lat1 = lat1 / 180.0 * Math.PI
    lon1 = lon1 / 180.0 * Math.PI
    lat2 = lat2 / 180.0 * Math.PI
    lon2 = lon2 / 180.0 * Math.PI

    var R = 6372.8 // km
    var dLat = lat2 - lat1
    var dLon = lon2 - lon1
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2)
    var c = 2 * Math.asin(Math.sqrt(a))
    return R * c
  }

  return {
    evalulateRequest: function (uid, request) {

      var events
      var response = {}

      // Currently, only use login security history events for evaluating requests
      var searchOptions = {
        uid: uid,
        events: [
          'account.login'
        ]
      }
      return db.securityEvents(searchOptions)
        .then(function (securityEvents) {
          events = securityEvents

          // Check to see if ip address has been previously seen
          var seenIpAddress = events.some(function (event) {
            if (request.app.clientAddress === event.ipAddr) {
              return true
            }
          })
          response.seenIpAddress = seenIpAddress

          // Check to see if this agent has been previously seen
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

        })
        .then(function () {
          // Check if estimated user location has been seen before
          var ip = request.app.clientAddress

          return geodb(ip)
            .then(function (location) {
              var lat = location.latLong.latitude
              var lon = location.latLong.longitude

              // TODO Check city, Country?

              // Check to see if security event lat/lon exist with x radius of estimated location
              var seenArea = events.some(function (event) {
                var distance = getDistance(lat, lon, event.lat, event.lon)
                if (distance < ACCEPT_RADIUS_KM) {
                  return true
                }
              })

              // Could possible extend this to check if all accessed locations are within radius
              // Another case where a weighted value could possibly be used.

              response.seenArea = seenArea
            })
            .catch(function () {
              // Unable to get location data, mark as unseen area
              response.seenArea = false
            })
        })
        .then(function () {

          if (response.seenIpAddress) {
            response.isSuspicious = false
          } else if (!response.seenAgent) {
            response.isSuspicious = true
          } else if(response.seenArea){
            response.isSuspicious = false
          } else {
            response.isSuspicious = true
          }

          return response
        })
    }
  }
}

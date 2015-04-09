/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var path = require('path')
var fs = require('fs')
var util = require('util')
var child_process = require('child_process')
var httprequest = require('request')

var config = require('../config').root()
var version = require('../package.json').version
var commitHash
var dbVer;

module.exports = function (log, P, db, error) {

  var routes = [
    {
      method: 'GET',
      path: '/',
      handler: function index(request, reply) {
        log.begin('Defaults.root', request)

        function sendReply() {
          reply(
            {
              version: version,
              commit: commitHash,
              dbVer: dbVer
            }
          )
        }

        // Get the version from fxa-auth-db-mysql server
        function getDBVer() {
          var d = P.defer()
          httprequest.get({url: config.httpdb.url, json: true}, function (err, response, body) {
            if (err) {
              d.reject(err)
            } else if (response.statusCode === 200) {
              dbVer = response.body.version
              d.resolve()
            } else {
              // Just in case httpdb isn't sending plain 200, reject with explicit HTTP code
              d.reject(response.statusCode)
            }
          })
          return d.promise
        }
     
        function getCommitVer() {
          // Note: we figure out the Git hash in the following order:
          //
          // (1) read config/version.json if exists (ie. staging, production)
          // (2) figure it out from git (either regular '.git', or '/home/app/git' for AwsBox)

          var d = P.defer()
          // (1) read config/version.json if exists (ie. staging, production)
          var configFile = path.join(__dirname, '..', 'config', 'version.json')
          if ( fs.existsSync(configFile) ) {
            commitHash = require(configFile).version.hash
            d.resolve()
          }

          // (2) figure it out from git (either regular '.git', or '/home/app/git' for AwsBox)
          var gitDir
          if ( !fs.existsSync(path.join(__dirname, '..', '.git')) ) {
            // try at '/home/app/git' for AwsBox deploys
            gitDir = path.sep + path.join('home', 'app', 'git')
          }
          var cmd = util.format('git %s rev-parse HEAD', gitDir ? '--git-dir=' + gitDir : '')
          child_process.exec(cmd, function(err, stdout) {
              if (err) {
                d.reject(err)
              } else {
                commitHash = stdout.replace(/\s+/, '')
                d.resolve()  
              }
          })
          return d.promise
        }

        // collect version info via as many varying functions/methods as are needed
        // use .spread to ensure every promise is fulfilled before sending reply
        P.spread([getDBVer(), getCommitVer()], sendReply)

      }
    },
    {
      method: 'GET',
      path: '/__heartbeat__',
      handler: function heartbeat(request, reply) {
        log.begin('Defaults.heartbeat', request)
        db.ping()
          .done(
            function () {
              reply({})
            },
            function (err) {
              log.error({ op: 'heartbeat', err: err })
              reply(error.serviceUnavailable())
            }
          )
      }
    },
    {
      method: '*',
      path: '/v0/{p*}',
      handler: function v0(request, reply) {
        log.begin('Defaults.v0', request)
        reply(error.gone())
      }
    }
  ]

  return routes
}

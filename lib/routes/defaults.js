/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var path = require('path')
var cp = require('child_process')
const util = require('util')
var httprequest = require('request')

var version = require('../../package.json').version
var commitHash
var dbVersion
var sourceRepo

// Production and stage provide './config/version.json'. Try to load this at
// startup; punt on failure. For dev environments, we'll get this from `git`
// for dev environments.
try {
  var versionJson = path.join(__dirname, '..', '..', 'config', 'version.json')
  var info = require(versionJson)
  commitHash = info.version.hash
  sourceRepo = info.version.source
} catch (e) {
  /* ignore */
}

module.exports = function (log, P, db, error) {

  function versionHandler(request, reply) {
    log.begin('Defaults.root', request)

    // Get the version from fxa-auth-db-mysql server
    function getDBVersion() {
      return new P(function (resolve, reject) {
        if (!dbVersion) {
          var config = require('../../config').root()
          httprequest.get({url: config.httpdb.url, json: true, timeout: 10000}, function (err, response, body) {
            if (err) reject(err)
            if (response.statusCode !== 200) {
              // Just in case httpdb isn't sending plain 200, reject with explicit HTTP code
              reject(response.statusCode)
            } else {
              resolve(dbVersion = response.body.version)
            }
          })
        } else {
          resolve() // dbVersion is already set, so just resolve
        }
      }) // end of promise
    }

    function getCommitVersion() {
      return new P(function (resolve, reject) {
        if (!commitHash) {
          // ignore errors and default to 'unknown' if not found
          var gitDir = path.resolve(__dirname, '..', '..', '.git')
          var cmd = util.format('git --git-dir=%s rev-parse HEAD', gitDir)
          cp.exec(cmd, function(err, stdout1) {
            if (err) reject(err)
            var configPath = path.join(gitDir, 'config')
            var cmd = util.format('git config --file %s --get remote.origin.url', configPath)
            cp.exec(cmd, function(err, stdout2) {
              if (err) reject(err)
              commitHash = (stdout1 && stdout1.trim()) || 'unknown'
              sourceRepo = (stdout2 && stdout2.trim()) || 'unknown'
              resolve()
            })
          })
        } else {
          resolve() // commitHash is already set, e.g. on staging or production
        }
      }) // end of promise
    }

    function sendReply() {
      reply(
        {
          version: version,
          commit: commitHash,
          dbVersion: dbVersion,
          source: sourceRepo
        }
      ).spaces(2).suffix('\n')
    }

    P.all([getDBVersion(), getCommitVersion()])
      .then(sendReply)
      .catch(function(err) {
        log.error({ op: 'get versions', err: err })
        reply(error.serviceUnavailable())
      })
  }

  var routes = [
    {
      method: 'GET',
      path: '/',
      handler: versionHandler
    },
    {
      method: 'GET',
      path: '/__version__',
      handler: versionHandler
    },
    {
      method: 'GET',
      path: '/__heartbeat__',
      handler: function heartbeat(request, reply) {
        log.begin('Defaults.heartbeat', request)
        db.ping()
          .then(
            function () {
              reply({})
            })
          .catch(
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

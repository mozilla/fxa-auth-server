/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var validators = require('./validators')
var HEX_STRING = validators.HEX_STRING
var BASE64_JWT = validators.BASE64_JWT

var butil = require('../crypto/butil')

var URL = require('url')
var Request = require('request')
var jwtool = require('fxa-jwtool')


module.exports = function (
  log,
  P,
  isA,
  error,
  signer,
  config
  ) {

  var secretKey = jwtool.JWK.fromFile(config.secretKeyFile)
  var publicKey = jwtool.JWK.fromFile(config.publicKeyFile)

  var oauthProtocol = config.oauth.use_insecure_connection ? 'http' : 'https'
  var oauthHostname = config.oauth.host
  if (config.oauth.use_insecure_connection) {
    if (config.oauth.port !== '80') {
      oauthHostname += ':' + config.oauth.port
    }
  } else {
    if (config.oauth.port !== '443') {
      oauthHostname += ':' + config.oauth.port
    }
  }

  function proxyToOAuthServer(req, reply) {
    var url = JSON.parse(JSON.stringify(req.url))
    url.host = oauthHostname
    url.pathname = req.path.replace('/oauth/', '/')
    url.query = req.query
    url.protocol = oauthProtocol
    
    Request({
      method: req.method,
      uri: URL.format(url),
      json: req.payload ? req.payload: undefined,
      followRedirect: false
    }, function(err, response, body) {
      if (err) {
        return reply(err);
      }
      reply = reply(null, body)
      reply.code(response.statusCode)
      reply.type(response.headers['content-type'])
      if (response.headers['location']) {
        reply.location(response.headers['location'])
      }
    })
  }

  function generateOAuthAssertion(req) {
    // Hackety-hack, using our existing pubkey for this certificate
    // so we don't need all the infra to generate a fresh one.
    var sessionToken = req.auth.credentials
    return signer.sign({
      publicKey: publicKey.toJSON(),
      email: sessionToken.uid.toString('hex') + '@' + config.domain,
      domain: config.domain,
      duration: 5 * 60 * 1000,
      generation: sessionToken.verifierSetAt,
      lastAuthAt: sessionToken.lastAuthAt(),
      verifiedEmail: sessionToken.email,
    }).then(function(res) {
      return secretKey.sign({
        exp: Date.now() + 60 * 1000,
        aud: oauthProtocol + '://' + oauthHostname
      }).then(function(assertion) {
        return res.cert + "~" + assertion
      });
    })
  }

  var routes = [
    {
      method: 'GET',
      path: '/oauth/authorization',
      handler: function oauthBeginAuthorization(request, reply) {
        log.begin('OAuth.beginAuthorization', request)
        return proxyToOAuthServer(request, reply)
      }
    },
    {
      method: 'POST',
      path: '/oauth/authorization',
      config: {
        auth: 'sessionToken',
      },
      handler: function oauthCompleteAuthorization(request, reply) {
        log.begin('OAuth.completeAuthorization', request)
        generateOAuthAssertion(request).then(
          function(assertion) {
            request.payload.assertion = assertion
            return proxyToOAuthServer(request, reply)
          }
        )
      }
    },
    {
      method: 'POST',
      path: '/oauth/token',
      handler: function oauthGenerateToken(request, reply) {
        log.begin('OAuth.generateToken', request)
        return proxyToOAuthServer(request, reply)
      }
    },
    {
      method: 'POST',
      path: '/oauth/destroy',
      handler: function oauthDestroyToken(request, reply) {
        log.begin('OAuth.destroyToken', request)
        return proxyToOAuthServer(request, reply)
      }
    },
    {
      method: 'POST',
      path: '/oauth/verify',
      handler: function oauthVerifyToken(request, reply) {
        log.begin('OAuth.verifyToken', request)
        return proxyToOAuthServer(request, reply)
      }
    },
    {
      method: 'GET',
      path: '/oauth/client/{client_id}',
      handler: function oauthVerifyToken(request, reply) {
        log.begin('OAuth.getClient', request)
        return proxyToOAuthServer(request, reply)
      }
    },
    {
      method: 'GET',
      path: '/oauth/clients',
      handler: function oauthGetClients(request, reply) {
        log.begin('OAuth.getClients', request)
        return proxyToOAuthServer(request, reply)
      }
    },
    {
      method: 'POST',
      path: '/oauth/client',
      handler: function oauthCreateClient(request, reply) {
        log.begin('OAuth.createClient', request)
        return proxyToOAuthServer(request, reply)
      }
    },
    {
      method: 'POST',
      path: '/oauth/client/{client_id}',
      handler: function oauthUpdateClient(request, reply) {
        log.begin('OAuth.updateClient', request)
        return proxyToOAuthServer(request, reply)
      }
    },
    {
      method: 'DELETE',
      path: '/oauth/client/{client_id}',
      handler: function oauthVerifyToken(request, reply) {
        log.begin('OAuth.getClient', request)
        return proxyToOAuthServer(request, reply)
      }
    },
    {
      method: 'POST',
      path: '/oauth/developer/activate',
      handler: function oauthActivateDeveloper(request, reply) {
        log.begin('OAuth.activateDeveloepr', request)
        return proxyToOAuthServer(request, reply)
      }
    },
  ]

  return routes
}

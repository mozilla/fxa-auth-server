const insist = require('insist')
const sinon = require('sinon')

module.exports = Object.assign(
  (v) => insist(v),
  sinon.assert,
  insist
)

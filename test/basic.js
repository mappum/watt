var test = require('tap').test
var watt = require('..')

// var delay = watt(function * (arg, next) {
//   yield setTimeout(next, 10)
//   return arg
// })

test('simple wrap', t => {
  var f = watt(function * (next) {
    t.pass('generator was called')
    t.ok(next, '"next" was passed to generator')
    t.equal(typeof next, 'function', '"next" is a function')
    yield setTimeout(next, 10)
    t.pass('generator resumed after yield')
    t.end()
  })
  t.equal(typeof f, 'function', 'wrap returned function')
  f()
})

var test = require('tap').test
var watt = require('.')

test('simple wrap', t => {
  var f = watt(function * (next) {
    t.pass('generator was called')
    t.ok(next, '"next" was passed to generator')
    t.equal(typeof next, 'function', '"next" is a function')
    yield setTimeout(next, 10)
    t.pass('generator resumed')
    t.end()
  })
  t.equal(typeof f, 'function', 'wrap returned function')
  f()
})

test('synchronous "next"', t => {
  watt(function * (next) {
    yield next()
    t.pass('generator resumed')
    t.end()
  })()
})

test('take arguments', t => {
  watt(function * (arg1, arg2, next) {
    t.equal(arg1, 1, 'arg 1 is correct')
    t.equal(arg2, 2, 'arg 2 is correct')
    t.equal(typeof next, 'function', '"next" is appended to args')
    t.end()
  })(1, 2)
})

test('arguments with callback', t => {
  watt(function * (arg1, arg2, next, arg3) {
    t.equal(arg1, 1, 'arg 1 is correct')
    t.equal(arg2, 2, 'arg 2 is correct')
    t.equal(typeof next, 'function', '"next" is appended to args')
    t.notOk(arg3, 'no extra argument')
  })(1, 2, () => {
    t.pass('callback called')
    t.end()
  })
})

test('get callback result', t => {
  watt(function * (next) {
    var res = yield setTimeout(next, 10, null, false, true)
    t.equal(res, false, 'result is correct')
    t.end()
  })()
})

test('pass returned value to callback', t => {
  var res = watt(function * (next) {
    yield setTimeout(next, 10)
    return 'test'
  })((err, res) => {
    t.notOk(err, 'no error')
    t.equal(res, 'test', 'result is correct')
    t.end()
  })
  t.notOk(res, 'watt function did not return a value')
})

test('resolve Promise to returned value', t => {
  var promise = watt(function * (next) {
    yield setTimeout(next, 10)
    return 'test'
  })()
  t.ok(promise instanceof Promise, 'watt function returned Promise')
  promise.then(
    res => {
      t.pass('Promise resolved')
      t.equal(res, 'test')
      t.end()
    },
    () => t.fail('Promise rejected')
  )
})

test('bubble callback error to callback', t => {
  watt(function * (next) {
    yield setTimeout(next, 10, new Error('1'), 123, 456)
    t.fail('generator resumed')
  })((err, res) => {
    t.ok(err instanceof Error, 'error returned to cb')
    t.notOk(res, 'no result value')
    t.end()
  })
})

test('bubble callback error to Promise', t => {
  var promise = watt(function * (next) {
    yield setTimeout(next, 10, new Error('2'), 123, 456)
    t.fail('generator resumed')
  })()
  promise.then(
    () => t.fail('promise should not have resolved'),
    err => {
      t.pass('promise was rejected')
      t.ok(err instanceof Error, 'error given to reject handler')
      t.end()
    }
  )
})

test('bubble callback error to process.uncaughtException event', t => {
  // the tap module listens for 'uncaughtException' events, and if it
  // sees any it fails the current test. however, this test actually
  // uses uncaughtException, so as a hack we will remove tap's listener
  // then put it back at the end
  var listeners = process.listeners('uncaughtException')
  process.removeAllListeners('uncaughtException')

  process.once('uncaughtException', err => {
    t.pass('uncaughtException event emitted')
    t.ok(err instanceof Error, 'error given to event handler')
    t.end()
    listeners.map(listener => process.on('uncaughtException', listener))
  })
  watt(function * (next) {
    yield setTimeout(next, 10, new Error('3'), 123, 456)
    t.fail('generator resumed')
  })()
})

test('try/catch callback error', t => {
  watt(function * (next) {
    try {
      yield setTimeout(next, 10, new Error('4'), 123, 456)
      t.fail('error not thrown')
    } catch (err) {
      t.pass('error thrown')
      t.ok(err instanceof Error, 'error caught')
      t.end()
    }
  })()
})

test('yield a promise', t => {
  var func = watt(function * (next) {
    yield setTimeout(next, 10)
    return 100
  })
  watt(function * (next) {
    var res = yield func()
    t.pass('generator resumed')
    t.equal(res, 100, 'result is correct')
    t.end()
  })()
})

test('noCallback option', t => {
  var res = watt(function * (cb, next) {
    t.equal(typeof cb, 'function', '"cb" arg is function')
    t.equal(typeof next, 'function', '"next" arg is function')
    t.end()
  }, { noCallback: true })(() => t.fail('callback should not have been called'))
  t.ok(res instanceof Promise, 'watt function returned promise')
})

test('prepend option', t => {
  watt(function * (next, arg) {
    t.equal(typeof next, 'function', '"next" arg is function')
    t.equal(arg, 'beep', 'arg is correct')
    t.end()
  }, { prepend: true })('beep')
})

test('context option', t => {
  watt(function * (next) {
    t.equal(this.foo, 'bar', 'context bound correctly')
    t.end()
  }, { context: { foo: 'bar' } })()
})

test('default context', t => {
  var f = watt(function * (next) {
    t.equal(this.foo, 'bar', 'context bound correctly')
    t.end()
  })

  function context () {
    this.foo = 'bar'
    f()
  }
  context()
})

test('next.arg', t => {
  t.test('get Nth arg', t => {
    watt(function * (next) {
      var res = yield setTimeout(next.arg(3), 10, null, 1, 2, 3)
      t.pass('generator resumed')
      t.equal(res, 3, 'got correct arg')
    })(err => {
      t.notOk(err, 'no error bubbled')
      t.end()
    })
  })
  t.test('handle error', t => {
    watt(function * (next) {
      yield setTimeout(next.arg(3), 10, new Error('5'), 1, 2, 3)
      t.fail('generator resumed')
    })(err => {
      t.ok(err instanceof Error, 'error passed to callback')
      t.end()
    })
  })
  t.test('ignore error', t => {
    watt(function * (next) {
      var res = yield setTimeout(next.arg(3, true), 10, new Error('5'), 1, 2, 3)
      t.pass('generator resumed')
      t.equal(res, 3, 'got correct arg')
    })(err => {
      t.notOk(err, 'no error bubbled')
      t.end()
    })
  })
  t.test('0th arg', t => {
    watt(function * (next) {
      var res = yield setTimeout(next.arg(0), 10, new Error('5'), 1, 2, 3)
      t.pass('generator resumed')
      t.ok(res instanceof Error, 'got correct arg')
    })(err => {
      t.notOk(err, 'no error bubbled')
      t.end()
    })
  })
  t.end()
})

test('next.args', t => {
  t.test('get args', t => {
    watt(function * (next) {
      var res = yield setTimeout(next.args, 10, null, 1, 2, 3)
      t.pass('generator resumed')
      t.equal(typeof res, 'object', 'got res object')
      t.equal(res[0], null, '0th arg correct')
      t.equal(res[1], 1, '1st arg correct')
      t.equal(res[2], 2, '2nd arg correct')
      t.equal(res[3], 3, '3rd arg correct')
    })(err => {
      t.notOk(err, 'no error bubbled')
      t.end()
    })
  })
  t.test('error not handled', t => {
    watt(function * (next) {
      var res = yield setTimeout(next.args, 10, new Error('5'), 1, 2, 3)
      t.pass('generator resumed')
      t.equal(typeof res, 'object', 'got res object')
      t.ok(res[0] instanceof Error, '0th arg correct')
    })(err => {
      t.notOk(err, 'no error bubbled')
      t.end()
    })
  })
  t.end()
})

test('next.error', t => {
  watt(function * (next) {
    setTimeout(() => next.error(new Error('6')), 25)
    yield setTimeout(next, 50)
    t.fail('generator resumed after error')
  })(function (err) {
    t.ok(err instanceof Error, 'error passed to callback')
    t.end()
  })
})

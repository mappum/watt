var EventEmitter = require('events').EventEmitter
var util = require('util')
require('setimmediate')

function Watt (gen, args, opts, cb) {
  if (typeof args === 'function') {
    cb = args
    args = null
    opts = {}
  } else if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }
  args = args || []
  opts = opts || {}
  opts.context = opts.context || this

  if (!(this instanceof Watt)) return new Watt(gen, args, opts, cb)

  this._cb = cb
  this._cbCalled = false

  this._syncGroup = null

  var next = createCallbacks(this.next.bind(this), this.error.bind(this))
  next.parallel = this.parallel.bind(this)
  next.sync = this.sync.bind(this)

  var passedArgs
  if (opts.prepend) passedArgs = ([ next ]).concat(args)
  else passedArgs = args.concat([ next ])
  this.iterator = gen.apply(opts.context || this, passedArgs)
}
util.inherits(Watt, EventEmitter)

function wrap (gen, opts) {
  if (typeof gen === 'object') {
    opts = gen
    return function (gen) {
      return Watt.wrap(gen, opts)
    }
  }

  opts = opts || {}
  return function () {
    var args = Array.prototype.slice.call(arguments, 0)
    var cb
    if (!opts.noCallback && typeof args[args.length - 1] === 'function') {
      cb = args[args.length - 1]
      args = args.slice(0, -1)
    }
    if (!opts.context) opts.context = this
    return Watt(gen, args, opts, cb).run()
  }
}

function wrapAll (object, opts) {
  var names = Array.prototype.slice.call(arguments, typeof opts === 'object' ? 2 : 1)
  if (typeof opts === 'string') opts = {}
  opts = Object.assign({ context: object }, opts)

  function wrapAndBind (name) {
    if (!object[name] || !object[name].constructor ||
      object[name].constructor.name !== 'GeneratorFunction') return
    object[name] = wrap(object[name], opts)
  }

  var name
  if (names.length > 0) {
    for (name of names) wrapAndBind(name)
  } else {
    if (object.constructor && object.constructor.prototype) {
      var classProperties = Object.getOwnPropertyNames(object.constructor.prototype)
      for (name of classProperties) wrapAndBind(name)
    }
    for (name in object) wrapAndBind(name)
  }
}

module.exports = wrap
module.exports.wrapAll = wrapAll
module.exports.Watt = Watt

Watt.prototype._callCb = function () {
  if (this._cbCalled) return
  this._cbCalled = true
  var args = Array.prototype.slice.call(arguments, 0)
  this._cb.apply(this, args)
}

Watt.prototype.run = function (cb) {
  if (cb) {
    this._cb = cb
  } else if (!this._cb) {
    // if no cb is specified, return a Promise instead
    this._promise = new Promise((resolve, reject) => {
      this._cb = (err, res) => {
        if (err) {
          if (!handlingReject) {
            if (process.listeners && process.listeners('uncaughtException').length) {
              return process.emit('uncaughtException', err)
            } else {
              // ensure errors don't happen silently
              console.error(err.stack ? err.stack : err)
              if (process.exit) process.exit(1)
            }
          }
          return reject(err)
        }
        resolve(res)
      }
      this.next()
    })
    // hack to check if the consumer is checking for rejections
    var handlingReject = false
    var then = this._promise.then.bind(this._promise)
    var _catch = this._promise.catch.bind(this._promise)
    this._promise.then = (onFulfilled, onRejected) => {
      if (onRejected) handlingReject = true
      then(onFulfilled, onRejected)
    }
    this._promise.catch = (onRejected) => {
      if (onRejected) handlingReject = true
      _catch(onRejected)
    }
    return this._promise
  }
  this.next()
}

Watt.prototype.next = function (v) {
  setImmediate(() => {
    try {
      var res = this.iterator.next(v)
    } catch (err) {
      return this._callCb(err)
    }
    this.onRes(res)
  })
}

Watt.prototype.onRes = function (res) {
  if (!res) return
  if (res.done) {
    return this._callCb(null, res.value)
  }
  if (res.value instanceof Promise) {
    res.value.then(this.next.bind(this), this.error.bind(this))
  }
}

Watt.prototype.error = function (err) {
  if (!err) return
  try {
    var res = this.iterator.throw(err)
  } catch (err) {
    return this._callCb(err)
  }
  this.onRes(res)
}

Watt.prototype._getSyncGroup = function () {
  if (this._syncGroup) return this._syncGroup
  this._syncGroup = {
    running: 0,
    finished: 0,
    results: [],
    error: null
  }
  return this._syncGroup
}

Watt.prototype.parallel = function () {
  var self = this
  var syncGroup = this._getSyncGroup()
  var i = syncGroup.running
  syncGroup.running += 1

  var next = function (value) {
    if (self._syncGroup !== syncGroup) return
    syncGroup.running -= 1
    syncGroup.finished += 1
    syncGroup.results[i] = value
    if (syncGroup.running === 0 && syncGroup.onFinish) syncGroup.onFinish()
  }

  var error = function (err) {
    if (self._syncGroup !== syncGroup) return
    syncGroup.error = err
    if (syncGroup.onFinish) syncGroup.onFinish()
  }

  return createCallbacks(next, error)
}

Watt.prototype.sync = function () {
  var self = this
  var syncGroup = this._syncGroup
  return new Promise((resolve, reject) => {
    if (!syncGroup) return resolve(null)
    function onFinish (resolve, reject) {
      if (syncGroup.onFinish) self._syncGroup = null
      if (syncGroup.error) return reject(syncGroup.error)
      if (syncGroup.running === 0) return resolve(syncGroup.results)
      if (!syncGroup.onFinish) syncGroup.onFinish = () => onFinish(resolve, reject)
    }
    onFinish(resolve, reject)
  })
}

function createCallbacks (next, error) {
  var callback = function (err, v) {
    if (err) return error(err)
    next(v)
  }

  callback.error = error

  callback.args = function () {
    next(arguments)
  }

  callback.arg = function (n, ignoreError) {
    if (n === 0) ignoreError = true
    return function (err) {
      if (!ignoreError && err) return error(err)
      next(arguments[n])
    }
  }

  return callback
}

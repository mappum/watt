var EventEmitter = require('events').EventEmitter
var util = require('util')
require('setimmediate')

var Watt = module.exports = function (gen, args, opts, cb) {
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
  this._raceGroup = Symbol()
  this._tasks = new Set()
  this._taskQueue = []
  this._taskResults = []

  var W = this.cb.bind(this)
  W.cb = this.cb.bind(this)
  W.error = this.error.bind(this)
  W.args = this.args.bind(this)
  W.arg = this.arg.bind(this)
  W.parallel = this.parallel.bind(this)
  W.sync = this.sync.bind(this)

  var passedArgs
  if (opts.prepend) passedArgs = ([ W ]).concat(args)
  else passedArgs = args.concat([ W ])
  this.iterator = gen.apply(opts.context || this, passedArgs)
}
util.inherits(Watt, EventEmitter)

Watt.run = function (gen, args, opts, cb) {
  return Watt(gen, args, opts, cb).run()
}

Watt.wrap = function (gen, opts) {
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
    return Watt.run(gen, args, opts, cb)
  }
}

Watt.wrapPrepend = function (gen, opts) {
  opts = opts || {}
  opts.prepend = true
  return Watt.wrap(gen, opts)
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
      return this._cb(err)
    }
    this.onRes(res)
  })
}

Watt.prototype.onRes = function (res) {
  if (!res) return
  if (res.done) {
    return this._cb(null, res.value)
  }
  if (res.value instanceof Promise) {
    res.value.then(this.next.bind(this), this.error.bind(this))
  }
}

Watt.prototype.cb = function (err, v) {
  if (err) return this.error(err)
  this.next(v)
}

Watt.prototype.error = function (err) {
  if (!err) return
  try {
    var res = this.iterator.throw(err)
  } catch (e) {
    return this._cb(err)
  }
  this.onRes(res)
}

Watt.prototype.args = function () {
  this.next(arguments)
}

Watt.prototype.arg = function (n, ignoreError) {
  var self = this
  if (n === 0) ignoreError = true
  var output = function (err) {
    if (!ignoreError && err) {
      return self.error(err)
    }
    self.next(arguments[n])
  }
  return output
}

Watt.prototype.parallel = function (opts, gen, args) {
  if (typeof opts === 'function') {
    args = gen
    gen = opts
    opts = {}
  }

  var index = opts.index = opts.index != null ? opts.index : this._tasks.size
  if (opts.limit != null && this._tasks.size > opts.limit) {
    this._taskQueue.push([ opts, gen, args ])
    this._taskQueue.sort((a, b) => b[0].limit - a[0].limit)
    return
  }

  var task = new Watt(gen, args, (err, res) => {
    this._tasks.delete(task)
    this.error(err)
    this._taskResults[index] = res
    while (this._taskQueue.length && this._taskQueue[0][0].limit >= this._tasks.size) {
      this.parallel.apply(this, this._taskQueue.shift())
    }
    if (this._tasks.size === 0) {
      this.emit('sync', this._taskResults)
      this._taskResults = []
    }
  })
  this._tasks.add(task)
  task.run()
}

Watt.prototype.sync = function () {
  if (this._tasks.size === 0) return this.next(null)
  this.once('sync', this.arg(0))
}

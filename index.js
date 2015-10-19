var EventEmitter = require('events').EventEmitter
var util = require('util')

var Watt = module.exports = function (gen, args, opts, cb) {
  if (!(this instanceof Watt)) return new Watt(gen, args, opts, cb)

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

  this._cb = cb || (err => { if (err) this.emit('error', err) })
  this._raceGroup = Symbol()
  this._tasks = new Set()
  this._taskQueue = []
  this._taskResults = []

  var W = this.cb.bind(this)
  W.cb = this.cb.bind(this)
  W.error = this.error.bind(this)
  W.args = this.args.bind(this)
  W.arg = this.arg.bind(this)
  W.race = this.race.bind(this)
  W.select = this.select.bind(this)
  W.parallel = this.parallel.bind(this)
  W.sync = this.sync.bind(this)

  var passedArgs
  if (opts.prepend) passedArgs = ([ W ]).concat(args)
  else passedArgs = args.concat([ W ])
  this.iterator = gen.apply(this, passedArgs)
}
util.inherits(Watt, EventEmitter)

Watt.run = function (gen, args, opts, cb) {
  Watt(gen, args, opts, cb).run()
}

Watt.wrap = function (gen, opts) {
  opts = opts || {}
  return function () {
    var args = Array.prototype.slice.call(arguments, 0)
    var cb
    if (!opts.noCallback && !opts.prepend && typeof args[args.length - 1] === 'function') {
      cb = args[args.length - 1]
      args = args.slice(0, -1)
    }
    Watt.run(gen.bind(this), args, opts, cb)
  }
}

Watt.wrapPrepend = function (gen, opts) {
  opts = opts || {}
  opts.prepend = true
  return Watt.wrap(gen, opts)
}

Watt.prototype.run = function (cb) {
  if (cb) this._cb = cb
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

Watt.prototype.arg = function (n) {
  var self = this
  var output = function () { self.next(arguments[n]) }
  output.race = this.race(output)
  return output
}

Watt.prototype.race = function (f) {
  f = f || this.cb
  var self = this
  var raceGroup = this._raceGroup
  return function () {
    var args = Array.prototype.slice.call(arguments, 0)
    setImmediate(function () {
      if (raceGroup !== self._raceGroup) return
      self._raceGroup = Symbol()
      f.apply(self, args)
    })
  }
}

Watt.prototype.select = function () {}

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

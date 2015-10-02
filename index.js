var EventEmitter = require('events').EventEmitter
var util = require('util')

var Watt = module.exports = function (gen, args, cb) {
  if (!(this instanceof Watt)) return new Watt(gen, args, cb)

  if (typeof args === 'function') {
    cb = args
    args = null
  }
  args = args || []

  this._cb = cb || (err => { if (err) this.emit('error', err) })
  this._raceGroup = Symbol()
  this._tasks = new Set()
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

  this.iterator = gen.apply(this, args.concat([ W ]))
}
util.inherits(Watt, EventEmitter)

Watt.run = function (gen, args, cb) {
  Watt(gen, args, cb).run()
}

Watt.wrap = function (gen) {
  return function () {
    var args = Array.prototype.slice.call(arguments, 0)
    var cb
    if (typeof args[args.length - 1] === 'function') {
      cb = args[args.length - 1]
      args = args.slice(0, -1)
    }
    Watt.run(gen, args, cb)
  }
}

Watt.prototype.run = function (cb) {
  if (cb) this._cb = cb
  this.next()
}

Watt.prototype.next = function (v) {
  setImmediate(() => {
    try {
      var res = this.iterator.next(v)
    } catch(err) {
      this._cb(err)
    }
    if (res && res.done) this._cb(null, res.value)
  })
}

Watt.prototype.cb = function (err, v) {
  if (err) return this.error(err)
  this.next(v)
}

Watt.prototype.error = function (err) {
  try {
    if (err) this.iterator.throw(err)
  } catch (e) {
    this._cb(err)
  }
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

Watt.prototype.parallel = function (gen, args) {
  var index = this._tasks.size
  var task = new Watt(gen, args, (err, res) => {
    this._tasks.delete(task)
    this.error(err)
    this._taskResults[index] = res
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

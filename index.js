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

  var W = this.cb.bind(this)
  W.cb = this.cb.bind(this)
  W.error = this.error.bind(this)
  W.args = this.args.bind(this)
  W.arg = this.arg.bind(this)
  W.race = this.race.bind(this)
  W.select = this.select.bind(this)

  this.iterator = gen.apply(this, args.concat([ W ]))
}
util.inherits(Watt, EventEmitter)

Watt.run = function (gen, args, cb) {
  Watt(gen, args, cb).run()
}

Watt.wrap = function (gen) {
  return function (...args) {
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
  var self = this
  setImmediate(function () {
    try {
      var res = self.iterator.next(v)
    } catch(err) {
      self._cb(err)
    }
    if (res && res.done) self._cb(null, res.value)
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
  return function (...args) {
    setImmediate(function () {
      if (raceGroup !== self._raceGroup) return
      self._raceGroup = Symbol()
      f.apply(self, args)
    })
  }
}

Watt.prototype.select = function () {}

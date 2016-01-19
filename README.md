# watt

[![npm version](https://img.shields.io/npm/v/watt.svg)](https://www.npmjs.com/package/watt)
[![Build Status](https://travis-ci.org/mappum/watt.svg?branch=master)](https://travis-ci.org/mappum/watt)
[![Dependency Status](https://david-dm.org/mappum/watt.svg)](https://david-dm.org/mappum/watt)

Powerful control flow using generators

`watt` lets you write your async Javascript without callbacks, which results in much cleaner, more readable code.

ES6 introduced generators, which are functions that can be paused and resumed using the `yield` keyword. This lets us do some cool things, for instance letting a library handle control flow. This means your code can be written as if it was synchronous, but still gets the benefits of Node's async IO.

**Features:**
- Eliminates "callback hell"
- Use `for`/`while` loops and `if` statements, rather than needing the [`async`](https://github.com/caolan/async) package
- Return result to callback using `return`
- Use `try`/`catch` to handle async errors
- Pass sync/async errors to the callback automatically (reducing boilerplate), or with `throw`
- Compatible with the Node callback convention, as well as Promises
- Call your watt functions with callbacks, you don't have to change your API

**Berfore `watt`:**

```js
function copyFile (source, dest, callback) {
  fs.exists(source, function (err, exists) {
    if (err) return callback(err)
    if (!exists) return callback('Source does not exist')
    fs.exists(dest, function (err, exists) {
      if (err) return callback(err)
      if (exists) return callback('Dest already exists')
      fs.readFile(source, function (err, data) {
        if (err) return callback(err)
        fs.writeFile(dest, data, function (err) {
          return callback(err)
        })
      })
    })
  })
}
```

**After `watt`:**
```js
var copyFile = watt(function * (source, dest, next) {
  if (!(yield fs.exists(source, next))) throw 'Source does not exist'
  if (yield fs.exists(dest, next)) throw 'Dest already exists'
  var data = yield fs.readFile(source, next)
  yield fs.writeFile(dest, data, next)
})
```

**Both of these can be called with:**
```js
copyFile('a', 'b', function (err) {
  if (err) return console.error(err)
  console.log('copied file')
})
```

## Usage

`npm install watt`

### Reference

#### `watt( generator([args...],next), [opts] )`

Wraps a generator and returns a callable function. The returned function can be called with `fn([args...], [callback])`, and `([args...], next)` will be passed to `generator`.

The user-supplied `callback` is removed from `args` and will not be passed to the generator. `callback` will be automatically called with `callback(error, returned)` after the generator returns or throws an error. If no callback is supplied (the last argument is not a function), a Promise will be returned instead. Note: if you don't want the last argument to be treated as a callback even if it is a function, you may set the `noCallback` option (see below).

In the generator, `yield` should be called to wait for an async thing to happen, and `next` should be called to resume the generator. Alternatively, if a Promise is passed to `yield`, the generator will automatically resume once the Promise resolves (or will throw an error if it rejects).

`opts` may be an object with the following properties:
```js
{
  noCallback: Boolean, // default: false
  // if true, the user-supplied `callback` will not be removed from the arguments,
  // and will not be called after the generator returns or throws an errors

  prepend: Boolean, // default: false
  // if true, the generator is called with `generator(next, args...)`
  // instead of `generator(args..., next)`. This can be useful for functions
  // that accept varying numbers of arguments

  context: Object, // default: caller scope
  // sets the scope for the generator to run in. Similar to binding a function
  // with fn.bind(context)
}
```

#### `next(error, result)`

The `next` function is passed to `watt` generators, and is used to unpause the generator after it has `yield`ed. `next` should be passed to async functions to "return" their results to the generator and resume execution.

If `error` is truthy, the generator will throw an error. Otherwise, `result` will be passed to the most recent `yield` expression.

#### `next.error(error)`

If `error` is truthy, the generator will throw an error. This is useful when you want your generator to throw an error after an `error` event. For example:
```js
var stream = fs.createReadStream('file.txt')
stream.on('error', next.error)
stream.pipe(someWritableStream)
yield someWritableStream.on('end', next)
```
In this example, if `stream` encounters an error while we are waiting for it to pipe to `someWritableStream`, we will abort waiting for the piping to finish and will throw the error.

#### `next.arg(n, [ignoreError])`

A function that returns a callback which can be supplied to async functions to get the `n`th argument. Used as an alternative to `next`, which defaults to the 1st argument (the 0th argument is the error).

If `ignoreError` is truthy, the 0th argument won't be thrown as an error. If `n` is 0, `ignoreError` is implied to be `true`.

For example if we want to call `request(url, cb)` which calls `cb` with `cb(err, res, body)`, and we want the body, we can do:
```js
var body = yield request(url, next.arg(2))
```

#### `next.args()`

A callback which can be supplied to async functions to get all of the arguments passed to it. This function does not do any automatic error handling, since the error will be included in the arguments returned. The result returned is the function's `arguments` object.

Example:
```js
var args = yield fs.readFile('file.txt', next.args)
var error = args[0]
var data = args[1]
```

### Examples

#### - Loops
Print numbers from 0 to n, one per second

**Before `watt`:**

Without `watt`, we need to use the `async` library to set up an array of functions, one per iteration.
```js
var async = require('async')

function countUp (n, cb) {
  var tasks = []
  for (var i = 0; i <= n; i++) {
    (function (i) {
      tasks.push(function (cb) {
        setTimeout(function () {
          console.log(i)
          cb()
        }, 1000)
      })
    })(i)
  }
  async.series(tasks, cb)
}
```

**After `watt`:**

With `watt`, you only need a standard Javascript `for` loop.
```js
var async = require('watt')

var countUp = async(function * (n, next) {
  for (var i = 0; i <= n; i++) {
    yield setTimeout(next, 1000)
    console.log(i)
  }
})
```

## Alternatives

### - [`co`](https://github.com/tj/co)

`co` is similar to `watt`, but the main difference is that it only works with Promises. It requires that you convert callback functions to return Promises before you can call them, and it does not let you wrap generators with a callback API.

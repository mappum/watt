# watt

[![npm version](https://img.shields.io/npm/v/watt.svg)](https://www.npmjs.com/package/watt)
[![Build Status](https://travis-ci.org/mappum/watt.svg?branch=master)](https://travis-ci.org/mappum/watt)
[![Dependency Status](https://david-dm.org/mappum/watt.svg)](https://david-dm.org/mappum/watt)

**Powerful control flow using generators**

`watt` lets you write your async Javascript as if it were synchronous, which results in much simpler, more readable code.

ES6 introduced generators, which are functions that can be paused and resumed using the `yield` keyword. This lets us do some cool things, for instance letting a library handle control flow.

**Features:**
- Eliminates "callback hell"
- Use `for`/`while` loops and `if` statements, rather than needing the [`async`](https://github.com/caolan/async) package
- Return result to callback using `return`
- Use `try`/`catch` to handle async errors
- Pass sync/async errors to the callback automatically (reducing boilerplate), or with `throw`
- Compatible with the Node callback convention, as well as Promises
- `watt` functions can be called with callbacks, you don't have to change your API

**Before `watt`:**

```js
function copyFile (source, dest, callback) {
  fs.exists(source, function (exists) {
    if (!exists) return callback('Source does not exist')
    fs.exists(dest, function (exists) {
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
  if (!(yield fs.exists(source, next.arg(0)))) throw 'Source does not exist'
  if (yield fs.exists(dest, next.arg(0))) throw 'Dest already exists'
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

### `watt( generatorFn([args...],next), [opts] )`

Wraps a generator function and returns a callable function. The returned function can be called with `fn([args...], [callback])`, and `([args...], next)` will be passed to `generatorFn`.

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

----
### `next(error, result)`

The `next` function is passed to `watt` generators, and is used to unpause the generator after it has `yield`ed. `next` should be passed to async functions to "return" their results to the generator and resume execution.

If `error` is truthy, the generator will throw an error. Otherwise, `result` will be passed to the most recent `yield` expression.

----
### `next.error(error)`

If `error` is truthy, the generator will throw an error. This is useful when you want your generator to throw an error after an `error` event. For example:
```js
var stream = fs.createReadStream('file.txt')
stream.on('error', next.error)
stream.pipe(someWritableStream)
yield someWritableStream.on('end', next)
```
In this example, if `stream` encounters an error while we are waiting for it to pipe to `someWritableStream`, we will abort waiting for the piping to finish and will throw the error.

----
### `next.arg(n, [ignoreError])`

A function that returns a callback which can be supplied to async functions to get the `n`th argument. Used as an alternative to `next`, which defaults to the 1st argument (the 0th argument is the error).

If `ignoreError` is truthy, the 0th argument won't be thrown as an error. If `n` is 0, `ignoreError` is implied to be `true`.

For example if we want to call `request(url, cb)` which calls `cb` with `cb(err, res, body)`, and we want the body, we can do:
```js
var body = yield request(url, next.arg(2))
```

----
### `next.args()`

A callback which can be supplied to async functions to get all of the arguments passed to it. This function does not do any automatic error handling, since the error will be included in the arguments returned. The result returned is the function's `arguments` object.

Example:
```js
var args = yield fs.readFile('file.txt', next.args)
var error = args[0]
var data = args[1]
```

----
### `next.parallel()`, `next.sync()`

Call `next.parallel()` to execute async calls in parallel, then call `yield next.sync()` to wait for these tasks to finish. The result of `next.sync()` will be an array of the result values of tasks, in the order they were spawned. `next.sync()` will unyield as soon as a task gives an error, or when all the tasks have finished.

`next.parallel()` returns a callback similar to `next`, which treats the first value as an error and the second as the return value. Like `next`, this callback also has the `arg` and `args` properties.

Note that you should not `yield` before a parallel call since we don't want the generator to block until the call to `sync`.

Example:
```js
for (var i = 0; i < 5; i++) {
  // waits a random amount of time, then returns i
  setTimeout(next.parallel().arg(0), Math.random() * 1000, i)
}
// wait until all timeouts have finished
var res = yield next.sync()
// res is: [ 0, 1, 2, 3, 4 ]
```

----
### `watt.wrapAll(object, [opts], [names...])`

Wraps generator function properties of `object`. Each wrapped generator function gets bound to the context of `object`. If no values are specified for `names`, all generator function properties are wrapped. If one or more strings are specified for `names`, only the properties with those keys will be wrapped.

`opts` can be an options object that will be passed to [`watt()`](#watt-generatorargsnext-opts-).

This can be useful for wrapping generator methods of a class (call `watt.wrapAll(this)` in the constructor).

```js
var watt = require('watt')

class MyClass {
  constructor () {
    this.a = 5

    // do this to wrap both 'foo' and 'bar'
    watt.wrapAll(this)

    // do this to wrap only 'foo'
    watt.wrapAll(this, 'foo')
  }

  // remember to prefix with * to make a generator
  * foo (next) {
    yield doAsyncThing(this.a, next)
    return yield doAnotherAsyncThing(next)
  }

  * bar (next) {
    yield foo()
    return yield doAnotherAsyncThing(next)
  }

  var mc = new MyClass()
  mc.foo((err, res) => { ... })
}
```

## Examples

### Iterating through an array
Iterate through an array of file paths until we find one that exists.

**Before `watt`:**

Without `watt`, we need to use the `async` module.
```js
var async = require('async')

function firstExisting (paths, cb) {
  async.eachSeries(paths, function (path, next) {
    fs.exists(path, function (err, exists) {
      if (err) return cb(err)
      if (exists) return cb(path)
      next()
    })
  })
}
```

**After `watt`:**

With `watt`, we can use a standard Javascript `for` loop.
```js
var async = require('watt')

var firstExisting = async(function * (paths, next) {
  for (var path of paths) {
    if (yield fs.exists(path, next)) return path
  }
})
```
----
### Iterating through a range
Print numbers from 0 to n, one per second.

**Before `watt`:**

Without `watt`, we need to use recursion. This isn't too complex, however it is slightly less readable than it would be if it were synchronous.
```js
var async = require('async')

function countUp (n, cb) {
  function next (i) {
    setTimeout(function () {
      console.log(i)
      if (i < n) next(i + 1)
    }, 1000)
  }
  next(0)
}
```

**After `watt`:**

With `watt`, we can use a standard Javascript `for` loop.
```js
var async = require('watt')

var countUp = async(function * (n, next) {
  for (var i = 0; i <= n; i++) {
    yield setTimeout(next, 1000)
    console.log(i)
  }
})
```
----
### `if` statements
An ugly part of using async callbacks is that the syntax gets ugly when branching. Consider a function that calls an async function `foo`, then depending on the result maybe calls `bar`, then finally calls `baz`:

**Before `watt`:**
```js
function myAsyncFunc (cb) {
  foo(function (err, res) {
    if (err) return cb(err)
    if (res) {
      bar(function (err) {
        if (err) return cb(err)
        baz(cb)
      })
      return
    }
    baz(cb)
  })
}
```

**After `watt`:**
```js
var myAsyncFunc = async(function * (next) {
  var res = yield foo(next)
  if (res) yield bar(next)
  return yield baz(next)
}
```

----
### Promises
`watt` works well with Promises. If you `yield` a promise, its result will be returned if is resolves, or its error will be thrown if it is rejected.

Additionally, `watt` functions return Promises if a callback is not provided, so you can call them from another `watt` generator without providing the `next` argument.

```js
var foo = async(function * (next) {
  setTimeout(next, 1000)
  return 'aslfdkj'
}

var bar = async(function * (next) {
  return yield foo() // 'next' not necessary
})

// callers can use the Promise API instead of a callback if they want
bar().then(res => console.log(res))
```

## Alternatives

### - [`co`](https://github.com/tj/co)

`co` is similar to `watt`, but the main difference is that it only works with Promises. It requires that you convert callback functions to return Promises before you can call them, and it does not let you wrap generators with a callback API.

//
// MediaManagerStorage/lib/file-cache/index.js:
//
//  Cache of user files which are accessed by the application and cannot be packaged with the 
//  application in the assets directory. For example, images stored as attachments in TouchDB
//  can be cached in order to reduce load on TouchDB and allow the application to simply access
//  the assets off of the local filesystem.
//
//  Module factory (invoke module as function NOT via new):
//
//    function(options): Factory method, which by default returns a singleton instance of
//      the cache interface.
//
//      options:
//        alias: When requesting a full path, an alias can be used as opposed to the full path
//          to the asset in the cache. For example, the application bundle may have an assets
//          directory, with a link of the following form:
//
//          ./assets/mm-file-cache -> /Users/chad/Library/Caches/media-manager/file
//
//          The alias option could be set to '/mm-file-cache' in order to easily access
//          cached files from the AppJS framework / chromium client. 
//
//        singleton: Default true. Set to false to return a new interface very time.
//          Useful for testing, etc..
//
//  Attributes:
//
//    rootDir: The root directory of the file cache. Constructed as:
//      osxFs.libCachesDir + '/media-manager/file',
//
//      ie:
//
//      /Users/chad/Library/Caches/com.jetsonsystems.plm/media-manager/file
//
//  Methods:
//
//    getPath(name, id, options): Return a full or relative path to the file asset identified name, associated with object w/ id.
//
//    putFromUrl(url, id, options, callback): Load the file (store in our cache) as referenced via a 
//      network URL into the cache.
//
//    putFromPath(path, id, options, callback): Load the file (store in our cache) as referenced via a
//      path on the local filesystem.
//

var path = require('path');
var fs = require('fs');
var util = require('util');

var _ = require('underscore');
var crypto = require('crypto');
var async = require('async');
var request = require('request');

var osxFs = require('MediaManagerAppSupport/lib/OSXFileSystem');
var logger = require('log4js').getLogger("plm.MediaManagerStorage");

var moduleName = './' + __filename.split('/').slice(-2).join('/').replace('.js', '');

//
// cacheInst: Singleton instance of the module.
//
var cacheInst = null;

//
// putQ / putQWorker: Handle serially putting assets into the cache.
//

// putQWorker
//  task:
//    that: instance
//    worker: worker method.
//    arguments: args excluding callback.
//    callback(e, p): worker callback.
//
var putQWorker = function(task, callback) {
  var lp = moduleName + '.putQWorker: ';

  var cb = function(e, p) {
    task.callback(e, p);
    callback(e);
  };

  logger.debug(lp + 'About to invoke task worker...');

  var args = task.args.concat(cb);
  task.worker.apply(task.that, args);

  logger.debug(lp + 'Invoked task worker...');
};

var putQWorkerCallback = function(err) {
  var lp = moduleName + '.putQWorkerCallback: ';

  if (err) {
    logger.error(lp + 'Error during put Q, error - ' + err);
  }
  else {
    logger.debug(lp + 'Task successfully completed....');
  }
};

var putQ = async.queue(putQWorker, 1);

putQ.drain = function() {
  logger.debug('putQ is drained!');
}

module.exports = function cacheModule(options) {
  var logPrefix = moduleName + ': ';

  if ((!options || !_.has(options, 'singletom') || options.singleton) && (cacheInst !== null)) {
    //
    //  Not the first time, you can leave off the options. Otherwise, they must be the same as the previous one.
    //
    if (options && !_.isEqual(cacheInst.options, options)) {
      var msg = 'Reinstantiating with different options. Module is a singleton, options - ' + JSON.stringify(options) + ', singleton options - ' + JSON.stringify(cacheInst.options);

      logger.error(logPrefix + msg);
      throw Object.create(new Error(),
                          { name: { value: 'ReinstantiatingWithDifferentOptions' },
                            message: { value: 'MediaManagerStorage' + moduleName + ': msg' }
                          });
    }

    return cacheInst;
  }

  // throw new Error('Where the hell are we creating this from....');

  options = options || {};

  if (!_.has(options, 'singleton')) {
    options.singleton = true;
  }

  if (!_.has(options, 'alias')) {
    options.alias = undefined;
  }

  var initRootDir = function() {
    var osxCachesDir = osxFs.libCachesDir;
    if (!fs.existsSync(osxCachesDir) || !fs.statSync(osxCachesDir).isDirectory()) {
      var msg = 'OSX Library Caches directory does NOT exist - ' + osxCachesDir + '.';

      logger.error(logPrefix + msg);
      throw new Error('MediaManagerStorage' + moduleName + ': ' + msg);
    }

    var dir = path.join(osxCachesDir, '/media-manager');
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir);
      }
      catch (e) {
        var msg = 'Error initializing file cache root directory - ' + e;
        
        logger.error(logPrefix + msg);
        throw new Error('MediaManagerStorage' + moduleName + ': ' + msg);
      }
    }

    dir = path.join(osxCachesDir, '/media-manager/file');

    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir);
      }
      catch (e) {
        var msg = 'Error initializing file cache root directory - ' + e;
        
        logger.error(logPrefix + msg);
        throw new Error('MediaManagerStorage' + moduleName + ': ' + msg);
      }
    }

    return dir;
  }

  //
  // The root of the cache, constructud as: osxFs.libCachesDir + '/media-manager/file'.
  //
  var rootDir = initRootDir();

  //
  // getPath(name, id, options): In the event of a cache hit, return a full or 
  //  relative path to the file asset identified by name, associated with object 
  //  w/ id. In the event of a cache miss *<b>null</b>* is returned.
  //
  //  Args:
  //    options:
  //      type: 'full' or 'relative'. Defauilt is 'full'.
  //      noCheck: If true, the path is returned regardless of whether we have a cache hit or miss. The default is false.
  //
  var getPath = function(name, id, options) {

    var lp = moduleName + '.getPath: ';

    options = options || {};

    if (!_.has(options, 'type')) {
      options.type = 'full';
    }

    if (!_.has(options, 'noCheck')) {
      options.noCheck = false;
    }

    var md5 = crypto.createHash('md5').update(id).digest("hex");

    var relPath = path.join('/' + md5.slice(0,2) + '/' + md5.slice(2,4) + '/' + id + '/' + name);

    var fullPath = path.join(this.rootDir, relPath);

    if (!options.noCheck) {
      if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
        //
        // Have a cache miss.
        //
        return null;
      }
    }

    //
    // Have a cache hit, return the appropriate path.
    //
    if (options.type === 'relative') {
      return relPath;
    }
    else if (options.type === 'full') {
      if (this.options.alias) {
        return path.join(this.options.alias, relPath);
      }
      else {
        return fullPath;
      }
    }
    else {
      var msg = 'Invalid type option value - ' + options.type;
      logger.error(lp + msg);
      throw new Error(lp + msg);
    }
  };

  //
  // mkCacheDir: Helper to create the cache directory given a relative path to an asset.
  //  Paths should be off the form: /<part1>/<part2>/<id>/<filename>
  //
  var mkCacheDir = function(relPath) {
    var lp = moduleName + '.mkCacheDir: ';

    var relPathParts = _.filter(relPath.split('/'), function(p) { return p !== ''; });

    if (relPathParts.length !== 4) {
      var msg = 'Invalid relative path to asset - ' + relPath;
      logger.error(lp + msg);
      throw new Error(lp + msg);
    }

    var dir = path.join(this.rootDir, relPathParts[0]);

    if (!fs.existsSync(dir)) {
      try {
        logger.debug(lp + 'Creating dir - ' + dir);
        fs.mkdirSync(dir);
      }
      catch (e) {
        var msg = 'Error initializing file cache directory - ' + dir + ', error - ' + e;
        
        logger.error(lp + msg);
        throw new Error('MediaManagerStorage' + moduleName + ': ' + msg);
      }
    }

    dir = path.join(this.rootDir, relPathParts[0], relPathParts[1]);

    if (!fs.existsSync(dir)) {
      try {
        logger.debug(lp + 'Creating dir - ' + dir);
        fs.mkdirSync(dir);
      }
      catch (e) {
        var msg = 'Error initializing file cache directory - ' + dir + ', error - ' + e;
        
        logger.error(lp + msg);
        throw new Error('MediaManagerStorage' + moduleName + ': ' + msg);
      }
    }

    dir = path.join(this.rootDir, relPathParts[0], relPathParts[1], relPathParts[2]);

    if (!fs.existsSync(dir)) {
      try {
        logger.debug(lp + 'Creating dir - ' + dir);
        fs.mkdirSync(dir);
      }
      catch (e) {
        var msg = 'Error initializing file cache directory - ' + dir + ', error - ' + e;
        
        logger.error(lp + msg);
        throw new Error('MediaManagerStorage' + moduleName + ': ' + msg);
      }
    }
  }

  //
  // doPutFromUrl: Worker for putFromUrl.
  //
  var doPutFromUrl = function(url, id, options, callback) {

    var that = this;

    var lp = moduleName + '.doPutFromUrl: ';

    logger.debug(lp + 'invoked....');

    var filename = options.name || url.split('/').slice(-1);

    var relPath = that.getPath(filename, id, {type: 'relative', noCheck: true});

    logger.debug(lp + 'putting url - ' + url + ', for id - ' + id + ', filename - ' + filename + ', rel. path - ' + relPath);

    try {
      mkCacheDir.call(that, relPath);
    }
    catch (e) {
      logger.error(lp + 'Error creating cache dir - ' + e);
      !callback || callback(e);
    }

    var fullPath = path.join(that.rootDir, relPath);
    var tmpFullPath = fullPath + ".tmp";

    var writeStream = fs.createWriteStream(tmpFullPath);

    writeStream.on('finish', function() {
      logger.debug(lp + 'write stream finish event detected!');
      fs.rename(tmpFullPath, fullPath, function(e) {
        if (callback) {
          if (e) {
            callback(e);
          }
          else {
            callback(null, that.getPath(filename, id, options));
          }
        }
      });
    });

    writeStream.on('close', function() {
      logger.debug(lp + 'write stream close event detected!');
      fs.rename(tmpFullPath, fullPath, function(e) {
        if (callback) {
          if (e) {
            callback(e);
          }
          else {
            callback(null, that.getPath(filename, id, options));
          }
        }
      });
    });

    request(url).pipe(writeStream);

  };

  //
  // putFromUrl(url, id, options, callback): Load the file asset (store in our 
  //  cache) as referenced via a network URL into the cache. The asset is 
  //  associated with an object referenced by *<b>id</b>*. The name of the 
  //  asset is derived from the network *<b>url</b>*. If the URL does NOT 
  //  contain a filename component, a *<b>name</b>* attribute can be supplied 
  //  in the options hash. If its a hit, any existing file will be overwritten.
  //
  //  Args:
  //    * url: Network URL to the asset.
  //    * id: id of object the asset is associated with.
  //    * options:
  //      * name: Name to assign the asset, which would subsequently be 
  //          supplied to the getPath method.
  //      * type: As defined for getPath. Used to compute the path passed
  //        to the callback.
  //    * callback(err, path)
  //
  var putFromUrl = function(url, id, options, callback) {
    var that = this;

    var lp = moduleName + '.putFromUrl: ';

    options = options || {};

    logger.debug(lp + 'Pushing to put Q...');

    putQ.push({
      that: that,
      worker: doPutFromUrl,
      args: [ url, id, options ],
      callback: callback
    },
              function(e) {
                var lpp = moduleName + '.putFromUrl.putQWorkerCallback: ';
                
                if (e) {
                  logger.error(lpp + 'Error during putFromUrl processing, error - ' + e);
                }
                else {
                  logger.debug(lpp + 'Processing for putFromUrl successfully completed....');
                }
              });
    logger.debug(lp + 'Pushed to put Q...');
  };

  var putFromPath = function(path, id, options, callback) {};

  //
  // cacheInst: The cache interface to return.
  //
  var newInst = Object.create({}, {
    options: { value: options },
    rootDir: { value: rootDir },
    getPath: { value: getPath },
    putFromUrl: { value: putFromUrl },
    putFromPath: { value: putFromPath }
  });

  if (options.singleton) {
    cacheInst = newInst;
  }

  return newInst;

};

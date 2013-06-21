//
// MediaManagerStorage/lib/gdrive: Storage to Google Drive.
//
//  See README.md for usage and details.
//

var events = require('events');
var path = require('path');
var fs = require('fs');

var log4js = require('log4js');
var uuid  = require('node-uuid');
var _ = require('underscore');
var ObjectQ = require('objectq').ObjectQ;
var TasksQueue = require('tasks-queue');
var keyValueStore = require('node-persist');

var moduleName = './lib/gdrive';

module.exports = (function gdriveModule() {

  var logger = log4js.getLogger('plm.MediaManagerAppSupport');

  function genUploadId() {
    return uuid.v4();
  };

  var uploader = undefined;

  //
  // Uploader: Enqueues and uploads assets. Emits events as an
  //  upload progresses.
  //
  //  Uploader is a singleton as it persists data. Otherwise,
  //  we would need a way to identify a particular instance 
  //  across instantiations and process invokations. We currently
  //  DO NOT require multiple uploaders to run.
  //
  //  See README.md for details.
  //
  //  Events: Events are emitted as uploads occur. Events are all emitted with
  //    the event type and a single upload event paramater. For example:
  //    uploader.on(event, function(uploadEvent) {})
  //
  //    An uploadEvent has the following attributes:
  //      type: same as the event string.
  //      uploadId: a unique ID for each upload.
  //      emittedAt: when the event was emitted.
  //      assetDesc: the assetDesc passed to enqueue()
  //      storageRef: a storageRef document.
  //
  //    The following events are emitted:
  //
  //      uploader.upload.started
  //      uploader.upload.success
  //      uploader.upload.error
  //
  var Uploader = function(accountDesc, persistDir, options) {

    if (Uploader.prototype._singletonInstance) {
      return Uploader.prototype._singletonInstance;
    }

    Uploader.prototype._singletonInstance = this;

    var that = this;

    options = options || {};

    options.uploadqFile = options.uploadqFile || 'gdrive-uploadq.json';
    options.minRequestInterval = options.minRequestInterval || 1000;

    if (_.has(accountDesc, 'user')) {
      logger.info(logPrefix + 'Using Google account for user - ' + accountDesc.user);
    }

    var logPrefix = moduleName + '.Uploader: ';

    events.EventEmitter.call(this);

    var uploadEventPrototype = {
      type: undefined,
      uploadId: undefined,
      emittedAt: undefined,
      assetDesc: undefined,
      storageRef: undefined
    };

    this.events = {
      uploadStarted: 'uploader.upload.started',
      uploadSuccess: 'uploader.upload.success',
      uploadError: 'uploader.upload.error'
    };

    this.start = function() {
      logger.info(logPrefix + 'Starting scheduling and uploading...');
      sched();
      schedQ.execute();
    };
    this.stop = function() {};
    this.pause = function() {};
    this.restart = function() {};

    var uploadQPersistPath = path.join(persistDir, options.uploadqFile);
    var uploadQ = new ObjectQ(uploadQPersistPath, 900);
    //
    // SchedQ: Use this to politely hit Google. We keep schedQLowWater items
    //  items in schedQ, taking as needed from uploadQ, and inserting into schedQ.
    //  schedQ is in memory only.
    //
    var schedQLowWater = 10;
    var schedQ = new TasksQueue({autostop: false});
    //
    // uploading: Has of items either in schedQ, or pulled off of schedQ
    //  but not yet completed. Items are keyed by uploadId. uploading is 
    //  persisted. Upon startup, any items in uploading are placed into
    //  schedQ.
    //
    var uploading = keyValueStore;

    var uploadingPersistDir;

    if (persistDir[0] !== '/') {
      uploadingPersistDir = path.join(process.cwd(), persistDir, 'uploading');
    }
    else {
      uploadingPersistDir = path.join(persistDir, 'uploading');
    }
    console.log(logPrefix + 'persist dir - ' + persistDir + ', uploading persist dir - ' + uploadingPersistDir);
    if (!fs.existsSync(uploadingPersistDir)) {
      fs.mkdirSync(uploadingPersistDir);
    }
    keyValueStore.initSync({
      dir: uploadingPersistDir
    });

    schedQ.setMinTime(options.minRequestInterval);

    //
    // sched: Try and keep schedQLowWater items in schedQ,
    //  taking from uploadQ as needed.
    //
    function sched() {
      while ((uploadQ.count() > 0) && (schedQ.length() < schedQLowWater)) {
        var toUpload = uploadQ.shift();
        logger.info(logPrefix + 'Scheduling for upload - ' + toUpload.path);
        uploading.setItem(toUpload.uploadId, toUpload);
        uploadQ.flush();
        schedQ.pushTask('upload', toUpload);
      }
    };

    function doUpload(toUpload, callback) {
      that.emit(that.events.uploadStarted,
                {docId: toUpload.docId,
                 path: toUpload.path});
      upload({docId: toUpload.docId,
              path: toUpload.path},
             accountDesc,
             {callback: function(err, assetDesc) {
               callback(err, toUpload);
             }});
    };

    schedQ.on('upload',
              function(jinn, toUpload) {
                logger.info(logPrefix + 'Ready to upload, upload id - ' + toUpload.uploadId + ', doc id - ' + toUpload.docId + ', path - ' + toUpload.path);
                doUpload(toUpload, function(err, toUpload) {
                  if (err) {
                    logger.info(logPrefix + 'Upload error!');
                    uploadQ.queue(toUpload);
                    schedQ.setMinTime(schedQ.getMinTime() * 2);
                  }
                  else {
                    logger.info(logPrefix + 'Upload success!');
                    schedQ.setMinTime(options.minRequestInterval);
                  }
                  uploading.removeItem(toUpload.uploadId);
                  sched();
                  if (err) {
                    that.emit(that.events.uploadError,
                              {docId: toUpload.docId,
                               path: toUpload.path});
                  }
                  else {
                    that.emit(that.events.uploadSuccess,
                              {docId: toUpload.docId,
                               path: toUpload.path});
                  }
                  jinn.done();
                });
                sched();
              });

    this.enqueue = function(assetDesc) {
      logger.info(logPrefix + 'enqueing item, doc id - ' + assetDesc.doc_id + ', asset path - ' + assetDesc.path);
      uploadQ.queue({
        uploadId: genUploadId(),
        docId: assetDesc.docId,
        path: assetDesc.path
      });
      uploadQ.flush();
      sched();
    };

    this.numPending = function() {
      return uploadQ.count() + uploading.length();
    };

    this.queueSize = function() {
      return uploadQ.count();
    };

    this.numUploading = function() {
      return uploading.length();
    };

    this.stats = function() {
      var stats = {
        numPending: this.numPending(),
        queueSize: uploadQ.count(),
        numUploading: uploading.length()
      };
      logger.info(logPrefix + 'pending - ' + stats.numPending + ', uploadQ size - ' + stats.queueSize + ', uploading - ' + stats.numUploading);
      return stats;
    };

  };

  Uploader.prototype.__proto__ = events.EventEmitter.prototype;

  var upload = function(assetDesc, accountDesc, options) {
    options = options || {};
    var logPrefix = moduleName + '.Upload: ';

    logger.info(logPrefix + 'Uploading...');
    if (options.callback) {
      options.callback(undefined, assetDesc);
    }
  };

  var download = function() {};

  return {
    Uploader: Uploader,
    upload: upload,
    download: download
  };

})();

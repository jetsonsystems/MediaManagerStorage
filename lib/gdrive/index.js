//
// MediaManagerStorage/lib/gdrive: Storage to Google Drive.
//
//  See README.md for usage and details.
//

var events = require('events');
var path = require('path');
var fs = require('fs');
var util = require('util');

var log4js = require('log4js');
var uuid  = require('node-uuid');
var _ = require('underscore');
var ObjectQ = require('objectq').ObjectQ;
var TasksQueue = require('tasks-queue');
var keyValueStore = require('node-persist');

var dataModel = require('../data-model');
var clientModule = require('./client');

var moduleName = './lib/gdrive';

module.exports = (function gdriveModule() {

  var logger = log4js.getLogger('plm.MediaManagerStorage');

  function genUploadId() {
    return uuid.v4();
  };

  //
  // Location: Create a complete location descriptor
  //  for where to store a particular type of asset.
  //
  //  Attributes:
  //    assetType: Type of asset the location is designated for.
  //      "any" || "original", Default: "original".
  //    root: Root where data is to be stored.
  //      "appdata" | "mydrive", Default: "appdata"
  //    basePath: Path within root where assets are to be stored.
  //      IE: /media/images/originals
  //    folderId: The id of the folder represented by root/basePath, if known. Default: unknown.
  //
  function LocationDesc(location) {
    location = location || {};
    if (!_.has(location, 'assetType')) {
      location.assetType = "original";
    }
    if (!_.has(location, 'root')) {
      location.root = "appdata";
    }
    if (!_.has(location, "basePath")) {
      location.basePath = "/";
    }
    if (!_.has(location, "folderId")) {
      if (location.basePath === "/") {
        location.folderId = "root";
      }
      else {
        location.folderId = undefined;
      }
    }
    return location;
  };

  //
  // Location: Location object constructor. Initializes the
  //  storage location by ensuring the directory identified
  //  by locationDesc.basePath exists and is represented by
  //  a folder ID.
  //
  function Location(locationDesc, accountDesc, callback) {
    this.ready = false;
    this.location = locationDesc;
    this.account = accountDesc;

    if (locationDesc.basePath === "/") {
      locationDesc.folderId = "root";
      this.ready = true;
      callback();
    }
    else if (locationDesc.folderId === undefined) {
      //
      // create folders if needed as represented by basePath and update
      // folderId.
      //
      // Temporarily just set to root, until we do the right thing.
      //
      locationDesc.folderId = "root";
      callback();
    }
    else {
      callback();
    }
  };

  //
  // ToUpload: Object representing an item to be uploaded.
  //
  function ToUpload(assetDesc, accountDesc) {
    this.uploadId = genUploadId();
    this.asset = assetDesc;
    this.account = accountDesc;
  };

  //
  // UploadEvent: Represents an event occurring during an
  //  upload.
  //
  function UploadEvent(event, toUpload, account, response) {
    this.type = event;
    this.uploadId = toUpload.uploadId;
    this.emittedAt = undefined;
    this.asset = toUpload.asset;
    this.account = account;
    var attr = {
      doc_class_name: toUpload.asset.docClassName,
      doc_id: toUpload.asset.docId,
      asset_type: toUpload.asset.assetType,
      desc: 'gdrive',
      state: { status: undefined },
      ref: {}
    };
    attr.ref.account = account.user;
    if (event === 'uploader.upload.started') {
      attr.state.status = 'in-progress';
    }
    else if (event === 'uploader.upload.error') {
      attr.state.status = 'error';
    }
    else if (event === 'uploader.upload.success') {
      attr.state.status = 'success';
      if (response && _.has(response, 'id')) {
        attr.ref.fild_id = response.id;
      }
    }
    this.storageRef = dataModel.docFactory("plm.StorageRef", attr);
  };

  //
  // AuthTokenRefreshEvent: Event as a result of refreshing an access token.
  //
  function AuthTokenRefreshEvent(event, accountDesc) {
    this.type = event,
    this.account = accountDesc
  };

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
  //      uploader.auth.accessTokenRefreshed
  //
  var Uploader = function(accountDesc, persistDir, options) {

    if (Uploader.prototype._singletonInstance) {
      return Uploader.prototype._singletonInstance;
    }

    Uploader.prototype._singletonInstance = this;

    var that = this;

    options = options || {};

    var logOnly = options.logOnly = _.has(options, 'logOnly') ? options.logOnly : false;
    var uploadqFile = options.uploadqFile = options.uploadqFile || 'gdrive-uploadq.json';
    var minRequestInterval = options.minRequestInterval = options.minRequestInterval || 1000;
    //
    // Don't delay MORE than 5 minutes, unless the user specified time is bigger.
    //
    var maxRequestInterval = 300000;
    if (minRequestInterval > maxRequestInterval) {
      maxRequestInterval = minRequestInterval;
    }

    var locationDesc = new LocationDesc(options.location);
    //
    // location is undefined until start is invoked.
    //
    var location = undefined;

    var logPrefix = moduleName + '.Uploader: ';

    if (_.has(accountDesc, 'user')) {
      logger.info(logPrefix + 'Using Google account for user - ' + accountDesc.user);
    }
    logger.info(logPrefix + 'Location; for asset type - ' + locationDesc.assetType + ', root - ' + locationDesc.root + ', base path - ' + locationDesc.basePath + ', folder id - ' + locationDesc.folderId);

    var client = new clientModule(accountDesc);

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
      uploadError: 'uploader.upload.error',
      authAccessTokenRefreshed: 'uploader.auth.accessTokenRefreshed'
    };

    this.start = function() {
      logger.info(logPrefix + 'Starting scheduling and uploading...');
      location = new Location(locationDesc, 
                              accountDesc, 
                              function(err) {
                                if (err) {
                                  logger.error(logPrefix + 'Error initializing location, error - ' + err);
                                }
                                else {
                                  sched();
                                  schedQ.execute()
                                }
                              });
    };
    this.stop = function() {};

    var refreshingAccessToken = false;

    var uploadQPersistPath = path.join(persistDir, uploadqFile);
    logger.info(logPrefix + 'Creating uploadQ w/ persist path - ' + uploadQPersistPath + ', persist interval - ' + 1000);
    var uploadQ = new ObjectQ(uploadQPersistPath, 1000);
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
    // maxUploading: No more than 2 concurrent uploads.
    //
    var maxUploading = 2;
    var uploading = keyValueStore;

    var uploadingPersistDir;

    if (persistDir[0] !== '/') {
      uploadingPersistDir = path.join(process.cwd(), persistDir, 'uploading');
    }
    else {
      uploadingPersistDir = path.join(persistDir, 'uploading');
    }
    logger.debug(logPrefix + 'persist dir - ' + persistDir + ', uploading persist dir - ' + uploadingPersistDir);
    if (!fs.existsSync(uploadingPersistDir)) {
      fs.mkdirSync(uploadingPersistDir);
    }
    keyValueStore.initSync({
      dir: uploadingPersistDir
    });

    schedQ.setMinTime(minRequestInterval);

    //
    // Make sure anything that was being uploaded, gets scheduled.
    //
    uploading.values(function(toUploadValues) {
      logger.info(logPrefix + 'Scheduling items previously being uploaded - ' + util.inspect(toUploadValues));
      _.each(toUploadValues, function(toUpload) {
        uploadQ.unshift(toUpload);
        uploadQ.flush();
        uploading.removeItem(toUpload.uploadId);
      });
    });

    //
    // sched: Try and keep schedQLowWater items in schedQ,
    //  taking from uploadQ as needed.
    //
    function sched() {
      var lp = moduleName + '.Uploader.sched: ';
      
      logger.info(lp + 'uploadQ size - ' + uploadQ.count() + ', schedQ size - ' + schedQ.length() + ', schedQ low water - ' + schedQLowWater + ', num. uploading - ' + uploading.length() + ', max uploading - ' + maxUploading);
      while ((uploadQ.count() > 0) && (schedQ.length() < schedQLowWater) && (uploading.length() < maxUploading)) {
        var toUpload = uploadQ.shift();
        logger.info(logPrefix + 'Scheduling for upload - ' + toUpload.asset.path);
        uploading.setItem(toUpload.uploadId, toUpload);
        uploadQ.flush();
        logger.info(logPrefix + 'Flushed uplaodQ, flushing - ' + uploadQ._flushing + ', dirty - ' + uploadQ._dirty);
        schedQ.pushTask('upload', toUpload);
      }
    };

    function doUpload(toUpload, callback) {
      if (refreshingAccessToken === true) {
        var cbErr = Object.create( new Error(),
                                   { name: { value: 'AuthError' },
                                     message: { value: 'Token refresh in progress!' } });
        callback(cbErr, toUpload);
        return;
      }
      that.emit(that.events.uploadStarted,
                new UploadEvent(that.events.uploadStarted,
                                toUpload,
                                accountDesc));
      upload(toUpload.asset,
             accountDesc,
             {logOnly: logOnly,
              callback: function(err, assetDesc, responseBody) {
                callback(err, toUpload, responseBody);
              }});
    };

    schedQ.on('upload',
              function(jinn, toUpload) {
                logger.info(logPrefix + 'Ready to upload, upload id - ' + toUpload.uploadId + ', doc id - ' + toUpload.asset.docId + ', path - ' + toUpload.asset.path);
                doUpload(toUpload, function(err, toUpload, responseBody) {
                  if (err) {
                    logger.info(logPrefix + 'Upload error!');
                    uploadQ.queue(toUpload);
                    var newTime = schedQ.getMinTime() * 2;
                    if (newTime > maxRequestInterval) {
                      newTime = maxRequestInterval;
                    }
                    schedQ.setMinTime(newTime);
                    if (err.name && err.name === 'AuthError' && refreshingAccessToken === false) {
                      logger.info(logPrefix + 'About to refresh access token...');
                      refreshingAccessToken = true;
                      client.refreshToken(accountDesc, function(error, accessToken, expiresIn) {
                        if (error) {
                          logger.info(logPrefix + 'Error refreshing access token.');
                        }
                        else {
                          logger.info(logPrefix + 'Have new access token - ' + accessToken + ', expires in - ' + expiresIn);
                          accountDesc.accessToken = accessToken;
                          that.emit(that.events.authAccessTokenRefreshed, 
                                    new AuthTokenRefreshEvent(that.events.authAccessTokenRefreshed,
                                                              accountDesc));
                        }
                        refreshingAccessToken = false;
                        sched();
                      });
                    }
                  }
                  else {
                    logger.info(logPrefix + 'Upload success!');
                    schedQ.setMinTime(minRequestInterval);
                  }
                  uploading.removeItem(toUpload.uploadId);
                  sched();
                  if (err) {
                    that.emit(that.events.uploadError,
                              {docId: toUpload.asset.docId,
                               path: toUpload.asset.path});
                  }
                  else {
                    that.emit(that.events.uploadSuccess,
                              new UploadEvent(that.events.uploadSuccess,
                                              toUpload,
                                              accountDesc,
                                              responseBody));
                  }
                  jinn.done();
                });
                sched();
              });

    this.enqueue = function(assetDesc) {
      logger.info(logPrefix + 'enqueing item, doc id - ' + assetDesc.docId + ', asset path - ' + assetDesc.path);
      uploadQ.queue(new ToUpload(assetDesc, accountDesc));
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
      return stats;
    };

  };

  Uploader.prototype.__proto__ = events.EventEmitter.prototype;

  //
  // upload: Upload a file.
  //
  var upload = function(assetDesc, accountDesc, options) {
    options = options || {};
    var logOnly = options.logOnly = _.has(options, 'logOnly') ? options.logOnly : false;    
    var logPrefix = moduleName + '.upload: ';


    if (logOnly) {
      logger.info(logPrefix + 'Log only mode for asset - ' + assetDesc.path);
      if (options.callback) {
        options.callback(undefined, assetDesc);
      }
    }
    else {
      logger.info(logPrefix + 'Uploading using account - ' + accountDesc.user + ', asset - ' + assetDesc.path);
      var client = new clientModule(accountDesc);
      client.upload(assetDesc,
                    {
                      uploadType: 'multipart',
                      metadata: {
                        "parents": [{"id": "appdata"}]
                      },
                      callback: function(error, response, body) {
                        var cbErr = undefined;
                        if (error) {
                          logger.error(logPrefix + 'Upload error, error - ' + error + ', response - ' + util.inspect(response) + ', body - ' + util.inspect(response));
                          cbErr = Object.create( new Error(),
                                                 { name: { value: 'UnknownError' },
                                                   message: { value: 'Unknown request error - ' + error } });
                        }
                        else if (response.statusCode === 401) {
                          logger.info(logPrefix + 'Upload error, authentication error!');
                          cbErr = Object.create( new Error(),
                                                 { name: { value: 'AuthError' },
                                                   message: { value: 'Google Drive authentication error!' } });
                        }
                        else {
                          logger.info(logPrefix + 'Upload success, account - ' + accountDesc.user + ', asset - ' + assetDesc.path);
                          logger.debug(logPrefix + 'status code - ' + response.statusCode + ', response body - ' + util.inspect(body));
                        }
                        if (options.callback) {
                          var jBody = undefined;
                          try {
                            jBody = JSON.parse(body);
                          }
                          catch (e) {
                            jBody = undefined;
                          }
                          options.callback(cbErr, assetDesc, jBody);
                        }
                      }});
    }
  };

  var download = function() {};

  return {
    Uploader: Uploader,
    upload: upload,
    download: download
  };

})();

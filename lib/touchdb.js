//
//  MediaManagerStorage/lib/touchdb.js: Interface to TouchDB.
//
//    The current assumption is that we are talking to TouchDB via our web-service, MediaManagerTouchServ,
//    which embeds TouchDB.
//
//    Usage:
//
//      var config = requre('MediaManagerAppConfig');
//      var touchdb = require('MediaManagerStorage')(config.db)
//
//    The module is a Singleton, hence the first time it is required with a config, that is what will be used.
//    Subsequent requiring of the module can leave out a config, and the singleton is returned.
//
//    Public Module Attributes:
//
//      config: The DB config used during instantiation.
//
//    Module operations which are exposed:
//
//      sync: Perform a 2 way syncronization between the local TouchDB instance and a remote CouchDB instance.
//        Returns a synchronizer which is an event emitter.
//      syncState(id): Return the state of a synchronization. Returns a Synchronizer instance, but it
//        is a passive instance (returns NO events). This is solely here to support polling of a synchronization 
//        initiated via sync().
//      changesFeed(options): Returns a changes feed.
//
'use strict';

var uuid  = require('node-uuid');
var events = require('events');
var _ = require('underscore');
var http = require('http');
var request = require('request').defaults({ jar: false });
var async = require('async');
var log = require('log4js').getLogger("plm.MediaManagerStorage");

var moduleName = './lib/touchdb.js';

//
//  touchdb: The singleton instance.
//
var touchdb = null;

//
//  synchronizerFactory: Generate a Synchronizer object.
//
//    Args:
//      config: DB config.
//      options:
//        id: synchronizer ID
//        passive: default false. If true, will ONLY return the state of a synchronization
//          (id is required).
//      callback: Invoked when passive == true, and checking the status of the replication
//        has completed.
//
//    Synchronizers: Initiate a sychronization, or just return the state (passive === true).
//
//      attributes:
//
//        config
//        id: <push ID>:<pull ID>
//        state: 'triggered', 'completed' or 'error'
//        push
//        pull
//
//      events:
//
//        sync.started
//        sync.replication.push.started
//        sync.replication.push.completed
//        sync.replication.pull.started
//        sync.replication.pull.completed
//        sync.completed
//
var synchronizerFactory = function(config, options, callback) {

  var logPrefix = moduleName + '.synchronizerFactory: ';

  log.info(logPrefix + 'About to create synchronizer...');

  //
  //  Replication: Describes a replication:
  //
  //  type: 'push' or 'pull'
  //  source: source of replication
  //  target: target of replicaiton
  //
  function Replication(type, id) {

    function setSourceTarget() {
      var local = config.database;
      var remote = "http://" + config.remote.host;

      if (config.remote.port) {
        remote = remote + ":" + config.remote.port;
      }
      remote = remote + "/" + config.database;

      if (type === 'push') {
        this.source = local;
        this.target = remote;
      }
      else if (type === 'pull') {
        this.source = remote;
        this.target = local;
      }
    }

    function setEvents() {
      if (type === 'push') {
        this.events = {
          started: 'sync.replication.push.started',
          completed: 'sync.replication.push.completed'
        };
      }
      else if (type === 'pull') {
        this.events = {
          started: 'sync.replication.pull.started',
          completed: 'sync.replication.pull.completed'
        };
      }
    }

    this.type = type;
    setSourceTarget.apply(this);
    setEvents.apply(this);
    this.id = id ? id : uuid.v4();
    this.state = undefined;
  }


  var pushId = undefined;
  var pullId = undefined;

  if (options && _.has(options, 'id')) {
    var tmp = options.id.split('+');
    pushId = tmp && tmp.length ? tmp[0] : undefined;

    pullId = tmp && tmp.length > 1 ? tmp[1] : undefined;
  }

  var pushRep = Object.create(new Replication('push', pushId));
  var pullRep = Object.create(new Replication('pull', pullId));

  var synchronizerId = pushRep.id + "+" + pullRep.id;

  log.info(logPrefix + 'Creating synchronizer w/ id - %s', synchronizerId);

  var synchronizer = Object.create(events.EventEmitter.prototype, {
    id: { value: synchronizerId },
    config: { value: config },
    state: { value: undefined, writable: true },
    push: { value: pushRep },
    pull: { value: pullRep },
    run: { value: function() { throw Object.create(new Error(),
                                                   { name: { value: 'SynchronizerVoidRunInvokation' },
                                                     mesage: { value: 'Synchronizer run function NOT overriden.' } }); },
           writable: true }
  });

  //
  //  monitor: Monitor a replication.
  //
  //    args:
  //      options:
  //        maxChecks: int, default is undefined or unlimited checks.
  //
  var monitor = function(replication, options, callback) {
    log.info(moduleName + '.synchronizerFactory.monitor: Monitoring replication, type - %s', replication.type);
    var url = "http://localhost:" + config.local.port + "/_replicator/" + replication.id;
    options = options ? options : {};
    var maxChecks = _.has(options, 'maxChecks') ? options.maxChecks : undefined;
    var numChecks = 0;
    var check = function(url, callback) {
      request(url, function(error, response, body) {
        numChecks = numChecks + 1;
        log.info(moduleName + '.synchronizerFactory.monitor: Monitored replication, type - %s, check number %s, url - %s, body type - %s, body - %j', 
					       replication.type, numChecks, url, typeof(body), body);
        var parsedBody;
        try { 
          parsedBody = JSON.parse(body);
        } 
        catch (err) {
          error = Object.create(new Error(),
                                { name: { value: 'BodyParseError' },
                                  message: { value: 'MediaManagerStorage/lib/touchdb.js.monitor: Failure parsing response body!' } });
          parsedBody = body;
        }
        if (error) {
          replication.state = 'error';
          log.error(moduleName + '.synchronizerFactory.monitor: Replication error - %s', error);
        }
        else if (response.statusCode === 200) {
          try {
            replication.state = parsedBody._replication_state;
          }
          catch (err) {
            replication.state = 'error';
          }
          log.info(moduleName + '.synchronizerFactory.monitor: Replication state - %s', replication.state);
        }
        else {
          log.info(moduleName + '.synchronizerFactory.monitor: Response status - %s', response.statusCode);
        }
        callback();
      });
    };
    var checkInterval = 1 * 1000;
    // 15s max check interval.
    var maxCheckInterval = 15 * 1000;
    var checked = function() {
      if (((maxChecks === undefined) || (numChecks < maxChecks)) && (replication.state === 'triggered')) {

        checkInterval = checkInterval >= maxCheckInterval ? maxCheckInterval : checkInterval * 2;
        log.info(moduleName + '.synchronizerFactory.monitor: Scheduling next check, numChecks - %s, maxChecks - %s, check interval - %s', 
						numChecks, maxChecks, checkInterval);
        setTimeout(check, checkInterval, url, checked);
      }
      else {
        callback(null);
      }
    };
    log.info(moduleName + '.synchronizerFactory.monitor: About to perform checks, numChecks - %s, maxChecks - %s, check interval - %s', 
				numChecks, maxChecks, checkInterval);
    if ((maxChecks === undefined) || (numChecks < maxChecks)) {
      check(url, checked);
    }
    else {
      callback(null);
    }
  };

  //
  //  replicate: Trigger a replication as described via the replication object.
  //
  //  Replication is handing using the _replicator DB.
  //  Refer to the following documentation on CouchDB replication:
  //
  //  https://wiki.apache.org/couchdb/Replication
  //  https://gist.github.com/832610
  //  http://www.dataprotocols.org/en/latest/couchdb_replication.html
  //
  //  For details on the _replicator db see:
  //
  // https://wiki.apache.org/couchdb/Replication#Replicator_database
  //
  var replicate = function(replication, callback) {
    //
    // The URL is: http://localhost:<config.local.port>/_replicator/
    // That is, replication is always triggered via the local touchDB server,
    // and uses the _replicator database. 
    //
    // The following
    //
    // * push:
    //
    // curl -v -X POST -H 'content-type:application/json' -d '{"source":"plm-media-manager", "target":"http://10.254.0.131/plm-media-manager", "create_target":true}' "http://localhost:59840/_replicator/"
    //
    // * pull:
    //
    // curl -v -X POST -H 'content-type:application/json' -d '{"target":"plm-media-manager", "source":"http://10.254.0.131/plm-media-manager", "create_target":true}' "http://localhost:59840/_replicator/"
    //
    var url = "http://localhost:" + config.local.port + "/_replicator/";
    log.info(moduleName + '.synchronizerFactory.replicate: About to replicate, type - %s, url - %s, source - %s, target - %s',
				replication.type, url, replication.source, replication.target);
    synchronizer.state = 'triggered';
    request.post({
      url: url,
      json: true,
      body: { "_id": replication.id,
              "source": replication.source,
              "target": replication.target,
              "create_target": true }
    }, 
                 function(error, response, body) {
                   if (error) {
                     log.info(moduleName + '.synchronizerFactory.replicate: Replication error, type - %s, error - %s', replication.type, error.message);
                   }
                   else {
                     log.info(moduleName + '.synchronizerFactory.replicate: Replication response, type - %s, status code - %s, body - %j', 
                       replication.type, response.statusCode, body);
                   }
                   if (_.has(body, 'id')) {
                     replication.id = body.id;
                   }
                   else if (!error) {
                     error = Object.create(new Error(),
                                           { name: { value: 'NoReplicationId' },
                                             message: { value: 'MediaManagerStorage/lib/touchdb.js: Replication has no ID!' } });
                   }
                   if (!error && response.statusCode === 201) {
                     monitor(replication, {}, function(error) {
                       if (error) {
                         synchronizer.state = 'error';
                         synchronizer.emit(replication.events.completed);
                        callback(error);
                       }
                       else {
                         synchronizer.state = 'completed';
                         callback(null);
                       }
                     });
                   }
                   else {
                     if (!error) {
                       error = Object.create(new Error(),
                                             { name: { value: 'BadReplicationStatusCode' },
                                               message: { value: 'MediaManagerStorage/lib/touchdb.js: Replication initiated with bad status - ' + response.statusCode + '!' } });
                     }
                     synchronizer.state = 'error';
                     log.error(moduleName + '.synchronizerFactory.replicate: Error triggering replication...');
                     synchronizer.emit(replication.events.completed);
                     callback(error);
                   }
                 });
    synchronizer.state = 'triggered';
    log.info(moduleName + '.synchronizerFactory.replicate: Replication triggered...');
    synchronizer.emit(replication.events.started);
  };

  if (options && _.has(options, 'passive') && options.passive) {
    //
    // Create a 'passive' synchronizer which doesn't trigger replication,
    // but just does a single monitor of a push / pull replication.
    // This just does 2 loockups in the _replicator DB.
    //
    synchronizer.run = function() { throw Object.create(new Error(),
                                                        { name: { value: "PassiveSynchronizerRunError" },
                                                          message: { value: "Passive synchronizer run method cannot be executed!"} });
                                  };
    log.info(moduleName + '.synchronizerFactory.replicate: About to monitor passive synchronization...');
    async.waterfall([
      function(next) {
        monitor(synchronizer.push, { maxChecks: 1 }, next);
      },
      function(next) {
        monitor(synchronizer.pull, { maxChecks: 1 }, next);
      }], function(err) {
        if (synchronizer.push.state === 'completed' && synchronizer.pull.state === 'completed') {
          synchronizer.state = 'completed';
        }
        else if (synchronizer.push.state === 'error' || synchronizer.pull.state === 'error') {
          synchronizer.state = 'error';
        }
        else if (synchronizer.push.state === 'triggered' || synchronizer.pull.state === 'triggered') {
          synchronizer.state = 'triggered';
        }
        if (callback) {
          callback(err, synchronizer);
        }
      });
  }
  else {
    log.info(moduleName + '.synchronizerFactory.replicate: Annotating non-passive synchronizer with run function...');
    synchronizer.run = function() {
      synchronizer.state = 'triggered';
      log.info(moduleName + '.synchronizerFactory.replicate: Synchronization triggered...');
      synchronizer.emit('sync.started', synchronizer);
      async.waterfall([
        function(next) {
          log.info(moduleName + '.synchronizerFactory.replicate: Triggering push...');
          replicate(synchronizer.push, next);
        },
        function(next) {
          log.info(moduleName + '.synchronizerFactory.replicate: Triggering pull...');
          replicate(synchronizer.pull, next);
        }
      ], function(err) {
        if (err) {
          log.error(moduleName + '.synchronizerFactory.replicate: Error during synchronization, error - %s', err);
        }
        synchronizer.state = 'completed';
        synchronizer.emit('sync.completed', synchronizer);
      });
    };
    log.info(moduleName + '.synchronizerFactory.replicate: Annotation completed...');
  }

  return synchronizer;
};

//
//  changesFeedFactory: Returns an instance of a changes feed which is an event Emitter.
//
//    args:
//      config: DB config
//      options:
//        excludeAppId: Used to filter changes by appId. Only consider documents 
//          who's doc.app_id differs from this one. This allows us to look
//          for documents which have been created by another instance of the 
//          application, and made available via a sync. That is: 
//          excludeAppId === current app's app_id.
//        includeFilter: Array of document 'class_name's to include. Others 
//          will be ignored. If not specified (or evalutes to false), all 
//          documents emit an event.
//        since: DB sequence ID S.T. changes will only be return where the seq. 
//          ID is after this one. See TouchDB's _changes?since query paramter.
//          If since is NOT provided, the current sequence ID of the DB will be used.
//
//    attributes:
//
//      config: DB config.
//      state: undefined, 'connected', 'disconnected'
//      since: the DB update seq used to start listening to the DB.
//      currentUpdateSeq: the DB update seq is updated as the feed is listened to.
//      listen: Connects the TouchDB's changes feed. state becomes 'connected' when listening is successful.
//        If the connection is lost, the state becomes 'disconnected'.
//
//    events:
//      doc.<doc. type>.<change type>
//
//      where:
//
//        <doc. type> ::= 'image' | 'importer'
//        <change type> ::= 'created' | 'updated' | 'deleted'
//
//      IE: doc.image.created
//
//      Note, for documents other than images, <doc. type> is __unknown__.
//
//      Events are emitted with as follows:
//
//        <changes feed instance>.emit(doc.<doc. type>.<change type>, <change event>);
//
//      The listener will receive a <change event> as the first arg. See changeEVentPrototype below. It
//      will include:
//        <emittedAt>: date object when emitted.
//        <type>: the event.
//        <doc>: the document which is included in the chagnes feed.
//
var changesFeedFactory = function(config, opts) {

  var logPrefix = moduleName + '.changesFeedFactory: ';

  log.info(logPrefix + 'Creating changes feed...');

  var options = opts || {};

  var since =  _.has(options, 'since') ? options.since : undefined;
  var excludeAppId = _.has(options, 'excludeAppId') ? options.excludeAppId : undefined;
  var includeFilter = _.has(options, 'includeFilter') ? options.includeFilter : undefined;
  var currentUpdateSeq = undefined;

  var changesFeed = Object.create(events.EventEmitter.prototype, {
    config: { value: config },
    state: { value: undefined, writable: true },
    since: { value: since, writable: true },
    includeFilter: { value: includeFilter, writable: true },
    excludeAppId: { value: excludeAppId, writable: true },
    currentUpdateSeq: { value: currentUpdateSeq, writable: true },
    listen: { value: function() { throw Object.create(new Error(),
                                                      { name: { value: 'ChangesFeedVoidListenInvokation' },
                                                        mesage: { value: 'ChangesFeed listen function NOT overriden.' } }); },
              writable: true }
  });

  //
  //  Prototype for <change event> argument (first arg. of emitted events).
  //
  var changeEventPrototype = {
    emittedAt: undefined,
    type: undefined,
    doc: undefined
  };

  //
  //  filterChange: Return a <change event> if the change should NOT be filtered, otherwise return false.
  //
  var filterChange = function(change) {
    var that = this;

    var logPrefix = moduleName + '.changesFeed.filterChange: ';

    var retVal = false;
    if (_.has(change, 'doc')) {
      var doc = change.doc;

      log.info(logPrefix + 'Processing change doc: id - %s, doc class - %s, doc app id - %s, exclude app id - %s, doc - %j', change.id, doc.class_name, doc.app_id, that.excludeAppId, doc);

      if (!that.excludeAppId || !_.has(doc, 'app_id') || (that.excludeAppId !== doc.app_id)) {
        if (_.has(doc, 'class_name') && (!that.includeFilter || _.indexOf(that.includeFilter, doc.class_name) > -1)) {
          //
          //  Have a non-filtered document.
          //

          var docClassesToTypes = {
            'plm.Image': 'image',
            'plm.ImportBatch': 'importer'
          };
            
          var docType = _.has(docClassesToTypes, doc.class_name) ? docClassesToTypes[doc.class_name] : '__unknown__';
            
          var changeType = 'updated';
            
          if (_.has(change, 'deleted') && change.deleted) {
            changeType = 'deleted';
          }
          else {
            log.info(logPrefix + 'Determining change type, changes - ' + JSON.stringify(change.changes));
            _.each(change.changes, function(chg) {
              if (_.has(chg, 'rev') && (chg.rev.match(/^1-/))) {
                changeType = 'created';
              }
            });
          }

          retVal = Object.create(changeEventPrototype, {
            emittedAt: { value: new Date(), writable: false },
            type: { value: 'doc.' + docType + '.' + changeType, writable: false },
            doc: { value: doc, writable: false }
          });
        }
        else {
          log.info(logPrefix + 'Change excluded via include filter, doc class name - ' + doc.class_name);
        }
      }
      else {
        log.info(logPrefix + 'Change excluded via app ID, app ID to exclude - ' + that.excludeAppId + ', doc. app ID - ' + doc.app_id);
      }
    }
    return retVal;
  };

  //
  //  processChanges: Helper to process the data in buffer.
  //    Emits events for each pertinent change, and returns
  //    any extraneous data in buffer which is not yet complete
  //
  var processChanges = function(buffer) {
    var that = this;

    var logPrefix = moduleName + '.changesFeed.processChanges: ';

    log.info(logPrefix + 'Processing changes w/ config - %j', that.config);

    var parts = buffer.split('\n');

    if (parts.length > 0) {
      _.each(_.first(parts, parts.length - 1), function(part) {
        if (part.length) {
          try {
            var change = JSON.parse(part);

            if (_.has(change, 'seq') && _.has(change, 'id')) {
              log.info(logPrefix + 'Processing change: seq - %s, id - %s', change.seq, change.id);

              var changeEvent = filterChange.call(that, change);
              if (changeEvent) {
                log.info(logPrefix + 'About to emit change event, type - %s', changeEvent.type);
                that.currentUpdateSeq = change.seq;
                that.emit(changeEvent.type, changeEvent);
              }
            }
          }
          catch (err) {
            log.error(logPrefix + 'Error processing change, data - %s, error - %s', part, err);
          }
        }
      });
      return _.last(parts);
    }
    else {
      return buffer;
    }
  };

  //
  //  listen: Listen to the changes feed by performing the following request:
  //    http://localhost:59840/plm-media-manager/_changes?since=268&feed=continuous&include_docs=true&style=main_only&descending=false'
  //
  //    The following options are used in the request:
  //      since: included if specified.
  //      feed=continuous: We continuously monitor the feed.
  //      include_docs=true: We request the changed documents to be included in the feed. That way we can include them in the emitted event.
  //      style=main_only: Only the main / winning change for now.
  //      descending=false: What the changes to come in oldest to newest.
  //
  //    Note, when style=all_docs is specified, for some reason changes always come in reverse order and descending is ignored. We
  //    may need to revisit this as we may want ALL changes.
  //
  changesFeed.listen = function() {
    var that = this;

    var path = "/" + config.database + "/_changes?feed=continuous&include_docs=true&style=main_only&descending=false";
    if (this.since) {
      path = path + "&since=" + this.since;
    }
    var options = {
      hostname: this.config.local.host ? this.config.local.host : 'localhost',
      port: this.config.local.port,
      path: path,
      method: 'GET'
    };

    var buffer = "";

    //
    //  Fire off a request. It will essentially look like this:
    //
    // curl -v 'http://localhost:59840/plm-media-manager/_changes?since=268&feed=continuous&include_docs=true&style=main_only&descending=false'
    // * About to connect() to localhost port 59840 (#0)
    // *   Trying ::1... connected
    // * Connected to localhost (::1) port 59840 (#0)
    // > GET /plm-media-manager/_changes?since=268&feed=continuous&include_docs=true&style=main_only&descending=false HTTP/1.1
    // > User-Agent: curl/7.21.4 (universal-apple-darwin11.0) libcurl/7.21.4 OpenSSL/0.9.8r zlib/1.2.5
    // > Host: localhost:59840
    // > Accept: */*
    // > 
    // < HTTP/1.1 200 OK
    // < Transfer-Encoding: chunked
    // < Date: Thu, 31 Jan 2013 20:35:29 GMT
    // < Accept-Ranges: bytes
    // < Server: TouchDB 1
    // < Cache-Control: must-revalidate
    // < 
    // {"seq":269,"id":"c2a7b2de-e2cb-4ce4-9514-d0ebdb823ff6","changes":[{"rev":"2-e61993fd1c7d399f6407c98819a222c1"}],"doc":{"batch_id":"e24ede96-bd00-4ae5-bc31-e0a49256e45c","class_name":"plm.Image","filesize":"200.8K","created_at":"2013-01-30T03:54:15.461Z","_rev":"2-e61993fd1c7d399f6407c98819a222c1","tags":[],"_id":"c2a7b2de-e2cb-4ce4-9514-d0ebdb823ff6","checksum":"ab71373cc6a33cc97cb472af2cae3dd8","path":"","size":{"width":1202,"height":800},"oid":"c2a7b2de-e2cb-4ce4-9514-d0ebdb823ff6","geometry":"1202x800","format":"JPEG","orig_id":"0d79e6ef-962c-4934-8942-0537fc11e6a5","updated_at":"2013-01-30T03:54:15.461Z","_attachments":{"full-small.jpg":{"stub":true,"length":205650,"digest":"sha1-0UGnqWXHNA88F0qIStwYA9Ic7RA=","revpos":2,"content_type":"image\/JPEG"}},"name":"full-small.jpg"}}
    // {"seq":270,"id":"e24ede96-bd00-4ae5-bc31-e0a49256e45c","changes":[{"rev":"2-32109ba995293746e71ca79a5ecbaefc"}],"doc":{"num_success":19,"class_name":"plm.ImportBatch","num_to_import":19,"created_at":"2013-01-30T03:53:14.878Z","_rev":"2-32109ba995293746e71ca79a5ecbaefc","_id":"e24ede96-bd00-4ae5-bc31-e0a49256e45c","path":"\/Users\/marekjulian\/PLM\/import","num_error":0,"num_attempted":19,"oid":"e24ede96-bd00-4ae5-bc31-e0a49256e45c","updated_at":"2013-01-30T03:54:22.864Z","started_at":"2013-01-30T03:53:14.888Z","completed_at":"2013-01-30T03:54:22.864Z","status":"COMPLETED"}}
    //
    var req = http.request(options, function(res) {
      if (res.statusCode === 200) {
        that.state = 'connected';
        res.on('data', function(data) {
          buffer = buffer + data;
          if (buffer.indexOf('\n') > -1) {
            //
            //  Have data to process.....
            //
            buffer = processChanges.call(that, buffer);
          }
        });
        res.on('end', function() {
          that.state = 'disconnected';
        });
      }
      else {
        that.state = 'disconnected';
      }
    });
    req.end();
  };

  return changesFeed;
};

module.exports = function touchdbModule(config, opts) {

  var logPrefix = moduleName + ': ';

  var options = opts || {};
  if (!_.has(options, 'singleton')) {
    options.singleton = true;
  }

  if (options.singleton && (touchdb !== null)) {
    //
    //  Not the first time, you can leave off the config. Otherwise, it must be the same as the previous one.
    //
    if (config && !_.isEqual(touchdb.config, config)) {
      throw Object.create(new Error(),
                          { name: { value: 'ReinstantiatingWithDifferentConfig' },
                            message: { value: 'MediaManagerStorage/lib/touchdb.js: Reinstantiating with a different configuration. Module is a singleton.' } });
    }
    return touchdb;
  }

  //
  //  Must pass a config. the first time.
  //
  if (!config) {
    throw Object.create(new Error(),
                        { name: { value: 'NoConfig' },
                          message: { value: 'MediaManagerStorage/lib/touchdb.js: A config. is required to instantiate the module.' } });
  }

  //
  //  Info: Queries the DB and invokes callback with a single object with the attributes describing the DB:
  //
  //    dbName: db name.
  //    docCount: number of documents in the DB.
  //    updateSeq: The update sequence of the DB.
  //    dbUuid: UUID of the DB.
  //    diskSize: Disk size in bytes.
  //
  //    Note, callback is invoked with the standard node.js args: callback(error, infoObject).
  //
  var info = function(callback) {
    var host = config.local.host ? config.local.host : 'localhost';
    var url = 'http://' + host;

    if (_.has(config.local, 'port')) {
      url = url +  ':' + config.local.port;
    }

    url = url + '/' + config.database;

    var options = { 
      url: url,
      json: true
    };

    log.info(logPrefix + 'About to request DB info, url - %s', options.url);
    //
    //  Do the request. Sample response:
    //  {
    //    "doc_count" : 476,
    //    "db_name" : "plm-media-manager",
    //    "update_seq" : 830,
    //    "db_uuid" : "4E469CD3-E6E4-485A-86DD-258C90B2F180",
    //    "disk_size" : 5619700
    //    }
    //
    request.get(options, 
                function(error, response, body) {
                  if (error) {
                    callback('Database request error - ' + error);
                  }
                  else {
                    var infoObj = {};
                    if (_.has(body, 'db_name')) {
                      infoObj.dbName = body.db_name;
                    }
                    if (_.has(body, 'doc_count')) {
                      infoObj.docCount = body.doc_count;
                    }
                    if (_.has(body, 'update_seq')) {
                      infoObj.updateSeq = body.update_seq;
                    }
                    if (_.has(body, 'db_uuid')) {
                      infoObj.dbUuid = body.db_uuid;
                    }
                    if (_.has(body, 'disk_size')) {
                      infoObj.diskSize = body.disk_size;
                    }

                    callback(null, infoObj);
                  }
                });
    return this;
  };

  //
  //  sync: Trigger a 2 way sync.
  //
  var sync = function() {
    return synchronizerFactory(config);
  };

  //
  //  syncState: Returns a 'synchronizer' which represents the status of a synchronization.
  //
  var syncState = function(id, callback) {
    var synchronizer = synchronizerFactory(config,
                                           { id: id,
                                             passive: true },
                                           callback);
    return synchronizer;
  };

  //
  //  changesFeed: Returns a 'changesFeed'.
  //
  //    args:
  //      options:
  //        excludeAppId: Exclude docs with this appId. Only emit events where: !excludeAppId || excludeAppId !=== doc.app_id.
  //        since: Monitor replication as of this DB update sequence.
  //        includeFilter: Only pay attention to docs. whose class_name attribute is in this list. 
  //          If the paramter evaluates to false, or is NOT included, all changes emit an event.
  //
  var changesFeed = function(options) {
    return changesFeedFactory(config, options);
  };

  log.info(logPrefix + 'Creating touchdb instance w/ config of - %j', config);

  //
  //  touchdb: The return object as a result of module initialization.
  //
  var newInst = Object.create({}, { 
    config: { value: config },
    info: { value: info },
    sync: { value: sync },
    syncState: { value: syncState },
    changesFeed: { value: changesFeed }
  });

  if (options.singleton) {
    touchdb = newInst;
  }

  return newInst;
};

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
//      config: The config used during instantiation.
//
//    Module operations which are exposed:
//
//      sync: Perform a 2 way syncronization between the local TouchDB instance and a remote CouchDB instance.
//        Returns a synchronizer which is an event emitter.
//      syncState(id): Return the state of a synchronization. Returns a Synchronizer instance, but it
//        is a passive instance (returns NO events). This is solely here to support polling of a synchronization 
//        initiated via sync().
//
var uuid  = require('node-uuid');
var events = require('events');
var _ = require('underscore');
var request = require('request').defaults({ jar: false });
var async = require('async');

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
//        sync_started
//        push_started
//        push_completed
//        pull_started
//        pull_completed
//        sync_completed
//
var synchronizerFactory = function(config, options, callback) {

  console.log('MediaManagerStorage/lib/touchdb.js: About to create syncrhonizer...');

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
      var remote = remote = "http://" + config.remote.host;

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
    };

    function setEvents() {
      if (type === 'push') {
        this.events = {
          started: 'replication.push.started',
          completed: 'replication.push.completed'
        };
      }
      else if (type === 'pull') {
        this.events = {
          started: 'replication.pull.started',
          completed: 'replication.pull.completed'
        };
      }
    };

    this.type = type;
    setSourceTarget.apply(this);
    setEvents.apply(this);
    this.id = id ? id : uuid.v4();
    this.state = undefined;
  };


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

  console.log('MediaManagerStorage/lib/touchdb.js: Creating syncrhonizer w/ id - ' + synchronizerId);

  var synchronizer = Object.create(events.EventEmitter.prototype, {
    id: { value: synchronizerId },
    config: { value: config },
    state: { value: undefined, writable: true },
    push: { value: pushRep },
    pull: { value: pullRep }
  });

  //
  //  monitor: Monitor a replication.
  //
  //    args:
  //      options:
  //        maxChecks: int, default is undefined or unlimited checks.
  //
  var monitor = function(replication, options, callback) {
    console.log('MediaManagerStorage/lib/touchdb.js.monitor: Monitoring replication, type - ' + replication.type);
    var url = "http://localhost:" + config.local.port + "/_replicator/" + replication.id;
    options = options ? options : {};
    var maxChecks = _.has(options, 'maxChecks') ? options.maxChecks : undefined;
    var numChecks = 0;
    var check = function(url, callback) {
      request(url, function(error, response, body) {
        numChecks = numChecks + 1;
        console.log('MediaManagerStorage/lib/touchdb.js.monitor: Monitored replication, type - ' + replication.type + ', check number - ' + numChecks + ', url - ' + url + ', body type ' + typeof(body) + ', body - ' + JSON.stringify(body));
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
          console.log('MediaManagerStorage/lib/touchdb.js.monitor: Replication error - ' + error);
        }
        else if (response.statusCode === 200) {
          try {
            replication.state = parsedBody._replication_state;
          }
          catch (err) {
            replication.state = 'error';
          }
          console.log('MediaManagerStorage/lib/touchdb.js.monitor: Replication state - ' + replication.state);
        }
        else {
          console.log('MediaManagerStorage/lib/touchdb.js.monitor: Response status - ' + response.statusCode);
        }
        callback();
      });
    };
    var checkInterval = 1;
    var checked = function() {
      if (((maxChecks === undefined) || (numChecks < maxChecks)) && (replication.state === 'triggered')) {
        checkInterval = checkInterval >= 900 ? 900 : checkInterval * 2;
        setTimeout(check, checkInterval, url, checked);
      }
      else {
        callback(null);
      }
    };
    console.log('MediaManagerStorage/lib/touchdb.js.monitor: About to perform checks, numChecks - ' + numChecks + ', maxChecks - ' + maxChecks);
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
  //  Replication uses the _replicator db. For details on using the _replicator
  // db see:
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
    console.log('MediaManagerStorage/lib/touchdb.js: About to replication, type - ' + replication.type + ', url - ' + url);
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
                   console.log('MediaManagerStorage/lib/touchdb.js: Replication response, type - ' + replication.type + ', status code - ' + response.statusCode + ', body - ' + JSON.stringify(body));
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
                     console.log('MediaManagerStorage/lib/touchdb.js: Error triggering replication...');
                     synchronizer.emit(replication.events.completed);
                     callback(error);
                   }
                 });
    synchronizer.state = 'triggered';
    console.log('MediaManagerStorage/lib/touchdb.js: Replication triggered...');
    synchronizer.emit(replication.events.started);
  };

  if (options && _.has(options, 'passive') && options.passive) {
    //
    // Create a 'passive' synchronizer which doesn't trigger replication,
    // but just does a single monitor of a push / pull replication.
    // This just does 2 loockups in the _replicator DB.
    //
    console.log('MediaManagerStorage/lib/touchdb.js: About to monitor passive synchronization...');
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
    synchronizer.state = 'triggered';
    console.log('MediaManagerStorage/lib/touchdb.js: Synchronization triggered...');
    synchronizer.emit('sync.started', synchronizer);
    async.waterfall([
      function(next) {
        console.log('MediaManagerStorage/lib/touchdb.js: Triggering push...');
        replicate(synchronizer.push, next);
      },
      function(next) {
        console.log('MediaManagerStorage/lib/touchdb.js: Triggering pull...');
        replicate(synchronizer.pull, next);
      }
    ], function(err) {
      if (err) {
        console.log('MediaManagerStorage/lib/touchdb.js: Error during synchronization, error - ' + err);
      }
      synchronizer.state = 'completed';
      synchronizer.emit('sync.completed', synchronizer);
    });
  }

  return synchronizer;
};

module.exports = function touchdbModule(config) {

  if (touchdb !== null) {
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
  //  sync: Perform a 2 way sync.
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

  console.log('MediaManagerStorage/lib/touchdb.js: Creating touchdb instance w/ ocnfig of - ' + JSON.stringify(config));

  //
  //  touchdb: The return object as a result of module initialization.
  //
  touchdb = Object.create({}, { 
    config: { value: config },
    sync: { value: sync },
    syncState: { value: syncState }
  });

  return touchdb;
};

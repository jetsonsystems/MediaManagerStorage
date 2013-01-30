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
var http = require('http');
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
//        sync.started
//        replication.push.started
//        replication.push.completed
//        replication.pull.started
//        replication.pull.completed
//        sync.completed
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
    var checkInterval = 1 * 1000;
    // 15s max check interval.
    var maxCheckInterval = 15 * 1000;
    var checked = function() {
      if (((maxChecks === undefined) || (numChecks < maxChecks)) && (replication.state === 'triggered')) {

        checkInterval = checkInterval >= maxCheckInterval ? maxCheckInterval : checkInterval * 2;
        console.log('MediaManagerStorage/lib/touchdb.js.monitor: Scheduling next check, numChecks - ' + numChecks + ', maxChecks - ' + maxChecks + ', check interval - ' + checkInterval);
        setTimeout(check, checkInterval, url, checked);
      }
      else {
        callback(null);
      }
    };
    console.log('MediaManagerStorage/lib/touchdb.js.monitor: About to perform checks, numChecks - ' + numChecks + ', maxChecks - ' + maxChecks + ', check interval - ' + checkInterval);
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
    console.log('MediaManagerStorage/lib/touchdb.js: About to replicate, type - ' + replication.type + ', url - ' + url + ', source - ' + replication.source + ', target - ' + replication.target);
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
                     console.log('MediaManagerStorage/lib/touchdb.js: Replication error, type - ' + replication.type + ', error - ' + error.message);
                   }
                   else {
                     console.log('MediaManagerStorage/lib/touchdb.js: Replication response, type - ' + replication.type + ', status code - ' + response.statusCode + ', body - ' + JSON.stringify(body));
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
    synchronizer.run = function() { throw Object.create(new Error(),
                                                        { name: { value: "PassiveSynchronizerRunError" },
                                                          message: { value: "Passive synchronizer run method cannot be executed!"} })
                                  };
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
    console.log('MediaManagerStorage/lib/touchdb.js: Annotating non-passive synchronizer with run function...');
    synchronizer.run = function() {
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
    };
    console.log('MediaManagerStorage/lib/touchdb.js: Annotation completed...');
  }

  return synchronizer;
};

//
//  changesFeedFactory: Returns an instance of a changes feed which is an event Emitter.
//
//    args:
//      config: DB config
//      options:
//        since: DB sequence ID S.T. changes will only be return where the seq. ID is after this one. See TouchDB's _changes?since query paramter.
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
//        <doc. type> ::= 'image'
//        <change type> ::= 'created' | 'updated' | 'deleted'
//
//      IE: doc.image.created
//
//      Note, currently, events are ONLY emitted for image documents.
//
//      Events are emitted with as follows:
//
//        <changes feed instance>.emit(doc.<doc. type>.<change type>, <doc. ID>);
//
//      Hence, the listener can query the document if he/she are interested in it based upon its <doc. type> using <doc. ID>.
//
var changesFeedFactory = function(config, options) {
  console.log('MediaManagerStorage/lib/touchdb.js: Creating changes feed...');

  var options = options || {};

  var docClassesToTypes = {
    'plm.Image': 'image'
  };

  var since = undefined;
  var currentUpdateSeq = undefined;

  if (_.has(options, 'since')) {
    since = options.since;
  }

  var changesFeed = Object.create(events.EventEmitter.prototype, {
    config: { value: config },
    state: { value: undefined, writable: false },
    since: { value: since, writable: false },
    currentUpdateSeq: { value: currentUpdateSeq, writable: false },
    listen: { value: function() { throw Object.create(new Error(),
                                                      { name: { value: 'ChangesFeedVoidListenInvokation' },
                                                        mesage: { value: 'ChangesFeed listen function NOT overriden.' } }); },
              writable: true }
  });

  //
  //  processChanges: Helper to process the data in buffer.
  //    Emits events for each pertinent change, and returns
  //    any extraneous data in buffer which is not yet complete
  //
  var processChanges = function(buffer) {
    var that = this;
    console.log('Processing changes w/ config - ' + JSON.stringify(that.config));
    var parts = buffer.split('\n');

    if (parts.length > 0) {
      _.each(_.first(parts, parts.length - 1), function(part) {
        if (part.length) {
          try {
            var change = JSON.parse(part);

            if (_.has(change, 'seq') && _.has(change, 'id')) {
              console.log('Processing change: seq - ' + change.seq + ', id - ' + change.id);

              that.currentUpdateSeq = change.seq;
              var changeType = 'updated';

              if (_.has(change, 'deleted') && change.deleted) {
                changeType = 'deleted';
              }
              else {
                _.each(change.changes, function(chg) {
                  if (_.has(chg, 'rev') && (chg.rev.match(/^1-/))) {
                    changeType = 'created';
                  }
                });
              }

              request.get({url: "http://localhost:" + that.config.local.port + "/" + that.config.database + "/" + change.id,
                           json: true },
                          function(error, res, body) {
                            if (error) {
                              console.log('Error getting changed document w/ id - ' + change.id);
                            }
                            else if (_.has(body, 'class_name') && _.has(docClassesToTypes, body.class_name)) {
                              //
                              //  Emit an event!
                              //
                              var ok = true;

                              if ((body.class_name === 'plm.Image') && body.orig_id) {
                                //
                                //  Only emit events for original docs.
                                //
                                ok = false;
                              }
                              if (ok) {
                                var event = 'doc.' + docClassesToTypes[body.class_name] + '.' + changeType;
                                that.emit(event, change.id);
                              }
                            }
                          });
            }
          }
          catch (err) {
            console.log('Error processing change, data - ' + part + ', error - ' + err);
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
  //  listen: Listen to the changes feed by performing the following requrest:
  //    http://localhost:<port>/<database>/_changes?since=<seq ID>
  //
  changesFeed.listen = function() {
    var that = this;

    var path = "/" + config.database + "/_changes?feed=continuous";
    if (this.since) {
      path = path + "&since=" + this.since;
    }
    var options = {
      hostname: 'localhost',
      port: this.config.local.port,
      path: path,
      method: 'GET'
    };

    var buffer = "";

    //
    //  Fire off a request. It will essentially look like this:
    //
    //    curl -v 'http://localhost:59840/plm-media-manager/_changes?since=250&feed=continuous'
    // * About to connect() to localhost port 59840 (#0)
    // *   Trying ::1... connected
    // * Connected to localhost (::1) port 59840 (#0)
    // > GET /plm-media-manager/_changes?since=250&feed=continuous HTTP/1.1
    // > User-Agent: curl/7.21.4 (universal-apple-darwin11.0) libcurl/7.21.4 OpenSSL/0.9.8r zlib/1.2.5
    // > Host: localhost:59840
    // > Accept: */*
    // > 
    // < HTTP/1.1 200 OK
    // < Transfer-Encoding: chunked
    // < Date: Wed, 30 Jan 2013 22:19:38 GMT
    // < Accept-Ranges: bytes
    // < Server: TouchDB 1
    // < Cache-Control: must-revalidate
    // < 
    // {"seq":251,"id":"787f955c-eea7-447a-85fc-5e1efc185598","changes":[{"rev":"2-15638f2c8afd51f2e9a6234d2f217f47"}]}
    // {"seq":253,"id":"418c67d4-9cb1-45b8-af25-e9b4b6a127a9","changes":[{"rev":"2-e82f73b63a9f1ac631ae12990c0d2e6e"}]}
    // {"seq":255,"id":"6dd5ba30-a70d-4251-8bbe-36876c1dc8f4","changes":[{"rev":"2-b0b001e9c1c22bf636b64cd18693212e"}]}
    // {"seq":256,"id":"f4f7e2b8-dfaf-432d-b897-6b0fbc0e2585","changes":[{"rev":"1-99c4e92abd2869e0ee2a1a89b1bdfdef"}]}
    // {"seq":258,"id":"a71256f1-a85f-4e46-90db-f41da00724d8","changes":[{"rev":"2-530ece1c7e7c7b00a5bbc4479833d96d"}]}
    // {"seq":260,"id":"79294fc6-ecaa-4d95-a29c-b5ba396ccb03","changes":[{"rev":"2-77ec0c3c94de29b334ed638ab034f752"}]}
    //
    var req = http.request(options, function(res) {
      if (res.statusCode === 200) {
        that.state = 'connected';
        res.on('data', function(data) {
          console.log('data: ' + data);
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

module.exports = function touchdbModule(config, options) {

  options = options || {}
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
  //        since: Monitor replication as of this DB update sequence.
  //
  var changesFeed = function(options) {
    return changesFeedFactory(config, options);
  };

  console.log('MediaManagerStorage/lib/touchdb.js: Creating touchdb instance w/ config of - ' + JSON.stringify(config));

  //
  //  touchdb: The return object as a result of module initialization.
  //
  var newInst = Object.create({}, { 
    config: { value: config },
    sync: { value: sync },
    syncState: { value: syncState },
    changesFeed: { value: changesFeed }
  });

  if (options.singleton) {
    touchdb = newInst;
  }

  return newInst;
};
